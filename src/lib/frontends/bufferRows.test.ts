/**
 * @description xterm buffer 光标坐标换算单测：buffer.cursorY 是视口相对行 [0, rows)，
 *              getLine 系 API 需要 buffer 绝对行、菜单像素锚点需要视口行——锁定换算语义防回归
 */
import { describe, expect, it } from 'vitest'
import { absoluteCursorRow, cursorViewportRow, type BufferCursorView } from './bufferRows'

/** 深度 scrollback 场景：视口顶部在 buffer 第 4977 行、光标在视口第 22 行（24 行视口的倒数第 2 行） */
const SCROLLED: BufferCursorView = { baseY: 4977, cursorY: 22, viewportY: 4977 }

describe('absoluteCursorRow', () => {
    it('offsets the viewport-relative cursor row by baseY (getLine needs absolute rows)', () => {
        expect(absoluteCursorRow(SCROLLED)).toBe(4999)
    })

    it('equals cursorY on a fresh buffer (baseY = 0)', () => {
        expect(absoluteCursorRow({ baseY: 0, cursorY: 5, viewportY: 0 })).toBe(5)
    })
})

describe('cursorViewportRow', () => {
    it('returns the raw viewport row when not scrolled (anchor follows the cursor)', () => {
        // 回归：cursorY - viewportY 恒为负 → 钳 0 → 建议菜单钉在视口顶部
        expect(cursorViewportRow(SCROLLED, 24)).toBe(22)
    })

    it('clamps to the last row when the cursor is scrolled out of view', () => {
        expect(cursorViewportRow({ ...SCROLLED, viewportY: 4900 }, 24)).toBe(23)
    })
})
