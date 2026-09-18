/**
 * @description 传输速度/ETA 纯函数（全局传输中心展示用）：由相邻任务快照的字节增量与
 *              时间差计算瞬时速度，EMA 平滑抑制抖动；ETA = 剩余字节 / 平滑速度。
 */

export interface SpeedSample {
    /** 快照时刻（Unix 毫秒） */
    at: number
    /** 已传输字节 */
    transferred: number
}

/** EMA 平滑系数（0-1，越大越跟随瞬时值） */
const EMA_ALPHA = 0.4

/**
 * @description 瞬时速度（字节/秒）：时间差或字节增量为非正时返回 null（无效样本）
 * @param prev 前一样本
 * @param next 当前样本
 * @returns number | null 字节每秒
 *
 * @example instantSpeed({ at: 1000, transferred: 1000 }, { at: 2000, transferred: 3000 }) // 2000
 *
 */
export function instantSpeed (prev: SpeedSample, next: SpeedSample): number | null {
    const dt = next.at - prev.at
    const db = next.transferred - prev.transferred
    if (dt <= 0 || db <= 0) {
        return null
    }
    return (db / dt) * 1000
}

/**
 * @description EMA 平滑速度（字节/秒）；speed 无效时沿用 prevSmoothed
 * @param prevSmoothed 上次平滑速度（null = 首个有效样本）
 * @param speed 本瞬时速度
 * @returns number | null
 *
 * @example smoothSpeed(null, 2000) // 2000
 *
 */
export function smoothSpeed (prevSmoothed: number | null, speed: number | null): number | null {
    if (speed === null) {
        return prevSmoothed
    }
    if (prevSmoothed === null) {
        return speed
    }
    return prevSmoothed * (1 - EMA_ALPHA) + speed * EMA_ALPHA
}

/**
 * @description 预计剩余秒数：剩余字节 / 平滑速度；总量未知或速度缺失时为 null
 * @param transferred 已传输字节
 * @param total 总字节（0 = 未知）
 * @param smoothed 平滑速度（字节/秒）
 * @returns number | null 秒
 *
 * @example etaSeconds(3000, 5000, 2000) // 1
 *
 */
export function etaSeconds (transferred: number, total: number, smoothed: number | null): number | null {
    if (total <= 0 || smoothed === null || smoothed <= 0) {
        return null
    }
    return Math.max(0, Math.ceil((total - transferred) / smoothed))
}

/**
 * @description 字节数人性化（B/KB/MB/GB/TB）
 * @param bytes 字节数
 * @returns string 如 "1.5 MB"
 *
 * @example formatBytes(1536) // "1.5 KB"
 *
 */
export function formatBytes (bytes: number): string {
    if (bytes < 1024) {
        return `${Math.round(bytes)} B`
    }
    const units = ['KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unit = 'B'
    for (const next of units) {
        if (value < 1024) {
            break
        }
        value /= 1024
        unit = next
    }
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`
}

/**
 * @description 速度人性化（字节/秒 → "1.2 MB/s"）；null 显示 "—"
 * @param bytesPerSecond 平滑速度
 * @returns string
 *
 * @example formatSpeed(1258291) // "1.2 MB/s"
 *
 */
export function formatSpeed (bytesPerSecond: number | null): string {
    return bytesPerSecond === null ? '—' : `${formatBytes(bytesPerSecond)}/s`
}

/**
 * @description 剩余秒数人性化（"3s" / "1m05s" / "2h03m"）；null 显示 "—"
 * @param seconds 剩余秒数
 * @returns string
 *
 * @example formatEta(63) // "1m03s"
 *
 */
export function formatEta (seconds: number | null): string {
    if (seconds === null) {
        return '—'
    }
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) {
        return `${h}h${String(m).padStart(2, '0')}m`
    }
    if (m > 0) {
        return `${m}m${String(s).padStart(2, '0')}s`
    }
    return `${s}s`
}
