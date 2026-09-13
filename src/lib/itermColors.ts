/**
 * @description iTerm2 .itermcolors 配色文件解析器：从 XML plist 文本中提取
 * Ansi 0..15 / Background / Foreground / Cursor / Cursor Text / Selection /
 * Selected Text 颜色（Red/Green/Blue Component 为 0-1 浮点分量），转换为
 * TerminalColorScheme。纯字符串解析，无 DOM 依赖，缺失字段回退默认深色值。
 */
import type { TerminalColorScheme } from './colorSchemes'
import { defaultDarkColorScheme } from './colorSchemes'

/** iTerm2 plist 中颜色字典的键名 → 配色字段的映射 */
const SPECIAL_KEYS: Record<string, 'background' | 'foreground' | 'cursor' | 'cursorAccent' | 'selection' | 'selectionForeground'> = {
    'Background Color': 'background',
    'Foreground Color': 'foreground',
    'Cursor Color': 'cursor',
    'Cursor Text Color': 'cursorAccent',
    'Selection Color': 'selection',
    'Selected Text Color': 'selectionForeground',
}

/**
 * @description 从一个颜色字典的 XML 片段中读取浮点分量并转为 #rrggbb
 * @param dictXml 颜色字典的内层 XML 文本
 * @returns string | null 任何分量缺失时返回 null
 *
 * @example componentToHex('<key>Red Component</key><real>1</real>…') // '#ff0000'
 *
 */
function colorFromDict (dictXml: string): string | null {
    const parts: number[] = []
    for (const channel of ['Red', 'Green', 'Blue'] as const) {
        const match = dictXml.match(new RegExp(`<key>${channel} Component</key>\\s*<(?:real|integer)>([-0-9.eE+]+)</(?:real|integer)>`))
        if (!match) {
            return null
        }
        const value = Number(match[1])
        if (!Number.isFinite(value)) {
            return null
        }
        parts.push(Math.round(Math.min(Math.max(value, 0), 1) * 255))
    }
    return `#${parts.map(part => part.toString(16).padStart(2, '0')).join('')}`
}

/**
 * @description 解析 iTerm2 .itermcolors 文件内容为配色方案
 * @param text XML plist 文本
 * @param name 配色方案名（通常取文件名去掉扩展名）
 * @returns TerminalColorScheme 解析出的配色方案（缺失字段回退默认深色值）
 * @throws Error 内容不是合法的 iTerm2 配色 plist 时抛出
 *
 * @example parseItermColorsFile(xml, 'Solarized Dark iterms') // => 配色对象
 *
 */
export function parseItermColorsFile (text: string, name: string): TerminalColorScheme {
    if (!text.includes('<dict>') || !text.includes('<key>')) {
        throw new Error('not an itermcolors plist')
    }
    const scheme: TerminalColorScheme = {
        name,
        foreground: defaultDarkColorScheme.foreground,
        background: defaultDarkColorScheme.background,
        cursor: defaultDarkColorScheme.cursor,
        colors: [...defaultDarkColorScheme.colors],
    }
    let matched = 0
    const dictPattern = /<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g
    for (let match = dictPattern.exec(text); match; match = dictPattern.exec(text)) {
        const [, key, dictXml] = match
        const color = colorFromDict(dictXml!)
        if (!color) {
            continue
        }
        const ansiMatch = /^Ansi (\d+) Color$/.exec(key!)
        if (ansiMatch) {
            const index = Number(ansiMatch[1])
            if (index >= 0 && index < 16) {
                scheme.colors[index] = color
                matched++
            }
        } else if (key! in SPECIAL_KEYS) {
            scheme[SPECIAL_KEYS[key!]!] = color
            matched++
        }
    }
    if (matched === 0) {
        throw new Error('no iterm2 color entries found')
    }
    return scheme
}
