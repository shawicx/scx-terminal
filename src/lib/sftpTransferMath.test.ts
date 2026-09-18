/**
 * @description 传输速度/ETA 纯函数单测：瞬时速度、EMA 平滑、ETA、字节数/速度/剩余时间格式化。
 */
import { describe, expect, it } from 'vitest'
import {
    etaSeconds,
    formatBytes,
    formatEta,
    formatSpeed,
    instantSpeed,
    smoothSpeed,
} from './sftpTransferMath'

describe('sftpTransferMath', () => {
    it('instantSpeed 由相邻样本差值计算', () => {
        expect(instantSpeed({ at: 1000, transferred: 1000 }, { at: 2000, transferred: 3000 })).toBe(2000)
        expect(instantSpeed({ at: 1000, transferred: 3000 }, { at: 2000, transferred: 3000 })).toBeNull()
        expect(instantSpeed({ at: 2000, transferred: 1000 }, { at: 1000, transferred: 3000 })).toBeNull()
    })

    it('smoothSpeed EMA 平滑且无效样本沿用旧值', () => {
        expect(smoothSpeed(null, 2000)).toBe(2000)
        expect(smoothSpeed(1000, 2000)).toBe(1000 * 0.6 + 2000 * 0.4)
        expect(smoothSpeed(1500, null)).toBe(1500)
    })

    it('etaSeconds 未知总量或无速度时为 null', () => {
        expect(etaSeconds(3000, 5000, 2000)).toBe(1)
        expect(etaSeconds(0, 0, 2000)).toBeNull()
        expect(etaSeconds(100, 5000, null)).toBeNull()
        expect(etaSeconds(100, 5000, 0)).toBeNull()
        // 已超传钳到 0
        expect(etaSeconds(6000, 5000, 2000)).toBe(0)
    })

    it('formatBytes 单位进位', () => {
        expect(formatBytes(512)).toBe('512 B')
        expect(formatBytes(1536)).toBe('1.5 KB')
        expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.5 MB')
    })

    it('formatSpeed / formatEta 展示', () => {
        expect(formatSpeed(null)).toBe('—')
        expect(formatSpeed(1024)).toBe('1.0 KB/s')
        expect(formatEta(null)).toBe('—')
        expect(formatEta(45)).toBe('45s')
        expect(formatEta(63)).toBe('1m03s')
        expect(formatEta(3660)).toBe('1h01m')
    })
})
