import { defineStore } from 'pinia'
import { nanoid } from 'nanoid'
import { reactive, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { parse as parseYaml } from 'yaml'
import { platform } from '@/lib/platform'
import { normalizeHotkeysConfig } from '@/lib/hotkeys/hotkeys'
import { listShells, type Shell } from '@/services/shells'
import type { TerminalColorScheme } from '@/lib/colorSchemes'

/** SSH 认证策略：auto = agent → 私钥（显式或 ~/.ssh/id_*）→ 密码（若配置） */
export type SshAuthMethod = 'auto' | 'agent' | 'publicKey' | 'password'

/** 本地 shell 档案 */
export interface LocalProfile {
    id: string
    type: 'local'
    name: string
    command: string
    args: string[]
    env: Record<string, string>
    cwd: string | null
    /** 档案专属配色名；null 跟随全局 */
    colorScheme: string | null
    loginShell: boolean
    isDefault: boolean
}

/** SSH 远程档案 */
export interface SshProfile {
    id: string
    type: 'ssh'
    name: string
    host: string
    port: number
    user: string
    auth: SshAuthMethod
    /** 密钥链条目 id（加密存 SQLite，见 services/secrets.ts）；null = 不用密钥链 */
    keyId: string | null
    /** 档案专属配色名；null 跟随全局 */
    colorScheme: string | null
    isDefault: boolean
}

/** 终端配置档案：type 为判别字段（local 本地 shell / ssh 远程连接） */
export type TerminalProfile = LocalProfile | SshProfile

/** 快捷命令分组（管理用实体，命令以 groupId 单选引用） */
export interface QuickCommandGroup {
    id: string
    name: string
}

/** 快捷命令：command 支持 {{参数}} 占位符（Warp Workflow 式），autoRun 控制写入后是否补换行执行 */
export interface QuickCommand {
    id: string
    name: string
    command: string
    /** 所属分组 id；缺省 = 未分组 */
    groupId?: string
    autoRun: boolean
}

export interface TerminalConfig {
    font: string
    fontSize: number
    linePadding: number
    lineHeightAdjustment: number
    cursor: 'block' | 'bar' | 'underline'
    cursorBlink: boolean
    altIsMeta: boolean
    scrollbackLines: number
    wordSeparator: string
    drawBoldTextInBrightColors: boolean
    fontWeight: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900'
    fontWeightBold: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900'
    minimumContrastRatio: number
    copyOnSelect: boolean
    paletteGenerate: boolean
    paletteHarmonious: boolean
    backspace: 'ctrl-h' | 'ctrl-?' | 'delete' | 'backspace'
    inputNewlines: null | 'cr' | 'lf' | 'crlf' | 'implicit_cr' | 'implicit_lf'
    outputNewlines: null | 'cr' | 'lf' | 'crlf' | 'implicit_cr' | 'implicit_lf'
    /** 以登录 shell 启动（-l，加载 ~/.zprofile 等登录配置），对齐 Tabby/Terminal.app */
    loginShell: boolean
}

export interface AppearanceConfig {
    /** 'auto' 跟随系统；'dark'/'light' 为旧值（映射默认深/浅配色）；其余为内置配色名 */
    colorScheme: string
    tabBarPosition: 'top' | 'bottom'
    theme: 'default-dark' | 'default-light' | 'auto'
    language: 'auto' | 'zh-CN' | 'en'
}

/** hotkey id -> list of sequences, each sequence a list of keystrokes */
export type HotkeysConfig = Record<string, string[][]>

export interface ConfigStore {
    terminal: TerminalConfig
    appearance: AppearanceConfig
    hotkeys: HotkeysConfig
    profiles: TerminalProfile[]
    /** 用户自定义配色方案（名称与内置重复时优先于内置生效） */
    colorSchemes: TerminalColorScheme[]
    quickCommands: QuickCommand[]
    quickCommandGroups: QuickCommandGroup[]
}

/** config_load 返回的库内快照（仅含已持久化的键，缺省由默认值兜底） */
export interface ConfigSnapshot {
    terminal?: Partial<TerminalConfig>
    appearance?: Partial<AppearanceConfig>
    hotkeys?: HotkeysConfig
    profiles?: TerminalProfile[]
    colorSchemes?: TerminalColorScheme[]
    quickCommands?: QuickCommand[]
    quickCommandGroups?: QuickCommandGroup[]
}

export function defaultConfig (): ConfigStore {
    return {
        terminal: {
            font: 'monospace',
            fontSize: 14,
            linePadding: 0,
            lineHeightAdjustment: 0,
            cursor: 'block',
            cursorBlink: false,
            altIsMeta: false,
            scrollbackLines: 25000,
            wordSeparator: ' ()[]{}\'"',
            drawBoldTextInBrightColors: true,
            fontWeight: 'normal',
            fontWeightBold: 'bold',
            minimumContrastRatio: 4,
            copyOnSelect: false,
            paletteGenerate: false,
            paletteHarmonious: false,
            backspace: 'backspace',
            inputNewlines: null,
            outputNewlines: null,
            loginShell: true,
        },
        appearance: {
            colorScheme: 'auto',
            tabBarPosition: 'top',
            theme: 'auto',
            language: 'auto',
        },
        profiles: [],
        colorSchemes: [],
        quickCommands: [],
        quickCommandGroups: [],
        hotkeys: defaultHotkeys(),
    }
}

/**
 * @description 由系统 shell 列表（/etc/shells）生成默认的 local 配置档案；默认 shell 档案置顶
 * @param shells Rust list_shells 返回的 shell 列表
 * @param loginShell 生成的档案是否以登录 shell 启动（取全局 terminal.loginShell 当前值）
 * @returns LocalProfile[] 档案列表（系统默认 shell 标 isDefault 且排首位，仅首个默认生效）
 *
 * @example profilesFromShells([{ id: 'zsh', name: 'zsh', command: '/bin/zsh', args: [], default: true }], true)[0].isDefault // true
 *
 */
export function profilesFromShells (shells: Shell[], loginShell: boolean): LocalProfile[] {
    let defaultAssigned = false
    const profiles: LocalProfile[] = shells.map(shell => {
        const isDefault = shell.default && !defaultAssigned
        if (isDefault) {
            defaultAssigned = true
        }
        return {
            id: `local-${shell.id}-${nanoid(6)}`,
            type: 'local' as const,
            name: shell.name,
            command: shell.command,
            args: [...shell.args],
            env: {},
            cwd: null,
            colorScheme: null,
            loginShell,
            isDefault,
        }
    })
    return defaultFirstProfiles(profiles)
}

/**
 * @description 档案展示排序：默认档案置顶，其余保持原顺序（用于设置页档案列表与「+」新建标签下拉）
 * @param profiles 待排序档案列表（原数组不被修改）
 * @returns TerminalProfile[] 默认档案在首位的新数组
 *
 * @example defaultFirstProfiles([{ name: 'bash', isDefault: false }, { name: 'zsh', isDefault: true }])[0].name // 'zsh'
 *
 */
export function defaultFirstProfiles<T extends TerminalProfile> (profiles: T[]): T[] {
    const index = profiles.findIndex(profile => profile.isDefault)
    if (index <= 0) {
        return [...profiles]
    }
    const sorted = [...profiles]
    const [defaultProfile] = sorted.splice(index, 1)
    sorted.unshift(defaultProfile!)
    return sorted
}

/**
 * @description 构造当前平台的默认热键配置
 * @returns HotkeysConfig hotkey id -> 按键序列列表
 *
 * @example defaultHotkeys()['pane-forward'] // mac: [['⌘-⌥-Right']]
 *
 */
export function defaultHotkeys (): HotkeysConfig {
    const mac = platform === 'macos'
    if (mac) {
        return {
            'command-palette': [['⌘-Shift-P']],
            'new-tab': [['⌘-T']],
            'close-tab': [['⌘-W']],
            'next-tab': [['⌘-Shift-]']],
            'prev-tab': [['⌘-Shift-[']],
            'split-right': [['⌘-D']],
            'split-down': [['⌘-Shift-D']],
            'close-pane': [['⌘-⌥-W']],
            'pane-forward': [['⌘-⌥-Right']],
            'pane-backward': [['⌘-⌥-Left']],
            'copy': [['⌘-C']],
            'paste': [['⌘-V']],
            'clear': [['⌘-K']],
            'find': [['⌘-F']],
            'quick-commands-palette': [['⌘-Shift-R']],
            // 默认不绑定（与 Tabby 一致），可在设置页快捷键录制
            'copy-current-path': [],
        }
    }
    return {
        'command-palette': [['Ctrl-Shift-P']],
        'new-tab': [['Ctrl-Shift-T']],
        'close-tab': [['Ctrl-Shift-W']],
        'next-tab': [['Ctrl-Shift-]']],
        'prev-tab': [['Ctrl-Shift-[']],
        'split-right': [['Ctrl-Shift-D']],
        'split-down': [['Ctrl-Shift-E']],
        'close-pane': [['Ctrl-Shift-X']],
        'pane-forward': [['Ctrl-Alt-Right']],
        'pane-backward': [['Ctrl-Alt-Left']],
        'copy': [['Ctrl-Shift-C']],
        'paste': [['Ctrl-Shift-V']],
        'clear': [['Ctrl-Shift-K']],
        'find': [['Ctrl-Shift-F']],
        'quick-commands-palette': [['Ctrl-Shift-R']],
        'copy-current-path': [],
    }
}

/**
 * @description 档案均不可用时的兜底档案（macOS 保证 /bin/zsh 存在），保证终端窗格永远能启动
 * @returns TerminalProfile 兜底档案
 *
 * @example fallbackProfile().command // '/bin/zsh'
 *
 */
export function fallbackProfile (): LocalProfile {
    return {
        id: 'local-fallback',
        type: 'local',
        name: 'zsh',
        command: '/bin/zsh',
        args: [],
        env: {},
        cwd: null,
        colorScheme: null,
        loginShell: true,
        isDefault: true,
    }
}

function isPlainObject (value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** deep-merges user values over defaults; defaults fill any gap */
export function deepMerge<T> (target: T, source: unknown): T {
    if (!isPlainObject(target) || !isPlainObject(source)) {
        return (source === undefined ? target : source) as T
    }
    for (const [key, value] of Object.entries(source)) {
        if (key in target) {
            ;(target as Record<string, unknown>)[key] = deepMerge((target as Record<string, unknown>)[key], value)
        }
    }
    return target
}

// ---- 差异 flush 引擎：把本地 mutation 翻译成实体级 CRUD 命令 ----

/** 上次已持久化状态的基线（各实体存键排序后的稳定序列化串，用于 diff） */
export interface SavedBaseline {
    terminal: string
    appearance: string
    hotkeys: Record<string, string>
    profiles: Record<string, string>
    quickCommands: Record<string, string>
    quickCommandGroups: Record<string, string>
    colorSchemes: Record<string, string>
}

/** 一条待执行的持久化操作；saved 为该实体写入成功后记入基线的快照串 */
export type FlushOp =
    | { kind: 'settingsSection'; key: 'terminal' | 'appearance'; value: TerminalConfig | AppearanceConfig; saved: string }
    | { kind: 'hotkey'; action: string; bindings: string[][]; saved: string }
    | { kind: 'profileCreate'; profile: TerminalProfile; saved: string }
    | { kind: 'profileUpdate'; profile: TerminalProfile; saved: string }
    | { kind: 'profileDelete'; id: string }
    | { kind: 'quickCommandCreate'; command: QuickCommand; saved: string }
    | { kind: 'quickCommandUpdate'; command: QuickCommand; saved: string }
    | { kind: 'quickCommandDelete'; id: string }
    | { kind: 'quickCommandGroupCreate'; group: QuickCommandGroup; saved: string }
    | { kind: 'quickCommandGroupUpdate'; group: QuickCommandGroup; saved: string }
    | { kind: 'quickCommandGroupDelete'; id: string }
    | { kind: 'colorSchemeSave'; name: string; data: TerminalColorScheme; saved: string }
    | { kind: 'colorSchemeDelete'; name: string }

/**
 * @description 键排序的稳定 JSON 序列化：同一数据的不同键序产出相同字符串（diff 比对用，
 *              避免对象字面量键序漂移导致的误报）
 * @param value 待序列化的任意值
 * @returns string 稳定序列化串
 *
 * @example stableStringify({ b: 1, a: 2 }) // '{"a":2,"b":1}'
 *
 */
export function stableStringify (value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(item => stableStringify(item)).join(',')}]`
    }
    if (isPlainObject(value)) {
        const keys = Object.keys(value).sort()
        return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
    }
    return JSON.stringify(value) ?? 'null'
}

/**
 * @description 按实体 id 比对当前列表与基线，产出增/改/删（序列化串不同即视为改）
 * @param current 当前实体列表
 * @param saved 基线（id -> stableStringify 快照）
 * @returns EntityDiff<T> creates/updates 为实体引用，deletes 为被移除的 id
 *
 * @example diffById([{ id: 'a' }, { id: 'b' }], { a: '{"id":"a"}' }).creates[0].id // 'b'
 *
 */
export function diffById<T extends { id: string }> (current: T[], saved: Record<string, string>): { creates: T[]; updates: T[]; deletes: string[] } {
    const savedIds = new Set(Object.keys(saved))
    const currentIds = new Set(current.map(item => item.id))
    const creates: T[] = []
    const updates: T[] = []
    for (const item of current) {
        if (!savedIds.has(item.id)) {
            creates.push(item)
        } else if (stableStringify(item) !== saved[item.id]) {
            updates.push(item)
        }
    }
    return { creates, updates, deletes: [...savedIds].filter(id => !currentIds.has(id)) }
}

/**
 * @description 计算当前 store 与基线之间的持久化操作序列（纯函数）：terminal/appearance 分片
 *              级 set，热键逐 action set，档案/快捷命令/分组按 id 增改删，配色按 name 增改删
 * @param store 当前配置
 * @param saved 上次已持久化基线
 * @returns FlushOp[] 按删除、新增、修改排序的操作序列
 *
 * @example computeOps({ ...store, profiles: [] }, emptyBaseline())[0].kind // 'settingsSection'
 *
 */
export function computeOps (store: ConfigStore, saved: SavedBaseline): FlushOp[] {
    const ops: FlushOp[] = []

    const terminal = stableStringify(store.terminal)
    if (terminal !== saved.terminal) {
        ops.push({ kind: 'settingsSection', key: 'terminal', value: store.terminal, saved: terminal })
    }
    const appearance = stableStringify(store.appearance)
    if (appearance !== saved.appearance) {
        ops.push({ kind: 'settingsSection', key: 'appearance', value: store.appearance, saved: appearance })
    }

    // 热键取两侧 action 并集：saved-only 的 action 视为清空绑定（[]）
    for (const action of new Set([...Object.keys(store.hotkeys), ...Object.keys(saved.hotkeys)])) {
        const bindings = store.hotkeys[action] ?? []
        const encoded = stableStringify(bindings)
        if (encoded !== saved.hotkeys[action]) {
            ops.push({ kind: 'hotkey', action, bindings, saved: encoded })
        }
    }

    const profileDiff = diffById(store.profiles, saved.profiles)
    for (const id of profileDiff.deletes) {
        ops.push({ kind: 'profileDelete', id })
    }
    for (const profile of profileDiff.creates) {
        ops.push({ kind: 'profileCreate', profile, saved: stableStringify(profile) })
    }
    for (const profile of profileDiff.updates) {
        ops.push({ kind: 'profileUpdate', profile, saved: stableStringify(profile) })
    }

    const commandDiff = diffById(store.quickCommands, saved.quickCommands)
    for (const id of commandDiff.deletes) {
        ops.push({ kind: 'quickCommandDelete', id })
    }
    for (const command of commandDiff.creates) {
        ops.push({ kind: 'quickCommandCreate', command, saved: stableStringify(command) })
    }
    for (const command of commandDiff.updates) {
        ops.push({ kind: 'quickCommandUpdate', command, saved: stableStringify(command) })
    }

    const groupDiff = diffById(store.quickCommandGroups, saved.quickCommandGroups)
    for (const id of groupDiff.deletes) {
        ops.push({ kind: 'quickCommandGroupDelete', id })
    }
    for (const group of groupDiff.creates) {
        ops.push({ kind: 'quickCommandGroupCreate', group, saved: stableStringify(group) })
    }
    for (const group of groupDiff.updates) {
        ops.push({ kind: 'quickCommandGroupUpdate', group, saved: stableStringify(group) })
    }

    // 配色以 name 为身份键（重命名 = 删旧建新，净效果等价）
    for (const name of new Set([...store.colorSchemes.map(scheme => scheme.name), ...Object.keys(saved.colorSchemes)])) {
        const scheme = store.colorSchemes.find(item => item.name === name)
        if (!scheme) {
            ops.push({ kind: 'colorSchemeDelete', name })
            continue
        }
        const encoded = stableStringify(scheme)
        if (encoded !== saved.colorSchemes[name]) {
            ops.push({ kind: 'colorSchemeSave', name, data: scheme, saved: encoded })
        }
    }

    return ops
}

/** 空基线：任何非空 store 与之 diff 都会产出全量导入操作（legacy 迁移用） */
export function emptyBaseline (): SavedBaseline {
    return { terminal: '', appearance: '', hotkeys: {}, profiles: {}, quickCommands: {}, quickCommandGroups: {}, colorSchemes: {} }
}

/**
 * @description 把当前 store 状态捕获为基线（各实体的稳定序列化快照）
 * @param store 待捕获的配置
 * @returns SavedBaseline 基线
 *
 * @example captureBaseline(defaultConfig()).terminal // stableStringify(默认 terminal)
 *
 */
export function captureBaseline (store: ConfigStore): SavedBaseline {
    return {
        terminal: stableStringify(store.terminal),
        appearance: stableStringify(store.appearance),
        hotkeys: Object.fromEntries(Object.entries(store.hotkeys).map(([action, bindings]) => [action, stableStringify(bindings)])),
        profiles: Object.fromEntries(store.profiles.map(profile => [profile.id, stableStringify(profile)])),
        quickCommands: Object.fromEntries(store.quickCommands.map(command => [command.id, stableStringify(command)])),
        quickCommandGroups: Object.fromEntries(store.quickCommandGroups.map(group => [group.id, stableStringify(group)])),
        colorSchemes: Object.fromEntries(store.colorSchemes.map(scheme => [scheme.name, stableStringify(scheme)])),
    }
}

/**
 * @description 执行一条持久化操作（调用对应 Rust 命令）
 * @param op 差异 flush 操作
 * @returns Promise<void>
 *
 */
async function runFlushOp (op: FlushOp): Promise<void> {
    switch (op.kind) {
        case 'settingsSection':
            await invoke('settings_set_section', { key: op.key, value: op.value })
            break
        case 'hotkey':
            await invoke('hotkey_set', { action: op.action, bindings: op.bindings })
            break
        case 'profileCreate':
            await invoke('profile_create', { profile: op.profile })
            break
        case 'profileUpdate':
            await invoke('profile_update', { profile: op.profile })
            break
        case 'profileDelete':
            await invoke('profile_delete', { id: op.id })
            break
        case 'quickCommandCreate':
            await invoke('quick_command_create', { command: op.command })
            break
        case 'quickCommandUpdate':
            await invoke('quick_command_update', { command: op.command })
            break
        case 'quickCommandDelete':
            await invoke('quick_command_delete', { id: op.id })
            break
        case 'quickCommandGroupCreate':
            await invoke('quick_command_group_create', { group: op.group })
            break
        case 'quickCommandGroupUpdate':
            await invoke('quick_command_group_update', { group: op.group })
            break
        case 'quickCommandGroupDelete':
            await invoke('quick_command_group_delete', { id: op.id })
            break
        case 'colorSchemeSave':
            await invoke('color_scheme_save', { name: op.name, data: op.data })
            break
        case 'colorSchemeDelete':
            await invoke('color_scheme_delete', { name: op.name })
            break
    }
}

/**
 * @description 把已成功执行的操作记入基线（后续 flush 只 diff 剩余差异；部分失败可安全重试）
 * @param saved 待更新的基线（原地修改）
 * @param op 已成功执行的操作
 * @returns void
 *
 */
function commitOp (saved: SavedBaseline, op: FlushOp): void {
    switch (op.kind) {
        case 'settingsSection':
            saved[op.key] = op.saved
            break
        case 'hotkey':
            saved.hotkeys[op.action] = op.saved
            break
        case 'profileCreate':
        case 'profileUpdate':
            saved.profiles[op.profile.id] = op.saved
            break
        case 'profileDelete':
            delete saved.profiles[op.id]
            break
        case 'quickCommandCreate':
        case 'quickCommandUpdate':
            saved.quickCommands[op.command.id] = op.saved
            break
        case 'quickCommandDelete':
            delete saved.quickCommands[op.id]
            break
        case 'quickCommandGroupCreate':
        case 'quickCommandGroupUpdate':
            saved.quickCommandGroups[op.group.id] = op.saved
            break
        case 'quickCommandGroupDelete':
            delete saved.quickCommandGroups[op.id]
            break
        case 'colorSchemeSave':
            saved.colorSchemes[op.name] = op.saved
            break
        case 'colorSchemeDelete':
            delete saved.colorSchemes[op.name]
            break
    }
}

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
    watch(() => [store.terminal, store.appearance, store.hotkeys, store.profiles, store.colorSchemes, store.quickCommands, store.quickCommandGroups] as const, () => scheduleSave(), { deep: true })

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
        // 首次运行/旧配置（用户配置无 profiles 键）：由 /etc/shells 生成默认档案并持久化；
        // 键存在（即使空数组）视为用户已管理，不再生成
        await generateProfilesIfAbsent(userConfig)
        if (migratedFromLegacy) {
            await flush()
            await invoke('config_archive_legacy_yaml').catch(error => console.error('could not archive legacy config', error))
        }
    }

    /**
     * @description 清理 SSH 档案上已废弃的明文敏感字段（旧版 yaml 遗留的 password/privateKeyPath——
     *              敏感数据已加密存 SQLite，不允许残留明文副本）
     * @returns void
     *
     * @example sanitizeProfiles()
     *
     */
    function sanitizeProfiles (): void {
        for (const profile of store.profiles) {
            if (profile.type !== 'ssh') {
                continue
            }
            const legacy = profile as Record<string, unknown>
            delete legacy.password
            delete legacy.privateKeyPath
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
     * @description 用户配置不含 profiles 键时，由系统 shell 列表生成默认档案（触发持久化）
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
            store.profiles = profilesFromShells(shells, store.terminal.loginShell)
        } catch (error) {
            console.error('could not generate default profiles', error)
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
    }    function getCSSFontFamily (): string {
        const font = store.terminal.font
        if (font === 'monospace' || !font) {
            return 'monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace'
        }
        return `"${font}", monospace`
    }

    return { store, load, reloadFromDisk, getCSSFontFamily, defaultProfile, setDefaultProfile }
})
