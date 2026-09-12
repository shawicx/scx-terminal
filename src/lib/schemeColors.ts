/**
 * @description 配色派生工具：解析十六进制颜色、计算相对亮度（WCAG）、
 * 判断配色深浅，并从终端配色方案派生应用界面（标题栏/标签栏/设置页）
 * 使用的 CSS 颜色变量，实现 Tabby 式"界面颜色跟随终端配色"。
 */

import type { TerminalColorScheme } from './colorSchemes'

export interface RGBA {
    r: number
    g: number
    b: number
    a: number
}

/**
 * @description 解析十六进制颜色字符串（支持 #rgb、#rrggbb、#rrggbbaa）
 * @param hex 颜色字符串
 * @returns RGBA | null 合法返回 0-255 通道值（alpha 为 0-1），非法返回 null
 *
 * @example parseHexColor('#282a36') // => { r: 40, g: 42, b: 54, a: 1 }
 * @example parseHexColor('#44475acc') // => { r: 68, g: 73, b: 90, a: 0.8 }
 */
export function parseHexColor (hex: string): RGBA | null {
    let value = hex.trim().replace(/^#/, '')
    if (value.length === 3) {
        value = value.split('').map(ch => ch + ch).join('')
    }
    if (value.length !== 6 && value.length !== 8) {
        return null
    }
    if (!/^[0-9a-fA-F]+$/.test(value)) {
        return null
    }
    const r = parseInt(value.slice(0, 2), 16)
    const g = parseInt(value.slice(2, 4), 16)
    const b = parseInt(value.slice(4, 6), 16)
    const a = value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1
    return { r, g, b, a }
}

/**
 * @description 将 RGBA 转为 CSS 颜色字符串（不透明输出 rgb()，半透明输出 rgba()）
 * @param color RGBA 颜色
 * @returns string CSS 颜色值
 *
 * @example rgbaToCss({ r: 40, g: 42, b: 54, a: 1 }) // => 'rgb(40, 42, 54)'
 */
export function rgbaToCss (color: RGBA): string {
    if (color.a >= 1) {
        return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
    }
    return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${Number(color.a.toFixed(3))})`
}

/**
 * @description 计算 WCAG 相对亮度（0 为纯黑，1 为纯白）
 * @param color RGBA 颜色
 * @returns number 相对亮度
 *
 * @example relativeLuminance(parseHexColor('#000000')!) // => 0
 */
export function relativeLuminance (color: RGBA): number {
    const channel = (v: number): number => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

/**
 * @description 判断配色方案为深色还是浅色（按背景亮度，阈值对应中灰 #808080）
 * @param scheme 终端配色方案
 * @returns boolean 背景较暗返回 true
 *
 * @example isColorSchemeDark(defaultDarkColorScheme) // => true
 */
export function isColorSchemeDark (scheme: TerminalColorScheme): boolean {
    const bg = parseHexColor(scheme.background)
    return bg ? relativeLuminance(bg) < 0.2 : true
}

/**
 * @description 线性混合两个颜色
 * @param base 基础色
 * @param target 目标色
 * @param weight 目标色权重（0-1）
 * @returns RGBA 混合结果（alpha 取基础色）
 *
 * @example mixColors(bg, fg, 0.1) // => 背景向前景偏移 10%
 */
export function mixColors (base: RGBA, target: RGBA, weight: number): RGBA {
    const w = Math.min(1, Math.max(0, weight))
    return {
        r: base.r + (target.r - base.r) * w,
        g: base.g + (target.g - base.g) * w,
        b: base.b + (target.b - base.b) * w,
        a: base.a,
    }
}

/**
 * @description 从终端配色方案派生应用界面的 CSS 颜色变量。
 * 背景/前景直接取配色；卡片、边框、悬停等表面色由背景向前景按不同比例
 * 混合得到（深色配色为提亮、浅色配色为压暗）；主色取配色的蓝色槽位。
 * @param scheme 终端配色方案
 * @returns Record<string, string> token 名到 CSS 颜色值的映射，键集合恒定
 *
 * @example deriveChromeTokens(defaultDarkColorScheme)['--background'] // => 'rgb(23, 23, 23)'
 */
export function deriveChromeTokens (scheme: TerminalColorScheme): Record<string, string> {
    const bg = parseHexColor(scheme.background) ?? { r: 23, g: 23, b: 23, a: 1 }
    const fg = parseHexColor(scheme.foreground) ?? { r: 202, g: 202, b: 202, a: 1 }
    const dark = isColorSchemeDark(scheme)

    // 深色配色取亮蓝（colors[12]），浅色配色取标准蓝（colors[4]），保证在各自背景上可见
    const accent = parseHexColor(scheme.colors[dark ? 12 : 4]) ?? fg
    // 表面色：背景向前景偏移，深色即提亮、浅色即压暗，比例参考原有 oklch token 的层次
    const surface = (weight: number): string => rgbaToCss(mixColors(bg, fg, weight))

    return {
        '--background': rgbaToCss(bg),
        '--foreground': rgbaToCss(fg),
        '--card': surface(0.05),
        '--card-foreground': rgbaToCss(fg),
        '--popover': surface(0.05),
        '--popover-foreground': rgbaToCss(fg),
        '--primary': rgbaToCss(accent),
        // 主色较亮时用深色文字（取配色背景），较暗时用白字
        '--primary-foreground': dark ? rgbaToCss(bg) : '#ffffff',
        '--secondary': surface(0.08),
        '--secondary-foreground': rgbaToCss(fg),
        '--muted': surface(0.08),
        '--muted-foreground': rgbaToCss({ ...fg, a: 0.62 }),
        '--accent': surface(0.12),
        '--accent-foreground': rgbaToCss(fg),
        '--border': surface(0.16),
        '--input': surface(0.1),
        '--ring': rgbaToCss({ ...accent, a: 0.6 }),
        '--term-scrollbar-thumb': rgbaToCss({ ...fg, a: 0.25 }),
        '--term-scrollbar-track': rgbaToCss({ ...fg, a: 0.07 }),
    }
}
