/**
 * @description 终端背景图片纯逻辑：终端背景色与不透明度的 rgba 合成（xterm
 *              allowTransparency 消费）、填充方式到 CSS 背景属性的映射。
 */

import { parseHexColor } from './schemeColors'

/** 不透明度下限（完全透明会导致文字对比度不可控） */
export const MIN_BACKGROUND_OPACITY = 0.05

/**
 * @description 合成终端背景色：按不透明度把配色方案背景转为 rgba（allowTransparency
 *              下作为 xterm theme.background，CSS 背景层从其下透出）
 * @param background 配色方案背景色（hex 字符串）
 * @param opacity 不透明度 0-1（内部 clamp 到 [0.05, 1]）
 * @returns string rgba(r, g, b, a)；hex 非法回退深灰 rgb(23,23,23)
 *
 * @example composeTerminalBackground('#282a36', 0.6) // 'rgba(40, 42, 54, 0.6)'
 *
 */
export function composeTerminalBackground (background: string, opacity: number): string {
    const alpha = Math.min(Math.max(opacity, MIN_BACKGROUND_OPACITY), 1)
    const color = parseHexColor(background) ?? { r: 23, g: 23, b: 23, a: 1 }
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`
}

/** 背景图片填充方式 */
export type BackgroundFit = 'cover' | 'contain' | 'tile'

/** 填充方式对应的 CSS 背景属性组 */
export interface BackgroundFitStyles {
    backgroundSize: string
    backgroundRepeat: string
    backgroundPosition: string
}

/**
 * @description 填充方式映射为 CSS 背景属性（写入 --term-bg-* 变量，TerminalPane 背景层消费）
 * @param fit 填充方式：cover 铺满裁切 / contain 完整显示留边 / tile 原尺寸平铺
 * @returns BackgroundFitStyles CSS 属性组
 *
 * @example mapBackgroundFit('tile') // { backgroundSize: 'auto', backgroundRepeat: 'repeat', backgroundPosition: 'left top' }
 *
 */
export function mapBackgroundFit (fit: BackgroundFit): BackgroundFitStyles {
    switch (fit) {
        case 'contain':
            return { backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }
        case 'tile':
            return { backgroundSize: 'auto', backgroundRepeat: 'repeat', backgroundPosition: 'left top' }
        case 'cover':
        default:
            return { backgroundSize: 'cover', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }
    }
}
