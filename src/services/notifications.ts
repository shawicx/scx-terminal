/**
 * @description 后台标签响铃的系统通知服务：读外观分片开关、按标签节流
 *              （BEL 常连续触发）、权限拒绝时静默降级为仅标签未读标记。
 */
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { useConfigStore } from '@/stores/config'

/** 同一标签两条系统通知的最小间隔（ms） */
const BELL_THROTTLE_MS = 5000

/** tabId → 上次实际发出通知的时间戳 */
const lastSentAt = new Map<string, number>()

/**
 * @description 确保系统通知权限：已授权直接通过，未授权发起一次请求
 * @returns Promise<boolean> 权限是否可用
 *
 * @example await ensureNotificationPermission()
 *
 */
export async function ensureNotificationPermission (): Promise<boolean> {
    let granted = await isPermissionGranted()
    if (!granted) {
        granted = (await requestPermission()) === 'granted'
    }
    return granted
}

/**
 * @description 为后台标签的响铃发送系统通知（外观分片开关关闭时不发；
 *              同一标签 5s 内只发一条；权限不可用时静默跳过）
 * @param tabId 标签 id（节流键）
 * @param title 通知标题（标签显示名）
 * @param body 通知正文（可选，由调用方本地化）
 * @returns Promise<void>
 *
 * @example await sendBellNotification('tab-1', 'zsh — dev', '终端响铃')
 *
 */
export async function sendBellNotification (tabId: string, title: string, body?: string): Promise<void> {
    if (!useConfigStore().store.appearance.bellNotifications) {
        return
    }
    const now = Date.now()
    if (now - (lastSentAt.get(tabId) ?? 0) < BELL_THROTTLE_MS) {
        return
    }
    if (!(await ensureNotificationPermission())) {
        return
    }
    lastSentAt.set(tabId, now)
    sendNotification({ title, body })
}
