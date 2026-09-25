/**
 * @description 差异 flush 引擎：把本地 store mutation 翻译成 Rust 侧实体级 CRUD 命令。
 *              基线 = 各实体键排序的稳定序列化快照；flush 只重试「当前状态与基线」
 *              的剩余差异，单条失败即中断且基线不动（部分成功可安全续传）。
 */
import { invoke } from '@tauri-apps/api/core'
import type { TerminalColorScheme as Scheme } from '@/lib/colorSchemes'
import { isPlainObject } from './defaults'
import type {
    AdvancedConfig, AppearanceConfig, ConfigStore, LocalGroup, MonitorConfig,
    QuickCommand, QuickCommandGroup, RecentsConfig, SshGroup, TabGroup, TerminalConfig,
    TerminalProfile,
} from './types'

/** 上次已持久化状态的基线（各实体存键排序后的稳定序列化串，用于 diff） */
export interface SavedBaseline {
    terminal: string
    appearance: string
    advanced: string
    recents: string
    monitor: string
    hotkeys: Record<string, string>
    profiles: Record<string, string>
    quickCommands: Record<string, string>
    quickCommandGroups: Record<string, string>
    localGroups: Record<string, string>
    sshGroups: Record<string, string>
    tabGroups: Record<string, string>
    colorSchemes: Record<string, string>
}

/** 一条待执行的持久化操作；saved 为该实体写入成功后记入基线的快照串 */
export type FlushOp =
    | { kind: 'settingsSection'; key: 'terminal' | 'appearance' | 'advanced' | 'recents' | 'monitor'; value: TerminalConfig | AppearanceConfig | AdvancedConfig | RecentsConfig | MonitorConfig; saved: string }
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
    | { kind: 'localGroupCreate'; group: LocalGroup; saved: string }
    | { kind: 'localGroupUpdate'; group: LocalGroup; saved: string }
    | { kind: 'localGroupDelete'; id: string }
    | { kind: 'sshGroupCreate'; group: SshGroup; saved: string }
    | { kind: 'sshGroupUpdate'; group: SshGroup; saved: string }
    | { kind: 'sshGroupDelete'; id: string }
    | { kind: 'tabGroupCreate'; group: TabGroup; saved: string }
    | { kind: 'tabGroupUpdate'; group: TabGroup; saved: string }
    | { kind: 'tabGroupDelete'; id: string }
    | { kind: 'colorSchemeSave'; name: string; data: Scheme; saved: string }
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
    const advanced = stableStringify(store.advanced)
    if (advanced !== saved.advanced) {
        ops.push({ kind: 'settingsSection', key: 'advanced', value: store.advanced, saved: advanced })
    }
    const recents = stableStringify(store.recents)
    if (recents !== saved.recents) {
        ops.push({ kind: 'settingsSection', key: 'recents', value: store.recents, saved: recents })
    }
    const monitor = stableStringify(store.monitor)
    if (monitor !== saved.monitor) {
        ops.push({ kind: 'settingsSection', key: 'monitor', value: store.monitor, saved: monitor })
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

    const localGroupDiff = diffById(store.localGroups, saved.localGroups)
    for (const id of localGroupDiff.deletes) {
        ops.push({ kind: 'localGroupDelete', id })
    }
    for (const group of localGroupDiff.creates) {
        ops.push({ kind: 'localGroupCreate', group, saved: stableStringify(group) })
    }
    for (const group of localGroupDiff.updates) {
        ops.push({ kind: 'localGroupUpdate', group, saved: stableStringify(group) })
    }

    const sshGroupDiff = diffById(store.sshGroups, saved.sshGroups)
    for (const id of sshGroupDiff.deletes) {
        ops.push({ kind: 'sshGroupDelete', id })
    }
    for (const group of sshGroupDiff.creates) {
        ops.push({ kind: 'sshGroupCreate', group, saved: stableStringify(group) })
    }
    for (const group of sshGroupDiff.updates) {
        ops.push({ kind: 'sshGroupUpdate', group, saved: stableStringify(group) })
    }

    const tabGroupDiff = diffById(store.tabGroups, saved.tabGroups)
    for (const id of tabGroupDiff.deletes) {
        ops.push({ kind: 'tabGroupDelete', id })
    }
    for (const group of tabGroupDiff.creates) {
        ops.push({ kind: 'tabGroupCreate', group, saved: stableStringify(group) })
    }
    for (const group of tabGroupDiff.updates) {
        ops.push({ kind: 'tabGroupUpdate', group, saved: stableStringify(group) })
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
    return { terminal: '', appearance: '', advanced: '', recents: '', monitor: '', hotkeys: {}, profiles: {}, quickCommands: {}, quickCommandGroups: {}, localGroups: {}, sshGroups: {}, tabGroups: {}, colorSchemes: {} }
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
        advanced: stableStringify(store.advanced),
        recents: stableStringify(store.recents),
        monitor: stableStringify(store.monitor),
        hotkeys: Object.fromEntries(Object.entries(store.hotkeys).map(([action, bindings]) => [action, stableStringify(bindings)])),
        profiles: Object.fromEntries(store.profiles.map(profile => [profile.id, stableStringify(profile)])),
        quickCommands: Object.fromEntries(store.quickCommands.map(command => [command.id, stableStringify(command)])),
        quickCommandGroups: Object.fromEntries(store.quickCommandGroups.map(group => [group.id, stableStringify(group)])),
        localGroups: Object.fromEntries(store.localGroups.map(group => [group.id, stableStringify(group)])),
        sshGroups: Object.fromEntries(store.sshGroups.map(group => [group.id, stableStringify(group)])),
        tabGroups: Object.fromEntries(store.tabGroups.map(group => [group.id, stableStringify(group)])),
        colorSchemes: Object.fromEntries(store.colorSchemes.map(scheme => [scheme.name, stableStringify(scheme)])),
    }
}

