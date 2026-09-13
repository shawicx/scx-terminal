import { defineStore } from 'pinia'
import { nanoid } from 'nanoid'
import { reactive, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
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
    /** 私钥文件绝对路径（auth 含 publicKey/auto 时使用）；null = 未配置 */
    privateKeyPath: string | null
    /** 密码（明文存储于 config.yaml，UI 有风险提示）；null = 未配置 */
    password: string | null
    /** 档案专属配色名；null 跟随全局 */
    colorScheme: string | null
    isDefault: boolean
}

/** 终端配置档案：type 为判别字段（local 本地 shell / ssh 远程连接） */
export type TerminalProfile = LocalProfile | SshProfile

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
}

function defaultConfig (): ConfigStore {
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
            type: 'local',
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
            'pane-back': [['⌘-⌥-Left']],
            'copy': [['⌘-C']],
            'paste': [['⌘-V']],
            'clear': [['⌘-K']],
            'find': [['⌘-F']],
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
        'pane-back': [['Ctrl-Alt-Left']],
        'copy': [['Ctrl-Shift-C']],
        'paste': [['Ctrl-Shift-V']],
        'clear': [['Ctrl-Shift-K']],
        'find': [['Ctrl-Shift-F']],
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

/**
 * Reactive application configuration, persisted as YAML by the Rust side.
 * Writes are debounced; the file always contains a full snapshot merged over
 * defaults, so it stays hand-editable.
 */
export const useConfigStore = defineStore('config', () => {
    const store = reactive<ConfigStore>(defaultConfig())
    let loaded = false
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    let saving = false

    async function load (): Promise<void> {
        let userConfig: Record<string, unknown> | null = null
        try {
            const content = await invoke<string>('config_load')
            if (content.trim()) {
                userConfig = isPlainObject(parseYaml(content)) ? parseYaml(content) as Record<string, unknown> : null
                if (userConfig) {
                    deepMerge(store, userConfig)
                    store.hotkeys = normalizeHotkeysConfig(store.hotkeys)
                }
            }
        } catch (error) {
            console.error('could not load config', error)
        }
        loaded = true
        watch(store, () => scheduleSave(), { deep: true })
        // 首次运行/旧配置（用户配置无 profiles 键）：由 /etc/shells 生成默认档案并持久化；
        // 键存在（即使空数组）视为用户已管理，不再生成
        await generateProfilesIfAbsent(userConfig)
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

    function scheduleSave (): void {
        if (!loaded || saving) {
            return
        }
        if (saveTimer) {
            clearTimeout(saveTimer)
        }
        saveTimer = setTimeout(async () => {
            saveTimer = null
            saving = true
            try {
                await invoke('config_save', { content: stringifyYaml(store) })
            } catch (error) {
                console.error('could not save config', error)
            } finally {
                saving = false
            }
        }, 500)
    }

    async function reloadFromDisk (): Promise<void> {
        // used by tests / future external-change handling
        deepMerge(store, defaultConfig())
        const content = await invoke<string>('config_load')
        if (content.trim()) {
            deepMerge(store, parseYaml(content))
            store.hotkeys = normalizeHotkeysConfig(store.hotkeys)
        }
    }    function getCSSFontFamily (): string {
        const font = store.terminal.font
        if (font === 'monospace' || !font) {
            return 'monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace'
        }
        return `"${font}", monospace`
    }

    return { store, load, reloadFromDisk, getCSSFontFamily, defaultProfile, setDefaultProfile }
})
