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
