export interface TerminalColorScheme {
    name: string
    foreground: string
    background: string
    cursor: string
    cursorAccent?: string
    selection?: string
    selectionForeground?: string
    colors: string[]
}

export const defaultDarkColorScheme: TerminalColorScheme = {
    name: 'scx-terminal Dark',
    foreground: '#cacaca',
    background: '#171717',
    cursor: '#bbbbbb',
    selection: '#444444aa',
    colors: [
        '#000000',
        '#ff615a',
        '#b1e969',
        '#ebd99c',
        '#5da9f6',
        '#e86aff',
        '#82fff7',
        '#dedacf',
        '#313131',
        '#f58c80',
        '#ddf88f',
        '#eee5b2',
        '#a5c7ff',
        '#ddaaff',
        '#b7fff9',
        '#ffffff',
    ],
}

export const defaultLightColorScheme: TerminalColorScheme = {
    name: 'scx-terminal Light',
    foreground: '#4d4d4c',
    background: '#ffffff',
    cursor: '#4d4d4c',
    selection: '#ccccccaa',
    colors: [
        '#000000',
        '#c82829',
        '#718c00',
        '#eab700',
        '#4271ae',
        '#8959a8',
        '#3e999f',
        '#ffffff',
        '#000000',
        '#c82829',
        '#718c00',
        '#eab700',
        '#4271ae',
        '#8959a8',
        '#3e999f',
        '#ffffff',
    ],
}
