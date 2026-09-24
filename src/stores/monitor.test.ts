/**
 * @description monitor store 单测：环形缓冲淘汰、错误哨兵、clear 清理。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn().mockResolvedValue(() => {}),
}))

import { useMonitorStore } from '@/stores/monitor'
import type { MonitorSample } from '@/services/monitor'

function sample (ts: number): MonitorSample {
    return {
        ts,
        cpuPercent: 10,
        cpuCores: 4,
        load: [0, 0, 0],
        mem: { totalKb: 100, usedKb: 50, percent: 50 },
        swap: { totalKb: 0, usedKb: 0, percent: 0 },
        uptimeS: 1,
        netRates: [],
        disks: null,
        processes: null,
        osInfo: null,
    }
}

describe('monitor store', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('apply maintains a 150-point ring buffer', () => {
        const store = useMonitorStore()
        for (let i = 0; i < 160; i++) {
            store.apply('p1', sample(i))
        }
        expect(store.samples.p1!.length).toBe(150)
        expect(store.samples.p1![0]!.ts).toBe(10) // 最旧 10 被淘汰
        expect(store.samples.p1![149]!.ts).toBe(159)
        expect(store.latest.p1!.ts).toBe(159)
    })

    it('apply keeps last-known disks/processes/osInfo in latest across sparse rounds', () => {
        // 磁盘/进程每 3 轮一次、osInfo 仅首轮：latest 作为展示快照应保留最近已知值，
        // 否则面板 v-if 间歇失效（一会有一会没有）
        const store = useMonitorStore()
        const lowFreq = {
            ...sample(0),
            disks: [{ fs: '/dev/sda1', mount: '/', totalKb: 1, usedKb: 0, percent: 0 }],
            processes: [{ pid: 1, command: 'init', cpuPercent: 0, memPercent: 0 }],
            osInfo: 'Ubuntu 22.04',
        }
        store.apply('p1', lowFreq)
        store.apply('p1', sample(2)) // 高频轮：三字段均为 null
        store.apply('p1', sample(4))
        expect(store.latest.p1!.disks).toHaveLength(1) // 保留最近已知
        expect(store.latest.p1!.processes).toHaveLength(1)
        expect(store.latest.p1!.osInfo).toBe('Ubuntu 22.04')
        // 原始历史不合并：samples 里高频轮保持 null（图表 null 语义不变）
        expect(store.samples.p1![1]!.disks).toBeNull()
        expect(store.samples.p1![1]!.osInfo).toBeNull()
    })

    it('apply clears previous error', () => {
        const store = useMonitorStore()
        store.applyError('p1', 'boom')
        store.apply('p1', sample(1))
        expect(store.errors.p1).toBeUndefined()
    })

    it('applyUnsupported sets sentinel and applyError keeps raw message', () => {
        const store = useMonitorStore()
        store.applyUnsupported('p1')
        expect(store.errors.p1).toBe('unsupported')
        store.applyError('p1', 'timeout')
        expect(store.errors.p1).toBe('timeout')
    })

    it('clear removes all entries for the profile', () => {
        const store = useMonitorStore()
        store.apply('p1', sample(1))
        store.applyError('p2', 'x')
        store.clear('p1')
        store.clear('p2')
        expect(store.latest.p1).toBeUndefined()
        expect(store.samples.p1).toBeUndefined()
        expect(store.errors.p2).toBeUndefined()
    })
})
