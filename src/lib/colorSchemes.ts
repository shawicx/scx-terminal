/**
 * @description 内置终端配色方案库：默认深/浅两套 + 一批 Tabby 常用配色
 * （Dracula、Nord、Solarized、One Dark、Gruvbox、Monokai、Tokyo Night、
 * Catppuccin Mocha、Campbell、Ubuntu 等），并提供按用户偏好解析配色的工具函数。
 */

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

const dracula: TerminalColorScheme = {
    name: 'Dracula',
    foreground: '#f8f8f2',
    background: '#282a36',
    cursor: '#f8f8f2',
    selection: '#44475acc',
    colors: [
        '#000000',
        '#ff5555',
        '#50fa7b',
        '#f1fa8c',
        '#bd93f9',
        '#ff79c6',
        '#8be9fd',
        '#bfbfbf',
        '#4d4d4d',
        '#ff6e67',
        '#5af78e',
        '#f4f99d',
        '#caa9fa',
        '#ff92d0',
        '#9aedfe',
        '#e6e6e6',
    ],
}

const nord: TerminalColorScheme = {
    name: 'Nord',
    foreground: '#d8dee9',
    background: '#2e3440',
    cursor: '#d8dee9',
    selection: '#434c5ecc',
    colors: [
        '#3b4252',
        '#bf616a',
        '#a3be8c',
        '#ebcb8b',
        '#81a1c1',
        '#b48ead',
        '#88c0d0',
        '#e5e9f0',
        '#4c566a',
        '#bf616a',
        '#a3be8c',
        '#ebcb8b',
        '#81a1c1',
        '#b48ead',
        '#8fbcbb',
        '#eceff4',
    ],
}

const solarizedDark: TerminalColorScheme = {
    name: 'Solarized Dark',
    foreground: '#839496',
    background: '#002b36',
    cursor: '#93a1a1',
    selection: '#274642cc',
    colors: [
        '#073642',
        '#dc322f',
        '#859900',
        '#b58900',
        '#268bd2',
        '#d33682',
        '#2aa198',
        '#eee8d5',
        '#002b36',
        '#cb4b16',
        '#586e75',
        '#657b83',
        '#839496',
        '#6c71c4',
        '#93a1a1',
        '#fdf6e3',
    ],
}

const solarizedLight: TerminalColorScheme = {
    name: 'Solarized Light',
    foreground: '#657b83',
    background: '#fdf6e3',
    cursor: '#586e75',
    selection: '#ece6d5cc',
    colors: [
        '#073642',
        '#dc322f',
        '#859900',
        '#b58900',
        '#268bd2',
        '#d33682',
        '#2aa198',
        '#eee8d5',
        '#002b36',
        '#cb4b16',
        '#586e75',
        '#657b83',
        '#839496',
        '#6c71c4',
        '#93a1a1',
        '#fdf6e3',
    ],
}

const oneDark: TerminalColorScheme = {
    name: 'One Dark',
    foreground: '#abb2bf',
    background: '#282c34',
    cursor: '#528bff',
    selection: '#3e4451cc',
    colors: [
        '#282c34',
        '#e06c75',
        '#98c379',
        '#e5c07b',
        '#61afef',
        '#c678dd',
        '#56b6c2',
        '#abb2bf',
        '#5c6370',
        '#e06c75',
        '#98c379',
        '#e5c07b',
        '#61afef',
        '#c678dd',
        '#56b6c2',
        '#ffffff',
    ],
}

const oneLight: TerminalColorScheme = {
    name: 'One Light',
    foreground: '#383a42',
    background: '#fafafa',
    cursor: '#526fff',
    selection: '#e5e5e5cc',
    colors: [
        '#383a42',
        '#e45649',
        '#50a14f',
        '#c18401',
        '#4078f2',
        '#a626a4',
        '#0184bc',
        '#fafafa',
        '#4f525e',
        '#e06c75',
        '#98c379',
        '#e5c07b',
        '#61afef',
        '#c678dd',
        '#56b6c2',
        '#ffffff',
    ],
}

const gruvboxDark: TerminalColorScheme = {
    name: 'Gruvbox Dark',
    foreground: '#ebdbb2',
    background: '#282828',
    cursor: '#ebdbb2',
    selection: '#32302fcc',
    colors: [
        '#282828',
        '#cc241d',
        '#98971a',
        '#d79921',
        '#458588',
        '#b16286',
        '#689d6a',
        '#a89984',
        '#928374',
        '#fb4934',
        '#b8bb26',
        '#fabd2f',
        '#83a598',
        '#d3869b',
        '#8ec07c',
        '#ebdbb2',
    ],
}

const monokai: TerminalColorScheme = {
    name: 'Monokai',
    foreground: '#f8f8f2',
    background: '#272822',
    cursor: '#f8f8f0',
    selection: '#49483ecc',
    colors: [
        '#272822',
        '#f92672',
        '#a6e22e',
        '#f4bf75',
        '#66d9ef',
        '#ae81ff',
        '#a1efe4',
        '#f8f8f2',
        '#75715e',
        '#f92672',
        '#a6e22e',
        '#f4bf75',
        '#66d9ef',
        '#ae81ff',
        '#a1efe4',
        '#f9f8f5',
    ],
}

const tokyoNight: TerminalColorScheme = {
    name: 'Tokyo Night',
    foreground: '#a9b1d6',
    background: '#1a1b26',
    cursor: '#c0caf5',
    selection: '#33467ccc',
    colors: [
        '#15161e',
        '#f7768e',
        '#9ece6a',
        '#e0af68',
        '#7aa2f7',
        '#bb9af7',
        '#7dcfff',
        '#a9b1d6',
        '#414868',
        '#f7768e',
        '#9ece6a',
        '#e0af68',
        '#7aa2f7',
        '#bb9af7',
        '#7dcfff',
        '#c0caf5',
    ],
}

