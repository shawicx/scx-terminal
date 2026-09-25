/**
 * @description xterm buffer 行读取纯函数：光标逻辑行（soft-wrap 拼接）、向上偏移逻辑行、
 *              光标前缀与建议锚点几何（原 XTermFrontend 对应方法，函数化便于单测复用）。
 */
import type { Terminal } from '@xterm/xterm'
import { absoluteCursorRow, cursorViewportRow } from '../bufferRows'
import type { BufferLineAccess, LogicalLine } from '@/lib/suggestions/promptTracker'

/** 建议功能的 buffer 读取视图（每次现读，不缓存引用） */
export function bufferAccessOf (xterm: Terminal): BufferLineAccess {
    const buffer = xterm.buffer.active
    return {
        getLineText: (y, trimRight) => buffer.getLine(y)?.translateToString(trimRight) ?? null,
        getLineTextRange: (y, endX) => buffer.getLine(y)?.translateToString(false, 0, endX) ?? null,
        isWrapped: y => buffer.getLine(y)?.isWrapped ?? false,
        get cursorX () { return buffer.cursorX },
        get cursorY () { return absoluteCursorRow(buffer) },
    }
}

/**
 * @description 向上第 up 个逻辑行的完整文本（续行合并采集用；up=0 等价当前行但光标在行尾）
 * @param xterm 终端实例
 * @param up 向上偏移的逻辑行数
 * @returns LogicalLine | null 越界时 null
 */
export function logicalLineAbove (xterm: Terminal, up: number): LogicalLine | null {
    const buffer = xterm.buffer.active
    let y = absoluteCursorRow(buffer)
    const lineStart = (start: number): number => {
        let at = start
        while (at > 0 && buffer.getLine(at)?.isWrapped) {
            at--
        }
        return at
    }
    y = lineStart(y)
    for (let i = 0; i < up; i++) {
        y--
        if (y < 0) {
            return null
        }
        y = lineStart(y)
    }
    let text = ''
    let cursor = y
    for (;;) {
        const line = buffer.getLine(cursor)
        if (!line) {
            break
        }
        const isLast = !buffer.getLine(cursor + 1)?.isWrapped
        text += line.translateToString(isLast)
        if (isLast) {
            break
        }
        cursor++
    }
    return { text, cursorOffset: text.length }
}

/**
 * @description 光标行 [0, cursorX) 文本（提示符学习锚点；RPROMPT 天然被排除在光标右侧）
 * @param xterm 终端实例
 * @returns string | null
 */
export function cursorPrefix (xterm: Terminal): string | null {
    const buffer = xterm.buffer.active
    const line = buffer.getLine(absoluteCursorRow(buffer))
    return line ? line.translateToString(true, 0, buffer.cursorX) : null
}

/**
 * @description 建议菜单锚点：光标格左下角的像素坐标（相对宿主元素，不触 xterm 私有 API，
 *              单元格尺寸 = 宿主尺寸 ÷ 网格数；viewportRow 钳制在视口内防滚动越界）
 * @param xterm 终端实例
 * @param host 宿主元素
 * @returns object left/top 与宿主高宽
 */
export function suggestionAnchorRect (
    xterm: Terminal,
    host: HTMLElement,
): { left: number, top: number, hostHeight: number, hostWidth: number } {
    const buffer = xterm.buffer.active
    const cellWidth = host.clientWidth / Math.max(xterm.cols, 1)
    const cellHeight = host.clientHeight / Math.max(xterm.rows, 1)
    const viewportRow = cursorViewportRow(buffer, xterm.rows)
    return {
        left: buffer.cursorX * cellWidth,
        top: (viewportRow + 1) * cellHeight,
        hostHeight: host.clientHeight,
        hostWidth: host.clientWidth,
    }
}
