/**
 * @description 输入行模型单测：wrap 链拼接 / 提示符剥离 / 续行合并 / 词定位 / PromptTracker 状态机
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    currentWordAt, mergeContinuationLines, PromptTracker, readLogicalLine, stripPrompt,
    type BufferLineAccess, type PromptTrackerHost,
} from './promptTracker'

/** 构造 mock buffer：lines 为各物理行文本（索引即 y），wrapped 标记哪些行是上一行的延续；
 *  ranges 可选覆盖某行的列区间读取（模拟宽字符的列→字符映射） */
function makeAccess (
    lines: string[],
    wrappedFlags: boolean[],
    cursorX: number,
    cursorY: number,
    ranges?: Record<number, (endX: number) => string | null>,
): BufferLineAccess {
    return {
        getLineText: (y, trimRight) => {
            const text = lines[y]
            if (text === undefined) return null
            return trimRight ? text.trimEnd() : text
        },
        getLineTextRange: (y, endX) => ranges?.[y]?.(endX) ?? lines[y]?.slice(0, endX) ?? null,
        isWrapped: y => wrappedFlags[y] ?? false,
        cursorX,
        cursorY,
    }
}

describe('readLogicalLine', () => {
    it('reads the cursor line directly when not wrapped', () => {
        const line = readLogicalLine(makeAccess(['user@mac ~ % git che', ''], [false, false], 18, 0))
        expect(line).toEqual({ text: 'user@mac ~ % git che', cursorOffset: 18 })
    })

    it('joins soft-wrapped segments above the cursor (middle segments keep full width)', () => {
        // 20 列终端：第一物理段满 20 字符，光标在第二段第 3 列
        const line = readLogicalLine(makeAccess(['01234567890123456789', 'xyz'], [false, true], 3, 1))
        expect(line).toEqual({ text: '01234567890123456789xyz', cursorOffset: 23 })
    })

    it('counts cursorOffset in chars, not cell columns (wide chars occupy 2 cells)', () => {
        // 行 'echo 中文 more'：'中文' 各占 2 列。光标在 ' m' 之后 = 11 列，但光标前只有 9 个字符
        const range = (endX: number): string | null => {
            let chars = ''
            let cells = 0
            for (const ch of 'echo 中文 more') {
                const width = (ch.codePointAt(0) ?? 0) > 0x2e7f ? 2 : 1 // CJK 宽，ASCII 窄
                if (cells + width > endX) break
                chars += ch
                cells += width
            }
            return chars
        }
        const line = readLogicalLine(makeAccess(['echo 中文 more', ''], [false, false], 11, 0, { 0: range }))
        expect(line).toEqual({ text: 'echo 中文 more', cursorOffset: 9 })
    })

    it('returns null when the cursor line is unavailable', () => {
        expect(readLogicalLine(makeAccess([], [], 0, 0))).toBeNull()
    })
})

describe('stripPrompt', () => {
    it('removes promptLen chars and shifts the cursor offset', () => {
        expect(stripPrompt({ text: 'user@mac ~ % git che', cursorOffset: 18 }, 13)).toEqual({ text: 'git che', cursorOffset: 5 })
    })

    it('never produces a negative cursor offset', () => {
        expect(stripPrompt({ text: 'abc', cursorOffset: 1 }, 5)).toEqual({ text: '', cursorOffset: 0 })
    })
})

describe('mergeContinuationLines', () => {
    it('merges backslash continuations into a single line', () => {
        expect(mergeContinuationLines(['git push \\', '> --force', '> --tags'])).toBe('git push --force --tags')
    })

    it('keeps plain multi-segment joins space separated', () => {
        expect(mergeContinuationLines(['echo a\\', 'b'])).toBe('echo ab')
    })

    it('never strips the PS2 prefix from the first segment (> can be a legal redirect)', () => {
        expect(mergeContinuationLines(['> notes.log'])).toBe('> notes.log')
    })
})

describe('currentWordAt', () => {
    it('extracts the word before the cursor', () => {
        expect(currentWordAt('git checkout ~/Doc', 18)).toEqual({ text: '~/Doc', start: 13, end: 18 })
    })

    it('returns null when the cursor follows whitespace', () => {
        expect(currentWordAt('git ', 4)).toBeNull()
    })
})

