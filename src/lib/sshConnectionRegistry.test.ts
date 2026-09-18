/**
 * @description SshConnectionRegistry 单测：窗格会话复用、headless 并发连接合并、
 *              引用计数与宽限关闭、死亡登记与存活判定。IO 全部以桩注入。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SshConnectionRegistry } from './sshConnectionRegistry'

function makeRegistry (connectImpl?: (profileId: string) => Promise<string>) {
    const disconnect = vi.fn()
    const connect = vi.fn(connectImpl ?? (async () => 'headless-1'))
    const registry = new SshConnectionRegistry({ connect, disconnect, graceMs: 1000 })
    return { registry, connect, disconnect }
}

describe('SshConnectionRegistry', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('acquire 复用已登记的窗格会话且不触发连接', async () => {
        const { registry, connect } = makeRegistry()
        registry.registerPaneSession('p1', 'pane-a')
        registry.registerPaneSession('p1', 'pane-b')
        await expect(registry.acquire('p1', 'tab-1')).resolves.toBe('pane-b')
        expect(connect).not.toHaveBeenCalled()
    })

    it('并发 acquire 只建立一次 headless 连接且共享 sshId', async () => {
        const { registry, connect } = makeRegistry(async () => {
            // 假定时器下用 advanceTimersByTimeAsync 制造异步延迟
            await vi.advanceTimersByTimeAsync(50)
            return 'headless-1'
        })
        const [a, b] = await Promise.all([
            registry.acquire('p1', 'tab-1'),
            registry.acquire('p1', 'tab-2'),
        ])
        expect(a).toBe('headless-1')
        expect(b).toBe('headless-1')
        expect(connect).toHaveBeenCalledTimes(1)
        // 两个消费者都在集合中
        registry.release('p1', 'tab-1')
        expect(registry.headlessSshIdFor('p1')).toBe('headless-1')
    })

    it('消费者归零后宽限期满断开；期内再 acquire 复用', async () => {
        const { registry, disconnect } = makeRegistry()
        await registry.acquire('p1', 'tab-1')
        registry.release('p1', 'tab-1')
        vi.advanceTimersByTime(999)
        expect(disconnect).not.toHaveBeenCalled()
        // 宽限期内重新获取：取消关闭定时器
        await registry.acquire('p1', 'tab-2')
        vi.advanceTimersByTime(5000)
        expect(disconnect).not.toHaveBeenCalled()
        // 再次归零并放过宽限期
        registry.release('p1', 'tab-2')
        vi.advanceTimersByTime(1000)
        expect(disconnect).toHaveBeenCalledWith('headless-1')
        expect(registry.headlessSshIdFor('p1')).toBeNull()
    })

    it('headless 建连失败后可再次重试', async () => {
        let calls = 0
        const { registry } = makeRegistry(async () => {
            calls += 1
            if (calls === 1) {
                throw new Error('connect failed')
            }
            return 'headless-2'
        })
        await expect(registry.acquire('p1', 'tab-1')).rejects.toThrow('connect failed')
        await expect(registry.acquire('p1', 'tab-1')).resolves.toBe('headless-2')
    })

    it('noteHeadlessDead 移除登记并使 isAlive 为假', async () => {
        let seq = 0
        const { registry, connect } = makeRegistry(async () => {
            seq += 1
            return `headless-${seq}`
        })
        const sshId = await registry.acquire('p1', 'tab-1')
        expect(registry.isAlive('p1', sshId)).toBe(true)
        registry.noteHeadlessDead(sshId)
        expect(registry.isAlive('p1', sshId)).toBe(false)
        expect(registry.headlessSshIdFor('p1')).toBeNull()
        // 死亡后再次 acquire 会重新建连（新 sshId）
        const next = await registry.acquire('p1', 'tab-1')
        expect(next).not.toBe(sshId)
        expect(connect).toHaveBeenCalledTimes(2)
    })

    it('unregisterPaneSession 清理对应会话记录', () => {
        const { registry } = makeRegistry()
        registry.registerPaneSession('p1', 'pane-a')
        registry.registerPaneSession('p1', 'pane-b')
        expect(registry.paneSshIdFor('p1')).toBe('pane-b')
        registry.unregisterPaneSession('p1', 'pane-b')
        expect(registry.paneSshIdFor('p1')).toBe('pane-a')
        registry.unregisterPaneSession('p1', 'pane-a')
        expect(registry.paneSshIdFor('p1')).toBeNull()
        expect(registry.hasPaneSessions('p1')).toBe(false)
    })
})
