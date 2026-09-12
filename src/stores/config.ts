import { defineStore } from 'pinia'
import { reactive, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { platform } from '@/lib/platform'

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
}

export interface AppearanceConfig {
    colorScheme: 'auto' | 'light' | 'dark'
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
        },
        appearance: {
            colorScheme: 'auto',
            tabBarPosition: 'top',
            theme: 'auto',
            language: 'auto',
        },
        hotkeys: defaultHotkeys(),
    }
}

function defaultHotkeys (): HotkeysConfig {
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
            'close-pane': [['⌘-Alt-W']],
            'pane-forward': [['⌘-⌥-ArrowRight']],
            'pane-back': [['⌘-⌥-ArrowLeft']],
            'copy': [['⌘-C']],
            'paste': [['⌘-V']],
            'clear': [['⌘-K']],
            'find': [['⌘-F']],
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
        try {
            const content = await invoke<string>('config_load')
            if (content.trim()) {
                deepMerge(store, parseYaml(content))
            }
        } catch (error) {
            console.error('could not load config', error)
        }
        loaded = true
        watch(store, () => scheduleSave(), { deep: true })
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
        }
    }

    function getCSSFontFamily (): string {
        const font = store.terminal.font
        if (font === 'monospace' || !font) {
            return 'monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace'
        }
        return `"${font}", monospace`
    }

    return { store, load, reloadFromDisk, getCSSFontFamily }
})
