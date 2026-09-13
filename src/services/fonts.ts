/**
 * @description 系统字体枚举的 Tauri IPC 薄封装；命令失败时返回空数组（UI 回退自由文本输入）
 */
import { invoke } from '@tauri-apps/api/core'

/**
 * @description 列出系统全部字体族名（去重排序）
 * @returns Promise<string[]> 字体族名列表；命令不可用时为空数组
 *
 * @example listSystemFonts() // ['Al Nile', 'Arial', ...]
 *
 */
export async function listSystemFonts (): Promise<string[]> {
    try {
        return await invoke<string[]>('list_fonts')
    } catch {
        return []
    }
}
