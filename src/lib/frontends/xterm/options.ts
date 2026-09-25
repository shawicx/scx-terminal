/**
 * @description xterm 主题构建与终端选项应用（configure/configureColors 的纯函数部分）。
 */
import type { ITheme, Terminal } from '@xterm/xterm'
import { generatePalette } from '@/lib/generatePalette'
import type { TerminalColorScheme } from '@/lib/colorSchemes'
import type { FrontendContext } from '../frontend'
import { COLOR_NAMES } from './support'

/**
 * @description 配色方案 → xterm ITheme（背景图激活时 viewport 全透明，洗色交给
 *              TerminalPane 背景层；可选生成 256 色扩展调色板）
 * @param scheme 配色方案
 * @param config 终端/外观配置（paletteGenerate/paletteHarmonious/backgroundImage）
 * @returns Partial<ITheme>
 *
 */
export function buildXtermTheme (
    scheme: TerminalColorScheme,
    config: FrontendContext['config'],
): Partial<ITheme> {
    const theme: Partial<ITheme> = {
        foreground: scheme.foreground,
        selectionBackground: scheme.selection ?? '#88888888',
        selectionForeground: scheme.selectionForeground ?? undefined,
        // 背景图激活时 viewport 全透明：半透明洗色由 TerminalPane 背景层的渐变统一
        // 承担（覆盖整个宿主，含 fit 取整留下的右侧/底部亚网格条带），此处若再着
        // rgba 会双重叠色且条带漏色；无图时保持不透明方案底色
        background: config.appearance.backgroundImage !== null
            ? '#00000000'
            : scheme.background,
        cursor: scheme.cursor,
        cursorAccent: scheme.cursorAccent,
    }

    for (let i = 0; i < COLOR_NAMES.length; i++) {
        theme[COLOR_NAMES[i]] = scheme.colors[i]
    }

    if (config.terminal.paletteGenerate) {
        theme.extendedAnsi = generatePalette(
            scheme.colors,
            scheme.background,
            scheme.foreground,
            config.terminal.paletteHarmonious,
        )
    }
    return theme
}

/** applyXtermOptions 的回填值（前端据此更新字号/行距私有字段与 copyOnSelect） */
export interface XtermOptionResult {
    fontSize: number
    linePadding: number
    copyOnSelect: boolean
}

/**
 * @description 把 config.terminal/appearance 应用到 xterm 实例与 xtermCore 浏览器判定
 * @param xterm 终端实例
 * @param xtermCore xterm 内部核心（browser 判定）
 * @param context 前端上下文
 * @returns XtermOptionResult 字号/行距/copyOnSelect
 *
 */
export function applyXtermOptions (
    xterm: Terminal,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    xtermCore: any,
    context: FrontendContext,
): XtermOptionResult {
    const config = context.config
    xtermCore.browser.isWindows = context.platform === 'windows'
    xtermCore.browser.isLinux = context.platform === 'linux'
    xtermCore.browser.isMac = context.platform === 'macos'

    xterm.options.fontFamily = context.getCSSFontFamily()
    xterm.options.cursorStyle = config.terminal.cursor
    xterm.options.cursorBlink = config.terminal.cursorBlink
    xterm.options.macOptionIsMeta = config.terminal.altIsMeta
    xterm.options.scrollback = config.terminal.scrollbackLines
    xterm.options.wordSeparator = config.terminal.wordSeparator
    xterm.options.drawBoldTextInBrightColors = config.terminal.drawBoldTextInBrightColors
    xterm.options.fontWeight = config.terminal.fontWeight
    xterm.options.fontWeightBold = config.terminal.fontWeightBold
    xterm.options.minimumContrastRatio = config.terminal.minimumContrastRatio
    return {
        fontSize: config.terminal.fontSize,
        linePadding: config.terminal.linePadding,
        copyOnSelect: config.terminal.copyOnSelect,
    }
}
