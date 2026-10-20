/**
 * @description 输入命令行跟踪器单元测试：常规键入/行结束、退格（含多字节）、
 *              \r\n 去重、行中止、不可信行（Tab/方向键/Ctrl+W）不上报。
 */
import { describe, expect, it } from 'vitest'
import { createInputLineTracker } from './inputLineTracker'
import { encodeUTF8 } from '@/lib/utils/bytes'

describe('createInputLineTracker', () => {
    it('accumulates typed characters and reports the line on CR', () => {
        const lines: string[] = []
        const tracker = createInputLineTracker(line => lines.push(line))
        tracker.feed(encodeUTF8('cd /var/log'))
        tracker.feed(new Uint8Array([0x0d]))
        expect(lines).toEqual(['cd /var/log'])
    })

    it('treats LF as line end too (sendText execute path normalizes CRLF to LF)', () => {
        const lines: string[] = []
        const tracker = createInputLineTracker(line => lines.push(line))
        tracker.feed(encodeUTF8('pwd\n'))
        expect(lines).toEqual(['pwd'])
    })

    it('collapses CRLF into a single line end', () => {
        const lines: string[] = []
        const tracker = createInputLineTracker(line => lines.push(line))
        tracker.feed(encodeUTF8('ls\r\n'))
        expect(lines).toEqual(['ls'])
    })

    it('applies backspace and delete (UTF-8 codepoint aware)', () => {
        const lines: string[] = []
        const tracker = createInputLineTracker(line => lines.push(line))
        tracker.feed(encodeUTF8('cd /tmp/目录'))
        tracker.feed(new Uint8Array([0x7f, 0x7f])) // 两个 DEL 各删一个完整多字节码点：「目录」→''
        tracker.feed(encodeUTF8('x'))
        tracker.feed(new Uint8Array([0x08]))       // BS 删掉刚补的 x
        tracker.feed(encodeUTF8('\r'))
        expect(lines).toEqual(['cd /tmp/'])
    })

    it('drops the line when an untrackable editing key appears (tab completion)', () => {
        const lines: string[] = []
        const tracker = createInputLineTracker(line => lines.push(line))
        tracker.feed(encodeUTF8('cd /et'))
        tracker.feed(new Uint8Array([0x09])) // Tab 补全结果不在输入流里
        tracker.feed(encodeUTF8('c\r'))
        expect(lines).toEqual([])
    })

    it('drops the line when arrow keys (history recall) are used', () => {
        const lines: string[] = []
        const tracker = createInputLineTracker(line => lines.push(line))
        tracker.feed(new Uint8Array([0x1b, 0x5b, 0x41])) // ↑
        tracker.feed(new Uint8Array([0x0d]))
        expect(lines).toEqual([])
    })

    it('aborts the current line on Ctrl+C and starts a fresh trusted line', () => {
        const lines: string[] = []
        const tracker = createInputLineTracker(line => lines.push(line))
        tracker.feed(encodeUTF8('half-typed'))
        tracker.feed(new Uint8Array([0x03]))
        tracker.feed(encodeUTF8('cd /etc\r'))
        expect(lines).toEqual(['cd /etc'])
    })

    it('Ctrl+U clears the line buffer and the rest stays trusted', () => {
        const lines: string[] = []
        const tracker = createInputLineTracker(line => lines.push(line))
        tracker.feed(encodeUTF8('wrong cd '))
        tracker.feed(new Uint8Array([0x15]))
        tracker.feed(encodeUTF8('cd /usr\r'))
        expect(lines).toEqual(['cd /usr'])
    })

    it('reports each line of a pasted multi-line payload', () => {
        const lines: string[] = []
        const tracker = createInputLineTracker(line => lines.push(line))
        tracker.feed(encodeUTF8('cd /a\n'))
        tracker.feed(encodeUTF8('cd /b\n'))
        expect(lines).toEqual(['cd /a', 'cd /b'])
    })

    it('does not report empty lines', () => {
        const lines: string[] = []
        const tracker = createInputLineTracker(line => lines.push(line))
        tracker.feed(new Uint8Array([0x0d, 0x0a]))
        expect(lines).toEqual([])
    })

    it('reset drops the pending buffer', () => {
        const lines: string[] = []
        const tracker = createInputLineTracker(line => lines.push(line))
        tracker.feed(encodeUTF8('cd /x'))
        tracker.reset()
        tracker.feed(new Uint8Array([0x0d]))
        expect(lines).toEqual([])
    })
})
