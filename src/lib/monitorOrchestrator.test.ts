/**
 * @description MonitorOrchestrator 纯逻辑单测：卡片启停串行、详情升降级、
 *              fatal 重连退避、面板存活时卡片停止不清连接。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonitorOrchestrator, type MonitorDeps, RETRY_DELAYS_MS } from '@/lib/monitorOrchestrator'

interface Calls { op: string; args: unknown[] }

function makeDeps () {
    const calls: Calls[] = []
    const deps: MonitorDeps = {
        acquire: vi.fn(async (id: string) => {
            calls.push({ op: 'acquire', args: [id] })
            return `ssh-${id}`
        }),
        release: vi.fn((id: string) => {
            calls.push({ op: 'release', args: [id] })
        }),
        start: vi.fn(async (id: string, _sshId: string, level: string) => {
            calls.push({ op: `start:${level}`, args: [id] })
        }),
        stop: vi.fn(async (id: string) => {
            calls.push({ op: 'stop', args: [id] })
        }),
        reportError: vi.fn((id: string, message: string) => {
            calls.push({ op: 'report', args: [id, message] })
        }),
    }
    return { deps, calls }
}

function ops (calls: Calls[]): string[] {
    return calls.map(c => c.op)
}

describe('MonitorOrchestrator', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('startCard acquires and starts each profile serially, errors do not block', async () => {
        const { deps, calls } = makeDeps()
        ;(deps.acquire as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
            calls.push({ op: 'acquire', args: [id] })
            if (id === 'p2') {
                throw new Error('connect failed')
            }
            return `ssh-${id}`
        })
        const o = new MonitorOrchestrator(deps)
        const task = o.startCard(['p1', 'p2', 'p3'])
        await vi.advanceTimersByTimeAsync(2000)
        await task
        expect(ops(calls)).toEqual([
            'acquire', 'start:card', // p1 成功
            'acquire', 'report', // p2 建连失败：记错误继续
            'acquire', 'start:card', // p3 成功
        ])
    })

    it('stopCard keeps connections of profiles with a live detail binding', async () => {
        const { deps, calls } = makeDeps()
        const o = new MonitorOrchestrator(deps)
        const t1 = o.startCard(['p1', 'p2'])
        await vi.advanceTimersByTimeAsync(2000)
        await t1
        calls.length = 0
        const t2 = o.bindDetail('p1')
        await t2
        calls.length = 0
        const t3 = o.stopCard()
        await t3
        // p1 有详情绑定：不停不释放；p2 无：stop + release
        expect(ops(calls)).toEqual(['stop', 'release'])
    })

    it('unbindDetail downgrades to card when card monitoring is active, else stops', async () => {
        const { deps, calls } = makeDeps()
        const o = new MonitorOrchestrator(deps)
        const t1 = o.startCard(['p1'])
        await vi.advanceTimersByTimeAsync(1000)
        await t1
        await o.bindDetail('p1') // 升级 full
        calls.length = 0
        await o.unbindDetail('p1') // 卡片监控仍活着 → 降级 card，不 stop（重取连接，注册表去重）
        expect(ops(calls)).toEqual(['acquire', 'start:card'])
        calls.length = 0
        await o.stopCard()
        await o.unbindDetail('p1') // 无详情绑定 → 幂等 no-op（stopCard 的停释已发生）
        expect(ops(calls)).toEqual(['stop', 'release'])
        // 无卡片监控时绑定再解绑 → stop + release
        await o.bindDetail('p1')
        calls.length = 0
        await o.unbindDetail('p1')
        expect(ops(calls)).toEqual(['stop', 'release'])
    })

    it('onFatal retries with backoff and resets on success', async () => {
        const { deps, calls } = makeDeps()
        const o = new MonitorOrchestrator(deps)
        const t = o.startCard(['p1'])
        await vi.advanceTimersByTimeAsync(1000)
        await t
        calls.length = 0
        // 第一次 fatal：同步 report 后退避 1s，触发 release + acquire + start
        void o.onFatal('p1')
        await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]!)
        expect(ops(calls)).toEqual(['report', 'release', 'acquire', 'start:card'])
        // 第二次 fatal：成功重连后退避已重置为 1s（期间只见到同步 report）
        calls.length = 0
        void o.onFatal('p1')
        await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]! - 10)
        expect(ops(calls)).toEqual(['report'])
        await vi.advanceTimersByTimeAsync(20)
        expect(ops(calls)).toEqual(['report', 'release', 'acquire', 'start:card'])
    })

    it('fatal for unknown profile is ignored', async () => {
        const { deps, calls } = makeDeps()
        const o = new MonitorOrchestrator(deps)
        void o.onFatal('ghost')
        await vi.advanceTimersByTimeAsync(20000)
        expect(ops(calls)).toEqual([])
    })

    it('stopCard during stagger prevents late hosts (epoch guard)', async () => {
        const { deps, calls } = makeDeps()
        const o = new MonitorOrchestrator(deps)
        const task = o.startCard(['p1', 'p2', 'p3'])
        // p1 建连完成、尚在 500ms 错峰睡眠内（<500ms）停止：epoch 失效
        await vi.advanceTimersByTimeAsync(100)
        await o.stopCard()
        await vi.advanceTimersByTimeAsync(2000)
        await task
        // 停止后不得再出现 p2/p3 的建连/启动（否则成为无人停止的孤儿采样）
        expect(ops(calls)).toEqual(['acquire', 'start:card', 'stop', 'release'])
        const cardIds = (o as unknown as { cardIds: Set<string> }).cardIds
        expect(cardIds.size).toBe(0)
    })

    it('bindDetail arriving mid-stagger is not downgraded by the late card loop', async () => {
        const { deps, calls } = makeDeps()
        const o = new MonitorOrchestrator(deps)
        const task = o.startCard(['p1', 'p2'])
        await vi.advanceTimersByTimeAsync(100) // p1 完成，错峰睡眠中
        await o.bindDetail('p2') // 睡眠期间到达的详情绑定：升级 full
        await vi.advanceTimersByTimeAsync(2000)
        await task
        // p2 只见详情级 acquire + start:full，迟到的卡片循环不得再降级 ensure
        expect(ops(calls)).toEqual(['acquire', 'start:card', 'acquire', 'start:full'])
        const cardIds = (o as unknown as { cardIds: Set<string> }).cardIds
        expect(cardIds.has('p2')).toBe(false)
    })
})
