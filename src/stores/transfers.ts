/**
 * @description 全局传输中心 store：订阅 Rust `sftp-transfers-changed` 事件维护任务快照，
 *              前端计算平滑速度（字节增量/时间差 EMA）；version 在每次快照变化时自增，
 *              供 SFTP 标签等消费方 watch 后刷新目录。
 */
import { defineStore } from 'pinia'
import { listen } from '@tauri-apps/api/event'
import { instantSpeed, smoothSpeed, type SpeedSample } from '@/lib/sftpTransferMath'
import { listTransfers, type TransferSnapshot } from '@/services/sftp'

/** 每任务速度跟踪态（展示派生，不入持久化） */
interface SpeedTracker {
    last: SpeedSample | null
    smoothed: number | null
}

export const useTransfersStore = defineStore('transfers', {
    state: () => ({
        transfers: [] as TransferSnapshot[],
        /** 任务 id → 平滑速度（字节/秒）；未知为 null */
        speeds: {} as Record<string, number | null>,
        /** 任务 id → 速度跟踪态（仅内存，展示派生） */
        speedTrackers: new Map<string, SpeedTracker>(),
        /** 快照变化计数器（消费方 watch 派生用） */
        version: 0,
        initialized: false,
    }),
    getters: {
        activeTransfers (state): TransferSnapshot[] {
            return state.transfers.filter(t => t.status === 'queued' || t.status === 'running')
        },
        hasFailure (state): boolean {
            return state.transfers.some(t => t.status === 'error' || t.status === 'canceled')
        },
    },
    actions: {
        /**
         * @description 初始化：订阅全局事件并拉取一次全量（幂等，App 挂载时调用）
         * @returns Promise<void>
         *
         * @example await useTransfersStore().init()
         *
         */
        async init (): Promise<void> {
            if (this.initialized) {
                return
            }
            this.initialized = true
            await listen<TransferSnapshot[]>('sftp-transfers-changed', event => {
                this.apply(event.payload)
            })
            this.transfers = await listTransfers(null)
            this.version += 1
        },
        /**
         * @description 应用一份全量快照：更新速度跟踪（running 任务的相邻样本差值 + EMA）
         * @param snapshots Rust 推送的任务快照数组
         * @returns void
         *
         */
        apply (snapshots: TransferSnapshot[]): void {
            const trackers = this.speedTrackers
            const seen = new Set<string>()
            const speeds: Record<string, number | null> = {}
            for (const snapshot of snapshots) {
                seen.add(snapshot.id)
                let tracker = trackers.get(snapshot.id)
                if (!tracker) {
                    tracker = { last: null, smoothed: null }
                    trackers.set(snapshot.id, tracker)
                }
                if (snapshot.status === 'running') {
                    const sample: SpeedSample = { at: Date.now(), transferred: snapshot.transferredBytes }
                    tracker.smoothed = smoothSpeed(tracker.smoothed, instantSpeed(tracker.last ?? sample, sample))
                    tracker.last = sample
                } else if (isTerminal(snapshot.status)) {
                    tracker.last = null
                    tracker.smoothed = null
                }
                speeds[snapshot.id] = tracker.smoothed
            }
            for (const id of trackers.keys()) {
                if (!seen.has(id)) {
                    trackers.delete(id)
                }
            }
            this.speeds = speeds
            this.transfers = snapshots
            this.version += 1
        },
    },
})

function isTerminal (status: TransferSnapshot['status']): boolean {
    return status === 'done' || status === 'error' || status === 'canceled'
}
