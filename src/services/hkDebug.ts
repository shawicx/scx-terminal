/**
 * @description 临时调试日志（debug/cmdt-double 分支专用）：微任务延迟转发到 Rust stdout，
 *              不扰动按键同步处理路径；正式修复合入后本文件与全部调用点一并删除
 * @param message 日志内容
 * @returns void
 *
 */
import { invoke } from '@tauri-apps/api/core'

export function hkLog (message: string): void {
    queueMicrotask(() => {
        try {
            void invoke('dev_log', { message: `[hk] ${message}` }).catch(() => {})
        } catch {
            // 非 Tauri 环境（vitest）下静默
        }
    })
}
