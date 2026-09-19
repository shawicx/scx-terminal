/**
 * @description 终端背景图片应用服务：从 Rust 读回图片 bytes 转 blob URL 写入全局
 *              CSS 变量（--term-bg-*），TerminalPane 背景层消费；填充方式纯变量写入。
 *              模块级持有 objectURL，替换时 revoke；无图/读失败降级为 none。
 */
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { mapBackgroundFit, type BackgroundFit } from '@/lib/backgroundImage'

/** 当前背景预览 URL（设置页缩略图复用；无图为 null） */
export const backgroundPreviewUrl = ref<string | null>(null)

/** 当前已创建的 objectURL（替换时 revoke 防泄漏） */
let currentUrl: string | null = null

/**
 * @description 文件扩展到 MIME 的映射（blob 类型；未知扩展给通用二进制，浏览器按内容嗅探）
 * @param fileName 配置中的背景文件名（background.png 等）
 * @returns string MIME 类型
 */
function mimeForFileName (fileName: string): string {
    const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
    switch (extension) {
        case 'png': return 'image/png'
        case 'jpg': case 'jpeg': return 'image/jpeg'
        case 'webp': return 'image/webp'
        case 'gif': return 'image/gif'
        case 'bmp': return 'image/bmp'
        default: return 'application/octet-stream'
    }
}

/**
 * @description 写全局 CSS 变量（省略样板）
 * @param name 变量名（--term-bg-*）
 * @param value 值
 * @returns void
 */
function setCssVar (name: string, value: string): void {
    document.documentElement.style.setProperty(name, value)
}

/**
 * @description 应用/清除背景图片：null 或读失败 → CSS 变量置 none；否则 load bytes →
 *              blob URL → 写 --term-bg-image 并更新预览。读失败不清配置（重选即恢复）
 * @param fileName 配置中的背景文件名；null = 清除
 * @returns Promise<void>
 *
 * @example await setBackgroundImageFile(config.appearance.backgroundImage)
 *
 */
export async function setBackgroundImageFile (fileName: string | null): Promise<void> {
    if (currentUrl !== null) {
        URL.revokeObjectURL(currentUrl)
        currentUrl = null
    }
    if (fileName === null) {
        backgroundPreviewUrl.value = null
        setCssVar('--term-bg-image', 'none')
        return
    }
    try {
        const bytes = await invoke<number[]>('background_image_load')
        if (bytes === null || bytes.length === 0) {
            throw new Error('background image file missing')
        }
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeForFileName(fileName) }))
        currentUrl = url
        backgroundPreviewUrl.value = url
        setCssVar('--term-bg-image', `url(${url})`)
    } catch (error) {
        // 文件缺失/读取失败：降级为无图，配置保留（用户重新选图即恢复）
        console.warn('failed to load background image, falling back to none', error)
        backgroundPreviewUrl.value = null
        setCssVar('--term-bg-image', 'none')
    }
}

/**
 * @description 应用填充方式（纯 CSS 变量写入，不重读图片文件）
 * @param fit 填充方式
 * @returns void
 *
 * @example setBackgroundFit('contain')
 *
 */
export function setBackgroundFit (fit: BackgroundFit): void {
    const styles = mapBackgroundFit(fit)
    setCssVar('--term-bg-size', styles.backgroundSize)
    setCssVar('--term-bg-repeat', styles.backgroundRepeat)
    setCssVar('--term-bg-position', styles.backgroundPosition)
}
