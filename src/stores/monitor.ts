/**
 * @description 全局监控 store：订阅 Rust monitor-* 事件维护每档案最新样本与
 *              150 点环形缓冲；errors 用哨兵值（'unsupported' / 'reconnecting'）
 *              与原始错误文本，UI 侧按哨兵映射文案。
 */
import { defineStore } from 'pinia'
import { listen } from '@tauri-apps/api/event'
import { type MonitorEventPayload, type MonitorSample } from '@/services/monitor'

/** 环形缓冲上限（full 级 2s ≈ 5 分钟窗口） */
export const MAX_SAMPLES = 150

export const useMonitorStore = defineStore('monitor', {
    state: () => ({
        latest: {} as Record<string, MonitorSample>,
        samples: {} as Record<string, MonitorSample[]>,
        errors: {} as Record<string, string>,
        initialized: false,
    }),
    actions: {
        /**
         * @description 初始化：订阅 monitor-* 全局事件（幂等，App 挂载时调用）
         * @returns Promise<void>
         *
         * @example await useMonitorStore().init()
         *
         */
        async init (): Promise<void> {
            if (this.initialized) {
                return
            }
            this.initialized = true
            await listen<MonitorEventPayload>('monitor-sample', event => {
                const { profileId, sample } = event.payload
                if (profileId && sample) {
                    this.apply(profileId, sample)
                }
            })
            await listen<MonitorEventPayload>('monitor-sample-error', event => {
                if (event.payload.profileId) {
                    this.applyError(event.payload.profileId, event.payload.message ?? '')
                }
            })
            await listen<MonitorEventPayload>('monitor-unsupported', event => {
                if (event.payload.profileId) {
                    this.applyUnsupported(event.payload.profileId)
                }
            })
        },
        /**
         * @description 应用一份样本：写 latest、追加环形缓冲（溢出丢最旧）、清除错误态
         * @param profileId 档案 id
         * @param sample 样本
         * @returns void
         *
         * @example store.apply('ssh-1', sample)
         *
         */
        apply (profileId: string, sample: MonitorSample): void {
            // latest 是展示快照：磁盘/进程（每 3 轮一次）与 osInfo（仅首轮）为间歇字段，
            // 保留最近已知值，避免面板 v-if 间歇失效；samples 保持原始历史（图表 null 语义）
            const prev = this.latest[profileId]
            this.latest[profileId] = {
                ...sample,
                cpuPercent: sample.cpuPercent ?? prev?.cpuPercent ?? null,
                netRates: sample.netRates ?? prev?.netRates ?? null,
                disks: sample.disks ?? prev?.disks ?? null,
                processes: sample.processes ?? prev?.processes ?? null,
                osInfo: sample.osInfo ?? prev?.osInfo ?? null,
            }
            const series = this.samples[profileId] ?? (this.samples[profileId] = [])
            series.push(sample)
            if (series.length > MAX_SAMPLES) {
                series.splice(0, series.length - MAX_SAMPLES)
            }
            delete this.errors[profileId]
        },
        /**
         * @description 记录采集错误（原始文本；下次成功采样自动清除）
         * @param profileId 档案 id
         * @param message 错误文本
         * @returns void
         *
         * @example store.applyError('ssh-1', 'timeout')
         *
         */
        applyError (profileId: string, message: string): void {
            this.errors[profileId] = message
        },
        /**
         * @description 标记平台不支持（终态哨兵，UI 显示「仅支持 Linux」）
         * @param profileId 档案 id
         * @returns void
         *
         * @example store.applyUnsupported('ssh-1')
         *
         */
        applyUnsupported (profileId: string): void {
            this.errors[profileId] = 'unsupported'
        },
        /**
         * @description 清除档案全部监控状态
         * @param profileId 档案 id
         * @returns void
         *
         * @example store.clear('ssh-1')
         *
         */
        clear (profileId: string): void {
            delete this.latest[profileId]
            delete this.samples[profileId]
            delete this.errors[profileId]
        },
    },
})
