/**
 * @description SSH 服务器监控服务：Rust MonitorManager 的 invoke 封装与
 *              MonitorSample 事件负载类型（serde camelCase 镜像）。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { MonitorOrchestrator } from '@/lib/monitorOrchestrator'
import { acquireConnection, releaseConnection } from '@/services/sshConnections'
import { useMonitorStore } from '@/stores/monitor'

/** 内存/交换分区用量 */
export interface MemInfo {
    totalKb: number
    usedKb: number
    percent: number
}

/** 单网卡实时速率（KB/s） */
export interface NetRate {
    name: string
    rxKbS: number
    txKbS: number
}

/** 单磁盘分区用量 */
export interface DiskInfo {
    fs: string
    mount: string
    totalKb: number
    usedKb: number
    percent: number
}

/** 单进程快照 */
export interface ProcessInfo {
    pid: number
    command: string
    cpuPercent: number
    memPercent: number
}

/** 一次采样的全部指标（monitor-sample 事件内嵌） */
export interface MonitorSample {
    ts: number
    cpuPercent: number | null
    cpuCores: number
    load: [number, number, number]
    mem: MemInfo
    swap: MemInfo
    uptimeS: number
    netRates: NetRate[] | null
    disks: DiskInfo[] | null
    processes: ProcessInfo[] | null
    osInfo: string | null
}

/** monitor-* 事件 payload（sample 携带 sample；错误类只携带 message） */
export interface MonitorEventPayload {
    profileId: string
    sample?: MonitorSample
    message?: string
}

/** 采样等级：card = 5s 核心指标；full = 2s 核心 + 低频组 */
export type MonitorLevel = 'card' | 'full'

/**
 * @description 启动（或重启）档案的采样任务；对已在跑任务按新等级重启（升级/降级同入口）
 * @param profileId 档案 id
 * @param sshId 采样的 SSH 连接 id
 * @param level 采样等级
 * @returns Promise<void>
 *
 * @example await monitorStart('ssh-1', 'ssh-abc', 'full')
 *
 */
export async function monitorStart (profileId: string, sshId: string, level: MonitorLevel): Promise<void> {
    await invoke('monitor_start', { profileId, sshId, level })
}

/**
 * @description 停止档案的采样任务（无任务时幂等）
 * @param profileId 档案 id
 * @returns Promise<void>
 *
 * @example await monitorStop('ssh-1')
 *
 */
export async function monitorStop (profileId: string): Promise<void> {
    await invoke('monitor_stop', { profileId })
}

const orchestrator = new MonitorOrchestrator({
    acquire: acquireConnection,
    release: releaseConnection,
    start: monitorStart,
    stop: monitorStop,
    reportError: (profileId, message) => {
        useMonitorStore().applyError(profileId, message)
    },
})

/**
 * @description 启动连接中心的卡片级监控（StartPageContent 挂载时调用）
 * @param profileIds 全部 SSH 档案 id
 * @returns void
 *
 * @example startCardMonitoring(sshProfileIds)
 *
 */
export function startCardMonitoring (profileIds: string[]): void {
    void orchestrator.startCard(profileIds)
}

/**
 * @description 停止卡片级监控（StartPageContent 卸载时调用；详情面板存活的档案跳过）
 * @returns void
 *
 * @example stopCardMonitoring()
 *
 */
export function stopCardMonitoring (): void {
    void orchestrator.stopCard()
}

/**
 * @description 绑定监控侧栏（TerminalTabContent 按「标签激活 && 侧栏展开」调用，升级 full）
 * @param profileId 档案 id
 * @returns void
 *
 * @example bindDetailMonitor('ssh-1')
 *
 */
export function bindDetailMonitor (profileId: string): void {
    void orchestrator.bindDetail(profileId)
}

/**
 * @description 解绑监控详情面板（卸载时调用：卡片存活降级 card，否则停并释放）
 * @param profileId 档案 id
 * @returns void
 *
 * @example unbindDetailMonitor('ssh-1')
 *
 */
export function unbindDetailMonitor (profileId: string): void {
    void orchestrator.unbindDetail(profileId)
}

let eventsBound = false

/**
 * @description 订阅 monitor-fatal → 编排器重连（幂等，App 挂载时与 store.init 并行调用）
 * @returns Promise<void>
 *
 * @example await initMonitorEvents()
 *
 */
export async function initMonitorEvents (): Promise<void> {
    if (eventsBound) {
        return
    }
    eventsBound = true
    await listen<MonitorEventPayload>('monitor-fatal', event => {
        if (event.payload.profileId) {
            orchestrator.onFatal(event.payload.profileId)
        }
    })
}