/**
 * @description 执行一条持久化操作（调用对应 Rust 命令）
 * @param op 差异 flush 操作
 * @returns Promise<void>
 *
 */
export async function runFlushOp (op: FlushOp): Promise<void> {
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
        case 'localGroupCreate':
            await invoke('local_group_create', { group: op.group })
            break
        case 'localGroupUpdate':
            await invoke('local_group_update', { group: op.group })
            break
        case 'localGroupDelete':
            await invoke('local_group_delete', { id: op.id })
            break
        case 'sshGroupCreate':
            await invoke('ssh_group_create', { group: op.group })
            break
        case 'sshGroupUpdate':
            await invoke('ssh_group_update', { group: op.group })
            break
        case 'sshGroupDelete':
            await invoke('ssh_group_delete', { id: op.id })
            break
        case 'tabGroupCreate':
            await invoke('tab_group_create', { group: op.group })
            break
        case 'tabGroupUpdate':
            await invoke('tab_group_update', { group: op.group })
            break
        case 'tabGroupDelete':
            await invoke('tab_group_delete', { id: op.id })
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
export function commitOp (saved: SavedBaseline, op: FlushOp): void {
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
        case 'localGroupCreate':
        case 'localGroupUpdate':
            saved.localGroups[op.group.id] = op.saved
            break
        case 'localGroupDelete':
            delete saved.localGroups[op.id]
            break
        case 'sshGroupCreate':
        case 'sshGroupUpdate':
            saved.sshGroups[op.group.id] = op.saved
            break
        case 'sshGroupDelete':
            delete saved.sshGroups[op.id]
            break
        case 'tabGroupCreate':
        case 'tabGroupUpdate':
            saved.tabGroups[op.group.id] = op.saved
            break
        case 'tabGroupDelete':
            delete saved.tabGroups[op.id]
            break
        case 'colorSchemeSave':
            saved.colorSchemes[op.name] = op.saved
            break
        case 'colorSchemeDelete':
            delete saved.colorSchemes[op.name]
            break
    }
}
