/**
 * @description Mosh 服务封装：客户端可用性探测（Rust mosh_detect 的 invoke 薄包装）
 */
import { invoke } from '@tauri-apps/api/core'

/**
 * @description 探测本机是否安装 mosh 客户端（PATH 遍历 + 可执行位检查）
 * @returns Promise<string | null> mosh 可执行文件绝对路径；未安装 / Windows 为 null
 *
 * @example const path = await detectMosh()
 *
 */
export async function detectMosh (): Promise<string | null> {
    return invoke<string | null>('mosh_detect')
}
