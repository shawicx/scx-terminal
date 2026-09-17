/**
 * @description shell history 文件解析单测：zsh 扩展格式（时间戳/多行）与 bash 纯行回退
 */
import { describe, expect, it } from 'vitest'
import { parseShellHistory } from './shellHistory'

describe('parseShellHistory — zsh', () => {
    it('parses extended-history entries with timestamps', () => {
        const content = ': 1700000000:0;git checkout dev\n: 1700000100:0;ls -la\n'
        expect(parseShellHistory(content, 'zsh')).toEqual([
            { command: 'git checkout dev', runAt: 1700000000 },
            { command: 'ls -la', runAt: 1700000100 },
        ])
    })

    it('appends continuation lines (no timestamp prefix) to the current entry', () => {
        const content = ': 1700000000:0;git push \\\n--force\n: 1700000100:0;ls\n'
        expect(parseShellHistory(content, 'zsh')).toEqual([
            { command: 'git push \\\n--force', runAt: 1700000000 },
            { command: 'ls', runAt: 1700000100 },
        ])
    })

    it('falls back to plain lines without timestamps (runAt 0)', () => {
        const content = 'git status\ncd /tmp\n'
        expect(parseShellHistory(content, 'zsh')).toEqual([
            { command: 'git status', runAt: 0 },
            { command: 'cd /tmp', runAt: 0 },
        ])
    })

    it('skips blank lines', () => {
        expect(parseShellHistory('\n\n: 1:0;ls\n\n', 'zsh')).toEqual([{ command: 'ls', runAt: 1 }])
    })
})

describe('parseShellHistory — bash', () => {
    it('treats every line as one entry with runAt 0', () => {
        expect(parseShellHistory('git status\nls\n', 'bash')).toEqual([
            { command: 'git status', runAt: 0 },
            { command: 'ls', runAt: 0 },
        ])
    })
})
