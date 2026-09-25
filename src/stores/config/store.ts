/**
 * @description 配置 store 本体：响应式全量配置 + 深度 watch 防抖 flush 落库
 *              （调用方保持直接改 store 的用法）；加载时合并库内快照/legacy yaml、
 *              清理无效引用、按需生成默认档案与迁移本地分组。
 */
import { defineStore } from 'pinia'
import { reactive, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { parse as parseYaml } from 'yaml'
import { normalizeHotkeysConfig } from '@/lib/hotkeys/hotkeys'
import { listShells } from '@/services/shells'
import { sanitizeForwardings } from '@/lib/portForwarding'
import { deepMerge, defaultConfig, isPlainObject, localGroupsFromShells, migrateLocalGroups, profilesFromShells, upsertRecentEntry } from './defaults'
import { captureBaseline, commitOp, computeOps, emptyBaseline, runFlushOp } from './flush'
import type { ConfigSnapshot, ConfigStore, MonitorConfig, RecentsConfig, TerminalProfile } from './types'

/**
 * Reactive application configuration, persisted to SQLite (config.db) via
 * entity-level CRUD commands on the Rust side. Local mutations are captured
 * by a deep watch and flushed (debounced) as a per-entity diff, so callers
 * keep mutating the store directly.
 */
export const useConfigStore = defineStore('config', () => {
    const store = reactive<ConfigStore>(defaultConfig())
    let loaded = false
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    let saving = false
    let pendingChange = false
    let lastSaved = emptyBaseline()

    // 持久化 watch 必须在 setup 同步流创建（load() 的 await 之后创建在 WKWebView 实测不触发）；
    // getter 数组 + deep 逐分片建依赖（theme store 同款模式）。loaded 门控在 scheduleSave 内。
    watch(() => [store.terminal, store.appearance, store.advanced, store.recents, store.monitor, store.hotkeys, store.profiles, store.localGroups, store.sshGroups, store.tabGroups, store.colorSchemes, store.quickCommands, store.quickCommandGroups] as const, () => scheduleSave(), { deep: true })

    async function load (): Promise<void> {
        let userConfig: Record<string, unknown> | null = null
        let migratedFromLegacy = false
        try {
            const snapshot = await invoke<ConfigSnapshot | null>('config_load')
            if (snapshot && isPlainObject(snapshot)) {
                userConfig = snapshot
            } else {
                // 全新库：尝试一次性导入旧版 config.yaml（成功导入后立即全量落库并归档）
                const legacy = await invoke<string | null>('config_load_legacy_yaml')
                if (legacy && legacy.trim()) {
                    const parsed = parseYaml(legacy)
                    if (isPlainObject(parsed)) {
                        userConfig = parsed
                        migratedFromLegacy = true
                    }
                }
            }
            if (userConfig) {
                deepMerge(store, userConfig)
                // recents 的键是动态 profileId，deepMerge 只回填 target 已有键，需整体替换恢复
                if (isPlainObject(userConfig.recents)) {
                    store.recents = userConfig.recents as RecentsConfig
                }
                store.hotkeys = normalizeHotkeysConfig(store.hotkeys)
                sanitizeProfiles()
                sanitizeQuickCommands()
            }
        } catch (error) {
            console.error('could not load config', error)
        }
        loaded = true
        // 迁移走空基线：首次 flush 把合并后的全量状态写入新库
        lastSaved = migratedFromLegacy ? emptyBaseline() : captureBaseline(store)
        // 首次运行/旧配置（用户配置无 profiles 键）：由 /etc/shells 生成默认分组与档案并持久化；
        // 键存在（即使空数组）视为用户已管理，不再生成
        await generateProfilesIfAbsent(userConfig)
        // 存量平铺档案（有 profiles 键但 localGroups 为空）：迁移进默认分组
        await migrateLocalGroupsIfAbsent(userConfig)
        if (migratedFromLegacy) {
            await flush()
            await invoke('config_archive_legacy_yaml').catch(error => console.error('could not archive legacy config', error))
        }
    }

    /**
     * @description 清理 SSH 档案上的无效引用：已废弃的明文敏感字段（旧版 yaml 遗留的
     *              password/privateKeyPath——敏感数据已加密存 SQLite，不允许残留明文副本）
     *              与悬空的 groupId（分组被删/旧数据残留，降级为默认分组）；转发规则
     *              逐条归一化（类型白名单/端口范围/目标必填），非法条目丢弃、空集删字段
     * @returns void
     *
     * @example sanitizeProfiles()
     *
     */
    function sanitizeProfiles (): void {
        const groupIds = new Set(store.sshGroups.map(group => group.id))
        const localGroupIds = new Set(store.localGroups.map(group => group.id))
        for (const profile of store.profiles) {
            if (profile.type === 'local') {
                const legacy = profile as Record<string, unknown>
                // 旧快照/迁移前数据可能缺 builtin 键（快照档案整体替换语义不填默认值）
                if (typeof profile.builtin !== 'boolean') {
                    profile.builtin = false
                }
                if (profile.groupId && !localGroupIds.has(profile.groupId)) {
                    delete legacy.groupId
                }
                continue
            }
            const legacy = profile as Record<string, unknown>
            delete legacy.password
            delete legacy.privateKeyPath
            if (profile.groupId && !groupIds.has(profile.groupId)) {
                delete legacy.groupId
            }
            const forwardings = sanitizeForwardings(legacy.forwardings)
            if (forwardings && forwardings.length > 0) {
                profile.forwardings = forwardings
            } else {
                delete legacy.forwardings
            }
        }
    }

    /**
     * @description 清理快捷命令上悬空的 groupId（分组被删/旧数据引用残留，降级为未分组）
     * @returns void
     *
     * @example sanitizeQuickCommands()
     *
     */
    function sanitizeQuickCommands (): void {
        const groupIds = new Set(store.quickCommandGroups.map(group => group.id))
        for (const quickCommand of store.quickCommands) {
            if (quickCommand.groupId && !groupIds.has(quickCommand.groupId)) {
                delete quickCommand.groupId
            }
        }
    }

    /**
     * @description 用户配置不含 profiles 键时，由系统 shell 列表生成默认分组与档案（触发持久化）
     * @param userConfig 解析后的用户配置对象（可为 null）
     * @returns Promise<void>
     *
     */
    async function generateProfilesIfAbsent (userConfig: Record<string, unknown> | null): Promise<void> {
        if (userConfig && 'profiles' in userConfig) {
            return
        }
        try {
            const shells = await listShells()
            store.localGroups = localGroupsFromShells(shells)
            store.profiles = profilesFromShells(shells, store.terminal.loginShell)
        } catch (error) {
            console.error('could not generate default profiles', error)
        }
    }

    /**
     * @description 用户配置有 profiles 键但 localGroups 为空（存量平铺档案；Rust 快照恒序列化
     *              localGroups 键，故以空列表判「从未迁移」——迁移后 builtin 默认组常驻，不会
     *              再触空）时，迁移进默认分组模型；迁移产生的 store 变更走防抖 flush 落库
     * @param userConfig 解析后的用户配置对象（可为 null）
     * @returns Promise<void>
     *
     */
    async function migrateLocalGroupsIfAbsent (userConfig: Record<string, unknown> | null): Promise<void> {
        if (!userConfig || !('profiles' in userConfig) || store.localGroups.length > 0) {
            return
        }
        try {
            const shells = await listShells()
            const migrated = migrateLocalGroups(store.profiles, shells, store.terminal.loginShell)
            store.localGroups = migrated.groups
            store.profiles = migrated.profiles
        } catch (error) {
            console.error('could not migrate local profile groups', error)
        }
    }

    /**
     * @description 默认配置档案（isDefault 优先，兜底第一个）
     * @returns TerminalProfile | null 无档案时返回 null
     *
     */
    function defaultProfile (): TerminalProfile | null {
        return store.profiles.find(profile => profile.isDefault) ?? store.profiles[0] ?? null
    }

    /**
     * @description 把某档案设为唯一默认
     * @param id 档案 id
     * @returns void
     *
     */
    function setDefaultProfile (id: string): void {
        for (const profile of store.profiles) {
            profile.isDefault = profile.id === id
        }
    }

    /**
     * @description 记录一次 SSH 最近连接（upsert 时间戳 + 裁剪）
     * @param profileId 档案 id
     * @returns void
     *
     * @example noteRecentConnection('ssh-1')
     *
     */
    function noteRecentConnection (profileId: string): void {
        store.recents = upsertRecentEntry(store.recents, profileId, Date.now())
    }

    /**
     * @description 更新监控侧栏配置（展开态/栏宽；config store 的 deep watch 自动防抖落库）
     * @param patch 待合并的监控配置分片
     * @returns void
     *
     * @example setMonitor({ open: true })
     *
     */
    function setMonitor (patch: Partial<MonitorConfig>): void {
        Object.assign(store.monitor, patch)
    }

    /**
     * @description 调度一次防抖 flush（500ms 内的多次 mutation 合并）；flush 进行中到达的
     *              变更记为 pending，结束后重新调度
     * @returns void
     *
     */
    function scheduleSave (): void {
        if (!loaded) {
            return
        }
        if (saving) {
            pendingChange = true
            return
        }
        if (saveTimer) {
            clearTimeout(saveTimer)
        }
        saveTimer = setTimeout(() => {
            saveTimer = null
            void flush()
        }, 500)
    }

    /**
     * @description 把当前 store 与基线的差异逐条写入 SQLite：任一命令失败即中断并保留
     *              未提交基线（下次 flush 只重试剩余差异），全部成功则基线同步为已写状态
     * @returns Promise<void>
     *
     */
    async function flush (): Promise<void> {
        saving = true
        try {
            for (const op of computeOps(store, lastSaved)) {
                await runFlushOp(op)
                commitOp(lastSaved, op)
            }
        } catch (error) {
            console.error('could not persist config change', error)
            // webview 的 console.error 不进 tauri dev 终端，转发一条便于排查（同 SettingsView openConfigDir 先例）
            void invoke('dev_log', { message: `[config] flush failed: ${String(error)}` }).catch(() => {})
        } finally {
            saving = false
            if (pendingChange) {
                pendingChange = false
                scheduleSave()
            }
        }
    }

    async function reloadFromDisk (): Promise<void> {
        // used by tests / future external-change handling
        deepMerge(store, defaultConfig())
        const snapshot = await invoke<ConfigSnapshot | null>('config_load')
        if (snapshot) {
            deepMerge(store, snapshot)
            store.hotkeys = normalizeHotkeysConfig(store.hotkeys)
        }
        lastSaved = captureBaseline(store)
    }

    function getCSSFontFamily (): string {
        const font = store.terminal.font
        if (font === 'monospace' || !font) {
            return 'monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace'
        }
        return `"${font}", monospace`
    }

    return { store, load, reloadFromDisk, getCSSFontFamily, defaultProfile, setDefaultProfile, noteRecentConnection, setMonitor }
})
