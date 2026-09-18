/**
 * @description 端口转发 IPC 封装：forward_start/stop/list 命令 + `forward:{sshId}:changed`
 *              事件订阅（负载为该连接完整状态快照）。生命周期与 SFTP 一致：SSH 会话断开
 *              后后端级联停止全部转发并广播空快照。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ForwardSpec, ForwardState } from '@/lib/portForwarding'

/**
 * @description 建立一条转发（本地/远程/动态；listenPort=0 由 OS/server 分配并在返回值回填）
 * @param spec 转发参数
 * @returns Promise<ForwardState> 初始运行态；参数非法/连接不存在/监听失败以错误文本 reject
 *
 * @example const state = await startForward({ sshId, kind: 'local', listenHost: '127.0.0.1', listenPort: 0, targetHost: 'db', targetPort: 5432, ruleId: null })
 *
 */
export function startForward (spec: ForwardSpec): Promise<ForwardState> {
    return invoke<ForwardState>('forward_start', { options: spec })
}

/**
 * @description 停止一条转发（remote 先取消 server 监听；全部连接随任务中止）
 * @param id 转发 id（ForwardState.id）
 * @returns Promise<void>
 *
 * @example await stopForward(state.id)
 *
 */
export function stopForward (id: string): Promise<void> {
    return invoke<void>('forward_stop', { id })
}

/**
 * @description 列出某 SSH 连接的全部转发状态（面板打开时全量拉取）
 * @param sshId SSH 会话 id
 * @returns Promise<ForwardState[]>（连接不存在时为空数组）
 *
 * @example const states = await listForwards(sshId)
 *
 */
export function listForwards (sshId: string): Promise<ForwardState[]> {
    return invoke<ForwardState[]>('forward_list', { sshId })
}

/**
 * @description 订阅某 SSH 连接的转发状态变化（快照全量同步，直接整体替换本地状态）
 * @param sshId SSH 会话 id
 * @param cb 快照回调
 * @returns Promise<UnlistenFn> 取消订阅函数（组件卸载时调用）
 *
 * @example const off = await onForwardsChanged(sshId, states => { active.value = states })
 *
 */
export async function onForwardsChanged (sshId: string, cb: (states: ForwardState[]) => void): Promise<UnlistenFn> {
    return listen<ForwardState[]>(`forward:${sshId}:changed`, event => cb(event.payload))
}
