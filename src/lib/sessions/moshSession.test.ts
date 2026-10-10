/**
 * @description MoshSession 单元测试：命令行参数拼装（--ssh 透传 / UDP 端口）、
 *              会话启动链路（spawn 选项 / data→output / exit→destroy）与
 *              spawn 失败错误输出（mock TauriPTYProxy）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
    return {
        /** pty.start 行为注入点：默认成功 */
        startImpl: async (): Promise<void> => {},
        /** 已注册的事件处理器表（mock 代理转发事件用） */
        handlers: {} as Record<string, (payload?: unknown) => void>,
        startOptions: null as unknown,
        resize: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
    }
})

vi.mock('@/services/pty', () => ({
    TauriPTYProxy: class {
        subscribe (event: string, handler: (payload?: unknown) => void): void {
            mocks.handlers[event] = handler
        }
        async start (options: unknown): Promise<void> {
            mocks.startOptions = options
            await mocks.startImpl()
        }
        async resize (columns: number, rows: number): Promise<void> {
            mocks.resize(columns, rows)
        }
        async write (data: Uint8Array): Promise<void> {
            mocks.write(data)
        }
        async kill (): Promise<void> {
            mocks.kill()
        }
        ackData (): void {}
        unsubscribeAll (): void {}
    },
}))

vi.mock('@/lib/platform', () => ({
    platform: 'macos',
}))

import { MoshSession, buildMoshArgs } from './moshSession'
import { firstValueFrom } from 'rxjs'

describe('buildMoshArgs', () => {
    it('默认 22 端口不透传 --ssh', () => {
        expect(buildMoshArgs({ host: 'example.com', port: 22, user: 'root', moshPort: null }))
            .toEqual(['root@example.com'])
    })

    it('非 22 端口经 --ssh 透传给内部 ssh', () => {
        expect(buildMoshArgs({ host: 'example.com', port: 2222, user: 'admin', moshPort: null }))
            .toEqual(['--ssh=ssh -p 2222', 'admin@example.com'])
    })

    it('moshPort 映射为 UDP 端口参数', () => {
        expect(buildMoshArgs({ host: 'srv', port: 22, user: 'root', moshPort: 60001 }))
            .toEqual(['-p', '60001', 'root@srv'])
    })
})

describe('MoshSession', () => {
    beforeEach(() => {
        mocks.startImpl = async (): Promise<void> => {}
        mocks.handlers = {}
        mocks.startOptions = null
        mocks.resize.mockClear()
        mocks.write.mockClear()
        mocks.kill.mockClear()
    })

    it('start 以 mosh 命令与初始尺寸 spawn PTY', async () => {
        const session = new MoshSession()
        session.resize(120, 40)
        await session.start({ host: 'example.com', port: 2222, user: 'root', moshPort: 60001, width: null, height: null })
        expect(mocks.startOptions).toMatchObject({
            file: 'mosh',
            args: ['--ssh=ssh -p 2222', '-p', '60001', 'root@example.com'],
            cols: 120,
            rows: 40,
        })
        expect(session.open).toBe(true)
    })

    it('spawn 失败时错误文本打进输出缓冲且会话不打开', async () => {
        mocks.startImpl = async (): Promise<void> => {
            throw new Error('No such file or directory')
        }
        const session = new MoshSession()
        await session.start({ host: 'example.com', port: 22, user: 'root', moshPort: null, width: null, height: null })
        expect(session.open).toBe(false)
        // 初始数据被缓冲到 releaseInitialDataBuffer：先订阅再释放
        const received = firstValueFrom(session.output$)
        session.releaseInitialDataBuffer()
        expect(await received).toContain('Could not start mosh')
    })

    it('data 事件转发到输出流', async () => {
        const session = new MoshSession()
        await session.start({ host: 'example.com', port: 22, user: 'root', moshPort: null, width: null, height: null })
        session.releaseInitialDataBuffer()
        const received = firstValueFrom(session.output$)
        mocks.handlers['data']!(new Uint8Array([104, 105]))
        expect(await received).toBe('hi')
    })

    it('exit 事件触发销毁', async () => {
        const session = new MoshSession()
        await session.start({ host: 'example.com', port: 22, user: 'root', moshPort: null, width: null, height: null })
        const destroyed = firstValueFrom(session.destroyed$)
        mocks.handlers['exit']!()
        await destroyed
        expect(session.open).toBe(false)
    })

    it('未启动时 resize 缓冲、启动后透传', async () => {
        const session = new MoshSession()
        session.resize(100, 30)
        await session.start({ host: 'example.com', port: 22, user: 'root', moshPort: null, width: null, height: null })
        session.resize(110, 35)
        expect(mocks.resize).toHaveBeenCalledWith(110, 35)
    })
})
