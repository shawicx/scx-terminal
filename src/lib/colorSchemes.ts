/**
 * @description 内置终端配色方案库：严格复刻 Tabby 候选主题列表——
 * Tabby Default / Tabby Default Light 两套核心默认配色（移植自 tabby-terminal
 * colorSchemes.ts，保留选区增强值）+ Tabby 官方社区配色全集（communityColorSchemes.ts，
 * 189 套）。并提供按用户偏好解析配色的工具函数，自定义配色经可选参数参与解析。
 */

import { communityColorSchemes } from './communityColorSchemes'

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
    name: 'Tabby Default',
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
    name: 'Tabby Default Light',
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

/** 全部内置配色 = Tabby 两套核心默认 + 社区全集（与默认重名的社区方案被剔除） */
export const builtinColorSchemes: TerminalColorScheme[] = [
    defaultDarkColorScheme,
    defaultLightColorScheme,
    ...communityColorSchemes.filter(scheme => scheme.name !== defaultDarkColorScheme.name && scheme.name !== defaultLightColorScheme.name),
]

/**
 * @description 按名称查找配色方案（自定义优先于内置）
 * @param name 配色方案名称（大小写敏感）
 * @param custom 用户自定义配色列表（可选）
 * @returns TerminalColorScheme | null 找到返回配色对象，否则返回 null
 *
 * @example findColorScheme('Argonaut') // => 社区配色 Argonaut
 * @example findColorScheme('Mine', [{ name: 'Mine', ... }]) // => 自定义配色
 *
 */
export function findColorScheme (name: string, custom?: TerminalColorScheme[]): TerminalColorScheme | null {
    const fromCustom = custom?.find(scheme => scheme.name === name)
    if (fromCustom) {
        return fromCustom
    }
    return builtinColorSchemes.find(scheme => scheme.name === name) ?? null
}

/**
 * @description 将用户配色偏好解析为具体配色方案。
 * 兼容旧配置值：'auto' 按系统深浅选默认配色；'dark'/'light' 选默认深/浅配色；
 * 其他值按配色名查找（自定义优先），找不到时回退系统深浅对应的默认配色。
 * @param preference 配置中的配色偏好（'auto' | 'dark' | 'light' | 配色名）
 * @param systemPrefersLight 操作系统当前是否为浅色外观
 * @param custom 用户自定义配色列表（可选）
 * @returns TerminalColorScheme 解析出的配色方案（总有值）
 *
 * @example resolveColorScheme('Argonaut', false) // => 社区配色 Argonaut
 * @example resolveColorScheme('auto', true)      // => Tabby Default Light
 *
 */
export function resolveColorScheme (
    preference: string,
    systemPrefersLight: boolean,
    custom?: TerminalColorScheme[],
): TerminalColorScheme {
    if (preference === 'dark') {
        return defaultDarkColorScheme
    }
    if (preference === 'light') {
        return defaultLightColorScheme
    }
    if (preference === 'auto') {
        return systemPrefersLight ? defaultLightColorScheme : defaultDarkColorScheme
    }
    return findColorScheme(preference, custom) ?? (systemPrefersLight ? defaultLightColorScheme : defaultDarkColorScheme)
}
