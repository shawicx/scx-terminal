/**
 * @description OSCProcessor 单元测试：OSC 1337 cwd 上报透传语义 + OSC 52 剪贴板写入（解码/上限/容错）
 */
import { describe, expect, it, vi } from 'vitest'
import { OSCProcessor, OSC52_MAX_CLIPBOARD_BYTES } from './oscProcessing'
import { encodeUTF8 } from '@/lib/utils/bytes'

function osc52Sequence (payload: string, selection = 'c'): Uint8Array {
    return encodeUTF8(`\x1b]52;${selection};${payload}\x07`)
}

describe('OSC 52 clipboard write', () => {
    it('decodes base64 payload and forwards it to the clipboard writer', () => {
        const setClipboard = vi.fn().mockResolvedValue(undefined)
        const processor = new OSCProcessor({ setClipboard })
        processor.feedFromSession(encodeUTF8('before\x1b]52;c;' + btoa('hello world') + '\x07after'))
        expect(setClipboard).toHaveBeenCalledExactlyOnceWith('hello world')
    })

    it('accepts an empty selection as the default clipboard', () => {
        const setClipboard = vi.fn().mockResolvedValue(undefined)
        const processor = new OSCProcessor({ setClipboard })
        processor.feedFromSession(osc52Sequence(btoa('x'), ''))
        expect(setClipboard).toHaveBeenCalledExactlyOnceWith('x')
    })

    it('ignores clipboard read queries (?) and non-clipboard selections', () => {
        const setClipboard = vi.fn().mockResolvedValue(undefined)
        const processor = new OSCProcessor({ setClipboard })
        processor.feedFromSession(osc52Sequence('?', 'c'))
        processor.feedFromSession(osc52Sequence(btoa('x'), 'p0'))
        expect(setClipboard).not.toHaveBeenCalled()
    })

    it('drops payloads above the size limit', () => {
        const setClipboard = vi.fn().mockResolvedValue(undefined)
        const processor = new OSCProcessor({ setClipboard })
        const big = 'a'.repeat(OSC52_MAX_CLIPBOARD_BYTES + 1)
        processor.feedFromSession(osc52Sequence(btoa(big)))
        expect(setClipboard).not.toHaveBeenCalled()
    })

    it('tolerates invalid base64 without throwing', () => {
        const setClipboard = vi.fn().mockResolvedValue(undefined)
        const processor = new OSCProcessor({ setClipboard })
        expect(() => processor.feedFromSession(osc52Sequence('!!!not-base64!!!'))).not.toThrow()
        expect(setClipboard).not.toHaveBeenCalled()
    })

    it('does not forward OSC 52 sequences to the terminal output', () => {
        const output: Uint8Array[] = []
        const processor = new OSCProcessor({ setClipboard: async () => {} })
        processor.outputToTerminal$.subscribe(data => output.push(data))
        processor.feedFromSession(osc52Sequence(btoa('hello')))
        expect(output.map(chunk => new TextDecoder().decode(chunk)).join('')).toBe('')
    })
})

describe('OSC 1337 working directory reporting', () => {
    it('emits reported cwd and keeps the sequence out of terminal output', () => {
        const reported: string[] = []
        const output: Uint8Array[] = []
        const processor = new OSCProcessor()
        processor.cwdReported$.subscribe(cwd => reported.push(cwd))
        processor.outputToTerminal$.subscribe(data => output.push(data))
        processor.feedFromSession(encodeUTF8('\x1b]1337;CurrentDir=/Users/scx/project\x07$ '))
        expect(reported).toEqual(['/Users/scx/project'])
        expect(new TextDecoder().decode(output[0]!)).toBe('$ ')
    })
})