describe('PromptTracker', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    /** 可变 buffer 状态 + PromptTrackerHost（行文本、光标列、上方逻辑行） */
    function makeHost (initial: { line: string, cursorX: number, above: string[] }) {
        const state = { ...initial }
        const access: BufferLineAccess = {
            getLineText: (y, trimRight) => {
                const all = [...state.above, state.line]
                const text = all[y]
                if (text === undefined) return null
                return trimRight ? text.trimEnd() : text
            },
            getLineTextRange: (y, endX) => {
                const all = [...state.above, state.line]
                return all[y]?.slice(0, endX) ?? null
            },
            isWrapped: _y => false,
            get cursorX () { return state.cursorX },
            get cursorY () { return state.above.length },
        }
        const host: PromptTrackerHost = {
            readLine: () => readLogicalLine(access),
            readLineAbove: up => {
                const list = state.above
                const text = list[list.length - 1 - up]
                return text === undefined ? null : { text, cursorOffset: text.length }
            },
            readCursorPrefix: () => state.line.slice(0, Math.min(state.cursorX, state.line.length)),
        }
        return { host, state }
    }

    it('learns the initial prompt after first output silence', () => {
        const { host } = makeHost({ line: 'user@mac ~ % ', cursorX: 13, above: [] })
        const tracker = new PromptTracker(host)
        tracker.notifyOutput()
        vi.advanceTimersByTime(250)
        expect(tracker.promptLength).toBe(13)
        expect(tracker.getTypedLine()).toEqual({ text: '', cursorOffset: 0 })
        tracker.destroy()
    })

    it('learns a new prompt after enter and records the typed command', () => {
        const { host, state } = makeHost({ line: 'user@mac ~ % ', cursorX: 13, above: [] })
        const tracker = new PromptTracker(host)
        tracker.notifyOutput()
        vi.advanceTimersByTime(250) // 学习首提示符（长度 13）
        expect(tracker.promptLength).toBe(13)
        // 用户输入 git status 后回车；随后 shell 输出结束、光标停在新提示符后
        state.line = 'user@mac ~ % git status'
        state.cursorX = 26
        tracker.notifyInput(new Uint8Array([0x0d]))
        state.line = 'user@mac ~ % '
        state.cursorX = 13
        vi.advanceTimersByTime(250)
        expect(tracker.takeRecordedCommand()).toBe('git status')
        expect(tracker.takeRecordedCommand()).toBeNull() // 只取一次
        tracker.destroy()
    })

    it('discards prompt learning when the jump exceeds the limit (async output pollution)', () => {
        // 从 1 学到 30：跳变 29 > 上限 5 → 丢弃
        const { host, state } = makeHost({ line: 'x', cursorX: 1, above: [] })
        const tracker = new PromptTracker(host, undefined, { maxPromptJump: 5 })
        tracker.notifyInput(new Uint8Array([0x0d])) // 回车 → 触发学习
        vi.advanceTimersByTime(250)
        expect(tracker.promptLength).toBe(1)
        state.cursorX = 30
        state.line = 'y'.repeat(30)
        tracker.notifyInput(new Uint8Array([0x0d]))
        vi.advanceTimersByTime(250)
        expect(tracker.promptLength).toBe(1) // 保持旧值
        tracker.destroy()
    })

    it('cancels prompt learning when the user types before silence', () => {
        const { host, state } = makeHost({ line: 'user@mac ~ % gi', cursorX: 15, above: [] })
        const tracker = new PromptTracker(host)
        // 先建立 promptLength（学习首提示符长度 13）
        state.cursorX = 13
        state.line = 'user@mac ~ % '
        tracker.notifyOutput()
        vi.advanceTimersByTime(250)
        expect(tracker.promptLength).toBe(13)
        // 用户在提示符后输入 gi 后回车，随后静默前又按键（非回车）→ 取消学习
        state.line = 'user@mac ~ % gi'
        state.cursorX = 15
        tracker.notifyInput(new Uint8Array([0x0d]))
        state.line = 'user@mac ~ % git'
        state.cursorX = 16
        tracker.notifyInput(new Uint8Array([0x74])) // 't'
        vi.advanceTimersByTime(250)
        expect(tracker.promptLength).toBe(13) // 未学习（保持旧值）
        // 但回车时的命令仍被记录
        expect(tracker.takeRecordedCommand()).toBe('gi')
        tracker.destroy()
    })

    it('recordDirect records the pasted command text as-is (single line)', () => {
        const { host } = makeHost({ line: 'user@mac ~ % ', cursorX: 13, above: [] })
        const tracker = new PromptTracker(host)
        tracker.recordDirect('echo pasted\r\n')
        vi.advanceTimersByTime(250)
        expect(tracker.takeRecordedCommand()).toBe('echo pasted')
        tracker.destroy()
    })

    it('recordDirect keeps only the last non-empty line of a multi-line paste', () => {
        const { host } = makeHost({ line: 'user@mac ~ % ', cursorX: 13, above: [] })
        const tracker = new PromptTracker(host)
        tracker.recordDirect('echo one\necho two\n\n')
        vi.advanceTimersByTime(250)
        expect(tracker.takeRecordedCommand()).toBe('echo two')
        tracker.destroy()
    })

    it('recordDirect records nothing for whitespace-only content', () => {
        const { host } = makeHost({ line: 'user@mac ~ % ', cursorX: 13, above: [] })
        const tracker = new PromptTracker(host)
        tracker.recordDirect('\n \n')
        vi.advanceTimersByTime(250)
        expect(tracker.takeRecordedCommand()).toBeNull()
        tracker.destroy()
    })
})