const catppuccinMocha: TerminalColorScheme = {
    name: 'Catppuccin Mocha',
    foreground: '#cdd6f4',
    background: '#1e1e2e',
    cursor: '#f5e0dc',
    selection: '#585b7099',
    colors: [
        '#45475a',
        '#f38ba8',
        '#a6e3a1',
        '#f9e2af',
        '#89b4fa',
        '#f5c2e7',
        '#94e2d5',
        '#bac2de',
        '#585b70',
        '#f38ba8',
        '#a6e3a1',
        '#f9e2af',
        '#89b4fa',
        '#f5c2e7',
        '#94e2d5',
        '#a6adc8',
    ],
}

const campbell: TerminalColorScheme = {
    name: 'Campbell',
    foreground: '#cccccc',
    background: '#0c0c0c',
    cursor: '#cccccc',
    selection: '#cccccc55',
    colors: [
        '#0c0c0c',
        '#c50f1f',
        '#13a10e',
        '#c19c00',
        '#0037da',
        '#881798',
        '#3a96dd',
        '#cccccc',
        '#767676',
        '#e74856',
        '#16c60c',
        '#f9f1a5',
        '#3b78ff',
        '#b4009e',
        '#61d6d6',
        '#f2f2f2',
    ],
}

const ubuntu: TerminalColorScheme = {
    name: 'Ubuntu',
    foreground: '#eeeeec',
    background: '#300a24',
    cursor: '#bbbbbb',
    selection: '#5c5c5ccc',
    colors: [
        '#2e3436',
        '#cc0000',
        '#4e9a06',
        '#c4a000',
        '#3465a4',
        '#75507b',
        '#06989a',
        '#d3d7cf',
        '#555753',
        '#ef2929',
        '#8ae234',
        '#fce94f',
        '#729fcf',
        '#ad7fa8',
        '#34e2e2',
        '#eeeeec',
    ],
}

const snazzy: TerminalColorScheme = {
    name: 'Snazzy',
    foreground: '#eff0eb',
    background: '#282a36',
    cursor: '#97979b',
    selection: '#57c7ff33',
    colors: [
        '#282a36',
        '#ff5c57',
        '#5af78e',
        '#f3f99d',
        '#57c7ff',
        '#ff6ac1',
        '#9aedfe',
        '#f1f1f0',
        '#686868',
        '#ff5c57',
        '#5af78e',
        '#f3f99d',
        '#57c7ff',
        '#ff6ac1',
        '#9aedfe',
        '#eff0eb',
    ],
}

const base16DefaultDark: TerminalColorScheme = {
    name: 'Base16 Default Dark',
    foreground: '#d8d8d8',
    background: '#181818',
    cursor: '#d8d8d8',
    selection: '#383838cc',
    colors: [
        '#181818',
        '#ab4642',
        '#a1b56c',
        '#f7ca88',
        '#7cafc2',
        '#ba8baf',
        '#86c1b9',
        '#d8d8d8',
        '#585858',
        '#dc9656',
        '#a1b56c',
        '#f7ca88',
        '#7cafc2',
        '#ba8baf',
        '#86c1b9',
        '#f8f8f8',
    ],
}

/** 全部内置配色，按设置页展示顺序排列 */
export const builtinColorSchemes: TerminalColorScheme[] = [
    defaultDarkColorScheme,
    defaultLightColorScheme,
    dracula,
    nord,
    solarizedDark,
    solarizedLight,
    oneDark,
    oneLight,
    gruvboxDark,
    monokai,
    tokyoNight,
    catppuccinMocha,
    campbell,
    ubuntu,
    snazzy,
    base16DefaultDark,
]

/**
 * @description 按名称查找内置配色方案
 * @param name 配色方案名称（大小写敏感）
 * @returns TerminalColorScheme | null 找到返回配色对象，否则返回 null
 *
 * @example findColorScheme('Dracula') // => Dracula 配色对象
 */
export function findColorScheme (name: string): TerminalColorScheme | null {
    return builtinColorSchemes.find(scheme => scheme.name === name) ?? null
}

/**
 * @description 将用户配色偏好解析为具体配色方案。
 * 兼容旧配置值：'auto' 按系统深浅选默认配色；'dark'/'light' 选默认深/浅配色；
 * 其他值按配色名在内置库中查找，找不到时回退系统深浅对应的默认配色。
 * @param preference 配置中的配色偏好（'auto' | 'dark' | 'light' | 配色名）
 * @param systemPrefersLight 操作系统当前是否为浅色外观
 * @returns TerminalColorScheme 解析出的配色方案（总有值）
 *
 * @example resolveColorScheme('Dracula', false) // => Dracula 配色
 * @example resolveColorScheme('auto', true)     // => scx-terminal Light
 */
export function resolveColorScheme (preference: string, systemPrefersLight: boolean): TerminalColorScheme {
    if (preference === 'dark') {
        return defaultDarkColorScheme
    }
    if (preference === 'light') {
        return defaultLightColorScheme
    }
    if (preference === 'auto') {
        return systemPrefersLight ? defaultLightColorScheme : defaultDarkColorScheme
    }
    return findColorScheme(preference) ?? (systemPrefersLight ? defaultLightColorScheme : defaultDarkColorScheme)
}
