/**
 * @description 配置默认值与纯函数助手：默认配置/热键、系统 shell 生成本地分组与
 *              档案、存量迁移、分组分段视图、最近记录 upsert 与 deepMerge。
 */
import { nanoid } from 'nanoid'
import { platform } from '@/lib/platform'
import type { Shell } from '@/services/shells'
import type {
    ConfigStore, HotkeysConfig, LocalGroup, LocalProfile, RecentsConfig, TerminalProfile,
} from './types'

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
            suggestions: {
                enabled: true,
                trigger: 'auto',
                delay: 200,
                sources: { history: true, quickCommands: true, paths: true },
            },
        },
        appearance: {
            colorScheme: 'auto',
            tabBarPosition: 'top',
            theme: 'auto',
            language: 'auto',
            backgroundImage: null,
            backgroundOpacity: 0.6,
            backgroundFit: 'cover',
            bellNotifications: true,
        },
        advanced: {
            debugEnabled: false,
        },
        recents: {} as RecentsConfig,
        monitor: { open: false, width: 320 },
        profiles: [],
        localGroups: [],
        sshGroups: [],
        tabGroups: [],
        colorSchemes: [],
        quickCommands: [],
        quickCommandGroups: [],
        hotkeys: defaultHotkeys(),
    }
}

/**
 * @description 默认分组 id：按 shell id 确定性生成（首次生成与存量迁移共用，保证幂等）
 * @param shellId Rust list_shells 返回的 shell id
 * @returns string 分组 id
 *
 * @example localGroupIdFor('zsh') // 'localgroup-zsh'
 *
 */
export function localGroupIdFor (shellId: string): string {
    return `localgroup-${shellId}`
}

/**
 * @description 由系统 shell 列表生成本地档案默认分组：每 shell 一组（builtin），默认
 *              shell 的组置顶，其余按 /etc/shells 顺序
 * @param shells Rust list_shells 返回的 shell 列表
 * @returns LocalGroup[] 默认分组列表（默认 shell 的组在首位）
 *
 * @example localGroupsFromShells([{ id: 'bash' }, { id: 'zsh', default: true }])[0].name // 'zsh'
 *
 */
export function localGroupsFromShells (shells: Shell[]): LocalGroup[] {
    return defaultShellFirst(shells).map(shell => ({
        id: localGroupIdFor(shell.id),
        name: shell.name,
        builtin: true,
    }))
}

/** shells 排序副本：默认 shell 置顶，其余保持 /etc/shells 顺序（生成分组/迁移共用） */
function defaultShellFirst (shells: Shell[]): Shell[] {
    const index = shells.findIndex(shell => shell.default)
    if (index <= 0) {
        return [...shells]
    }
    const sorted = [...shells]
    const [defaultShell] = sorted.splice(index, 1)
    sorted.unshift(defaultShell!)
    return sorted
}

/**
 * @description 由系统 shell 列表生成默认的 local 配置档案：每 shell 一个预置档案
 *              （builtin + 归入对应默认分组），默认 shell 档案置顶且标 isDefault
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
            builtin: true,
            groupId: localGroupIdFor(shell.id),
        }
    })
    return defaultFirstProfiles(profiles)
}

/**
 * @description 存量平铺档案迁移进分组模型（localGroups 键不存在时于 load() 触发一次）：
 *              按 id 前缀 `local-{shellId}-` + command 双条件识别首次自动生成的档案，
 *              标 builtin 并归入对应默认分组；某 shell 的自动档案已不存在则补建全新
 *              预置档案；自建档案保持未分组；isDefault 标记原样保留
 * @param profiles 现有全部档案（取其中 local 类型，入参不被修改）
 * @param shells Rust list_shells 返回的 shell 列表
 * @param loginShell 补建档案的登录 shell 开关（取全局 terminal.loginShell 当前值）
 * @returns { groups: LocalGroup[], profiles: LocalProfile[] } 迁移后的分组与本地档案
 *
 * @example migrateLocalGroups([], [{ id: 'zsh', name: 'zsh', command: '/bin/zsh', args: [], default: true }], true).profiles[0].builtin // true
 *
 */
