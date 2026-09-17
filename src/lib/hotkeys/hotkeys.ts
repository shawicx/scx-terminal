import { platform } from '@/lib/platform'

/** Hotkey key-name utilities, ported from tabby-core/src/services/hotkeys.util.ts. */

export const metaKeyName = {
    darwin: '⌘',
    win32: 'Win',
    linux: 'Super',
}[platform === 'macos' ? 'darwin' : platform === 'windows' ? 'win32' : 'linux']!

export const altKeyName = {
    darwin: '⌥',
    win32: 'Alt',
    linux: 'Alt',
}[platform === 'macos' ? 'darwin' : platform === 'windows' ? 'win32' : 'linux']!

export interface KeyEventData {
    ctrlKey?: boolean
    metaKey?: boolean
    altKey?: boolean
    shiftKey?: boolean
    key?: string
    code?: string
    deltaX?: number
    deltaY?: number
    button?: number
    eventName: string
    time: number
    registrationTime: number
}

const REGEX_LATIN_KEYNAME = /^[A-Za-z]$/

const CODE_TO_CHAR: Record<string, string> = {
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    IntlBackslash: '`',
    Minus: '-',
    Equal: '=',
    Semicolon: ';',
    Quote: '\'',
    BracketLeft: '[',
    BracketRight: ']',
}

export type KeyName = string
export type Keystroke = string

export function getKeyName (event: KeyEventData): KeyName {
    if (event.eventName === 'mouseup' || event.eventName === 'auxclick') {
        if (event.button === 1) {
            return 'MiddleClick'
        }
        return 'Mouse'
    }

    if (event.eventName === 'wheel') {
        const deltaX = event.deltaX ?? 0
        const deltaY = event.deltaY ?? 0
        if (Math.abs(deltaY) >= Math.abs(deltaX) && deltaY !== 0) {
            return deltaY < 0 ? 'WheelUp' : 'WheelDown'
        }
        if (deltaX !== 0) {
            return deltaX < 0 ? 'WheelLeft' : 'WheelRight'
        }
        return 'Wheel'
    }

    let key: string
    if (event.key === 'Control') {
        key = 'Ctrl'
    } else if (event.key === 'Meta') {
        key = metaKeyName
    } else if (event.key === 'Alt') {
        key = altKeyName
    } else if (event.key === 'Shift') {
        key = 'Shift'
    } else if (event.key === '`') {
        key = '`'
    } else if (event.key === '~') {
        key = '~'
    } else {
        key = event.code ?? ''
        if (event.key && REGEX_LATIN_KEYNAME.test(event.key)) {
            // Handle Dvorak etc via the reported "character" instead of the scancode
            key = event.key.toUpperCase()
        } else {
            key = key.replace('Key', '')
            key = key.replace('Arrow', '')
            key = key.replace('Digit', '')
            key = CODE_TO_CHAR[key] ?? key
        }
    }
    return key
}

export function getKeystrokeName (keys: KeyName[]): Keystroke {
    const strictOrdering: KeyName[] = ['Ctrl', metaKeyName, altKeyName, 'Shift']
    keys = [
        ...strictOrdering.map(x => keys.find(k => k === x)).filter(x => !!x) as KeyName[],
        ...keys.filter(k => !strictOrdering.includes(k)),
    ]
    return keys.join('-')
}

/** Parses a user-facing keystroke string ("⌘-Shift-P" / "Ctrl-K") into parts. */
export function parseKeystroke (keystroke: string): KeyName[] {
    return keystroke.split('-').map(part => part.trim()).filter(part => part.length > 0)
}

const ARROW_KEY_ALIASES: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
}

/**
 * @description 将热键序列中的键名归一化为 getKeyName 的实际产出形式，兼容手写/旧配置中的别名写法
 * @param name 单个键名（如 "ArrowRight"、"Alt"、"Meta"、"KeyA"）
 * @returns string 归一化后的键名（如 "Right"、平台 Alt 键名、平台 Meta 键名、"A"）
 *
 * @example normalizeKeyName('ArrowRight') // 'Right'
 * @example normalizeKeyName('KeyA') // 'A'
 *
 */
export function normalizeKeyName (name: string): KeyName {
    const part = name.trim()
    if (part.length === 0) {
        return part
    }
    if (part in ARROW_KEY_ALIASES) {
        return ARROW_KEY_ALIASES[part]
    }
    if (part === 'Alt') {
        return altKeyName
    }
    if (part === 'Meta' || part === 'Cmd' || part === 'Command' || part === 'Super' || part === 'Win') {
        return metaKeyName
    }
    if (/^Key[A-Za-z]$/.test(part)) {
        return part.slice(3).toUpperCase()
    }
    if (/^Digit\d$/.test(part)) {
        return part.slice(5)
    }
    return part
}

/**
 * @description 归一化整份热键配置的全部按键序列（每个按键串拆分后逐键走 normalizeKeyName 再重组）
 * @param hotkeys 热键配置（hotkey id -> 序列列表，序列元素为 "⌘-⌥-Right" 形式的按键串）
 * @returns 同结构的新对象，按键串中的键名已归一化
 *
 * @example normalizeHotkeysConfig({ 'pane-forward': [['⌘-⌥-ArrowRight']] }) // { 'pane-forward': [['⌘-⌥-Right']] }
 *
 */
export function normalizeHotkeysConfig<T extends Record<string, string[][]>> (hotkeys: T): T {
    const result: Record<string, string[][]> = {}
    for (const [id, sequences] of Object.entries(hotkeys)) {
        result[id] = sequences.map(sequence =>
            sequence.map(keystroke => parseKeystroke(keystroke).map(normalizeKeyName).join('-')),
        )
    }
    return result as T
}

const MAC_KEY_SYMBOLS: Record<string, string> = {
    [metaKeyName]: '⌘',
    [altKeyName]: '⌥',
    Shift: '⇧',
    Ctrl: '⌃',
    Up: '↑',
    Down: '↓',
    Left: '←',
    Right: '→',
    Enter: '↵',
    Escape: '⎋',
    Backspace: '⌫',
    Delete: '⌦',
    Tab: '⇥',
}

/**
 * @description 将按键串格式化为用户友好的显示文本（macOS 以符号紧凑拼接，其余平台以 + 连接）
 * @param keystroke 按键串（如 "⌘-Shift-P"，即 parseKeystroke 可解析的形式）
 * @returns string 显示文本（如 "⌘⇧P"；Windows/Linux 下 "Ctrl+Shift+P"）
 *
 * @example formatKeystrokeForDisplay('⌘-Shift-P') // '⌘⇧P'
 *
 */
export function formatKeystrokeForDisplay (keystroke: string): string {
    const keys = parseKeystroke(keystroke)
    if (platform === 'macos') {
        return keys.map(key => MAC_KEY_SYMBOLS[key] ?? key).join('')
    }
    return keys.join('+')
}
