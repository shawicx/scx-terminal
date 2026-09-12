/**
 * @description BaseSession 单元测试：按配置挂载退格/换行中间件的接线行为
 */
import { describe, expect, it } from 'vitest'
import { BaseSession } from './baseSession'
import { encodeUTF8, decodeUTF8 } from '@/lib/utils/bytes'

class TestSession extends BaseSession {
    written: Uint8Array[] = []

    async start (): Promise<void> {}
    resize (): void {}
    write (data: Uint8Array): void {
        this.written.push(data)
    }
    kill (): void {}
    async gracefullyKillProcess (): Promise<void> {}
    supportsWorkingDirectory (): boolean { return false }
    async getWorkingDirectory (): Promise<string | null> { return null }
}

describe('BaseSession middleware wiring', () => {
    it('passes input through untouched by default', () => {
        const session = new TestSession()
        session.feedFromTerminal(encodeUTF8('x\x7fy'))
        expect(session.written.map(decodeUTF8)).toEqual(['x\x7fy'])
    })

    it('remaps backspace to ^H when configured', () => {
        const session = new TestSession({ backspace: 'ctrl-h' })
        // xterm 每次按键独立产生一个输入块，退格键单独成块
        session.feedFromTerminal(encodeUTF8('x'))
        session.feedFromTerminal(encodeUTF8('\x7f'))
        session.feedFromTerminal(encodeUTF8('y'))
        expect(session.written.map(decodeUTF8)).toEqual(['x', '\x08', 'y'])
    })

    it('converts input newlines when configured', () => {
        const session = new TestSession({ inputNewlines: 'crlf' })
        session.feedFromTerminal(encodeUTF8('a\nb'))
        expect(session.written.map(decodeUTF8)).toEqual(['a\r\nb'])
    })

    it('converts output newlines when configured', () => {
        const session = new TestSession({ outputNewlines: 'implicit_cr' })
        const output: string[] = []
        session.output$.subscribe(data => output.push(data))
        session.releaseInitialDataBuffer()
        session.middleware.feedFromSession(encodeUTF8('a\nb'))
        // 首屏缓冲释放会先发一个空串，过滤后再断言
        expect(output.filter(Boolean)).toEqual(['a\r\nb'])
    })

    it('keeps identity mappings unwired (ctrl-? / backspace)', () => {
        const ctrlQ = new TestSession({ backspace: 'ctrl-?' })
        ctrlQ.feedFromTerminal(encodeUTF8('\x7f'))
        expect(ctrlQ.written.map(chunk => Array.from(chunk))).toEqual([[0x7f]])
    })
})