export function migrateLocalGroups (profiles: TerminalProfile[], shells: Shell[], loginShell: boolean): { groups: LocalGroup[], profiles: TerminalProfile[] } {
    const groups = localGroupsFromShells(shells)
    const nextProfiles: TerminalProfile[] = []
    for (const profile of profiles) {
        if (profile.type !== 'local') {
            nextProfiles.push(profile)
            continue
        }
        const shell = shells.find(candidate =>
            profile.id.startsWith(`local-${candidate.id}-`) && profile.command === candidate.command)
        if (shell) {
            nextProfiles.push({ ...profile, builtin: true, groupId: localGroupIdFor(shell.id) })
        } else {
            nextProfiles.push(profile)
        }
    }
    const missing = defaultShellFirst(shells).filter(shell =>
        !nextProfiles.some(profile => profile.type === 'local' && profile.groupId === localGroupIdFor(shell.id)))
    if (missing.length > 0) {
        const rebuilt = profilesFromShells(missing, loginShell).map(profile =>
            ({ ...profile, isDefault: false }) as LocalProfile)
        nextProfiles.push(...rebuilt)
    }
    return { groups, profiles: nextProfiles }
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

/** 设置页本地档案分段视图（默认分组置顶 + 各分组定义序） */
export interface LocalProfileSection {
    group: LocalGroup | null
    profiles: LocalProfile[]
}

/**
 * @description 把本地档案按分组整理为分段列表：未分组段以「默认分组」语义置顶
 *              （对齐 SSH 页 buildGroupViews 的默认分组置顶；空则不出现），其后各
 *              分组按定义序（默认分组生成在先、自定义组在后）；段内档案保持传入顺序
 * @param profiles 本地档案列表
 * @param groups 本地分组列表（config 顺序）
 * @returns LocalProfileSection[] 分段列表
 *
 * @example groupLocalProfiles([{ groupId: 'g' }], [{ id: 'g', name: 'zsh', builtin: true }])[0].group // null（默认分组）
 *
 */
export function groupLocalProfiles (profiles: LocalProfile[], groups: LocalGroup[]): LocalProfileSection[] {
    const sections: LocalProfileSection[] = groups.map(group => ({ group, profiles: [] }))
    const index = new Map(sections.map(section => [section.group!.id, section]))
    const ungrouped: LocalProfile[] = []
    for (const profile of profiles) {
        const section = profile.groupId ? index.get(profile.groupId) : undefined
        if (section) {
            section.profiles.push(profile)
        } else {
            ungrouped.push(profile)
        }
    }
    if (ungrouped.length > 0) {
        sections.unshift({ group: null, profiles: ungrouped })
    }
    return sections
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
            // Ctrl-Space 被 macOS 输入法切换占用，mac 用 ⌥Space
            'suggestions-trigger': [['⌥-Space']],
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
        'suggestions-trigger': [['Ctrl-Space']],
        'quick-commands-palette': [['Ctrl-Shift-R']],
        'copy-current-path': [],
    }
}

/**
 * @description 当前平台新建档案的默认 shell 命令（macOS/Linux 兜底 zsh，Windows 兜底 PowerShell——
 *              /bin/* 路径在 Windows 上不存在，spawn 必败）
 * @returns string shell 命令
 *
 * @example defaultShellCommand() // windows: 'powershell.exe'；mac: '/bin/zsh'
 *
 */
export function defaultShellCommand (): string {
    return platform === 'windows' ? 'powershell.exe' : '/bin/zsh'
}

/**
 * @description 档案均不可用时的兜底档案（macOS 保证 /bin/zsh 存在；Windows 用 PowerShell），保证终端窗格永远能启动
 * @returns LocalProfile 兜底档案
 *
 * @example fallbackProfile().command // mac: '/bin/zsh'；windows: 'powershell.exe'
 *
 */
export function fallbackProfile (): LocalProfile {
    return {
        id: 'local-fallback',
        type: 'local',
        name: platform === 'windows' ? 'PowerShell' : 'zsh',
        command: defaultShellCommand(),
        args: [],
        env: {},
        cwd: null,
        colorScheme: null,
        loginShell: true,
        isDefault: true,
        builtin: true,
    }
}

/**
 * @description upsert 一条最近连接记录并裁剪到上限（保留时间最新的 cap 条）
 * @param recents 现有记录
 * @param profileId 档案 id
 * @param now 当前时间（epoch 毫秒）
 * @param cap 保留上限
 * @returns RecentsConfig 新记录对象（不修改入参）
 *
 * @example upsertRecentEntry({ a: 1 }, 'b', 2) // { a: 1, b: 2 }
 *
 */
export function upsertRecentEntry (recents: RecentsConfig, profileId: string, now: number, cap = 50): RecentsConfig {
    const next = { ...recents, [profileId]: now }
    const ids = Object.keys(next)
    if (ids.length <= cap) {
        return next
    }
    const keep = new Set(ids.sort((a, b) => next[b]! - next[a]!).slice(0, cap))
    return Object.fromEntries(ids.filter(id => keep.has(id)).map(id => [id, next[id]!]))
}

export function isPlainObject (value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** deep-merges user values over defaults; defaults fill any gap. null 视为未提供
 *  （Rust 快照会把未持久化的设置分片序列化为 null，不能用 null 覆盖默认值） */
export function deepMerge<T> (target: T, source: unknown): T {
    if (!isPlainObject(target) || !isPlainObject(source)) {
        return (source === undefined || source === null ? target : source) as T
    }
    for (const [key, value] of Object.entries(source)) {
        if (key in target) {
            ;(target as Record<string, unknown>)[key] = deepMerge((target as Record<string, unknown>)[key], value)
        }
    }
    return target
}
