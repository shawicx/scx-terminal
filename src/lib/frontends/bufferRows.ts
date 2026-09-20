/**
 * @description xterm buffer 光标坐标换算：buffer.cursorY 是视口相对行 [0, rows)，
 *              getLine 系 API 需要 buffer 绝对行号、菜单像素锚点需要视口行
 */

export interface BufferCursorView {
    /** 视口顶部对应的 buffer 绝对行号（buffer.viewportY） */
    viewportY: number
    /** 未滚动时视口顶部所在的 buffer 绝对行（buffer.baseY） */
    baseY: number
    /** 光标所在视口行 [0, rows)（buffer.cursorY） */
    cursorY: number
}

/**
 * @description 光标所在 buffer 绝对行号（buffer.getLine 系 API 的行参数）
 * @param buffer 光标视图（viewportY/baseY/cursorY）
 * @returns number 绝对行号
 *
 * @example absoluteCursorRow({ viewportY: 4977, baseY: 4977, cursorY: 22 }) // 4999
 *
 */
export function absoluteCursorRow (buffer: BufferCursorView): number {
    return buffer.baseY + buffer.cursorY
}

/**
 * @description 光标所在视口行号（菜单像素锚点用），光标滚出视口时钳制在 [0, rows-1]
 * @param buffer 光标视图（viewportY/baseY/cursorY）
 * @param rows 视口行数
 * @returns number 钳制后的视口行号
 *
 * @example cursorViewportRow({ viewportY: 4977, baseY: 4977, cursorY: 22 }, 24) // 22
 *
 */
export function cursorViewportRow (buffer: BufferCursorView, rows: number): number {
    return Math.min(Math.max(absoluteCursorRow(buffer) - buffer.viewportY, 0), Math.max(rows - 1, 0))
}
