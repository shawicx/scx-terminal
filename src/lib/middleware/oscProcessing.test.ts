/**
 * @description OSCProcessor 单元测试：OSC 7/1337 cwd 上报透传语义 + OSC 52 剪贴板写入（解码/上限/容错）
 */
import { describe, expect, it, vi } from 'vitest'
import { OSCProcessor, OSC52_MAX_CLIPBOARD_BYTES, parseOsc7Cwd } from './oscProcessing'
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

describe('OSC 7 working directory reporting', () => {
    it('emits decoded path with BEL terminator and swallows the sequence', () => {
        const reported: string[] = []
        const output: Uint8Array[] = []
        const processor = new OSCProcessor()
        processor.cwdReported$.subscribe(cwd => reported.push(cwd))
        processor.outputToTerminal$.subscribe(data => output.push(data))
        processor.feedFromSession(encodeUTF8('before\x1b]7;file://myhost/Users/scx/my%20dir\x07$ '))
        expect(reported).toEqual(['/Users/scx/my dir'])
        expect(new TextDecoder().decode(output[0]!)).toBe('before$ ')
    })

    it('accepts ST terminator and empty host', () => {
        const reported: string[] = []
        const processor = new OSCProcessor()
        processor.cwdReported$.subscribe(cwd => reported.push(cwd))
        processor.feedFromSession(encodeUTF8('\x1b]7;file:///tmp/\x1b\\'))
        expect(reported).toEqual(['/tmp/'])
    })

    it('decodes non-ASCII (percent-encoded) paths', () => {
        const reported: string[] = []
        const processor = new OSCProcessor()
        processor.cwdReported$.subscribe(cwd => reported.push(cwd))
        processor.feedFromSession(encodeUTF8('\x1b]7;file:///Users/scx/%E4%B8%AD%E6%96%87\x07'))
        expect(reported).toEqual(['/Users/scx/中文'])
    })

    it('reassembles sequences split across chunks', () => {
        const reported: string[] = []
        const processor = new OSCProcessor()
        processor.cwdReported$.subscribe(cwd => reported.push(cwd))
        processor.feedFromSession(encodeUTF8('\x1b]7;file://local'))
        processor.feedFromSession(encodeUTF8('host/tmp\x07'))
        expect(reported).toEqual(['/tmp'])
    })

    it('drops invalid payloads silently (no emit, no passthrough)', () => {
        const reported: string[] = []
        const output: Uint8Array[] = []
        const processor = new OSCProcessor()
        processor.cwdReported$.subscribe(cwd => reported.push(cwd))
        processor.outputToTerminal$.subscribe(data => output.push(data))
        processor.feedFromSession(encodeUTF8('a\x1b]7;not-a-uri\x07b'))
        expect(reported).toEqual([])
        expect(new TextDecoder().decode(output[0]!)).toBe('ab')
    })

    it('parseOsc7Cwd handles edge cases', () => {
        expect(parseOsc7Cwd('file://localhost/private/tmp')).toBe('/private/tmp')
        expect(parseOsc7Cwd('relative/path')).toBeNull()
        expect(parseOsc7Cwd('file://host')).toBe('/')
    })
})
