/**
 * @description 自动更新服务：手动检查（check 的三条路径透传给调用方，安装流程
 *              聚合下载进度并在成功后按需清除扩展属性、重启应用）与启动自动
 *              检查（advanced.updateAutoCheck：发现新版本发系统通知，AboutPage
 *              挂载时接管 knownUpdate 直接弹安装确认框）。
 */
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { invoke } from '@tauri-apps/api/core'
import i18n from '@/i18n'
import { useConfigStore } from '@/stores/config'
import { sendAppNotification } from '@/services/notifications'

/** 下载进度快照；total 未知时 percent 为 null（按钮只显示已收字节数） */
export interface UpdateProgress {
    total: number | null
    received: number
    percent: number | null
}

/** 启动自动检查发现的待安装更新（AboutPage 挂载时经 getKnownUpdate 接管） */
let knownUpdate: Update | null = null

/**
 * @description 取启动自动检查已发现的新版本（有值时 AboutPage 直接弹确认框）
 * @returns Update | null 已发现的更新；null = 未发现/未检查
 *
 * @example const update = getKnownUpdate()
 *
 */
export function getKnownUpdate (): Update | null {
    return knownUpdate
}

/**
 * @description 检查更新（网络/端点失败会抛出，由调用方区分「已是最新」与「检查失败」）
 * @returns Promise<Update | null> 待安装的更新；null = 已是最新
 *
 * @example const update = await checkForUpdate()
 *
 */
export async function checkForUpdate (): Promise<Update | null> {
    return await check()
}

/**
 * @description 下载并安装更新，完成后重启应用；下载失败时抛出且不重启。
 *              安装成功后、重启前调用 beforeRelaunch（更新器收尾，如清除应用
 *              扩展属性），回调失败只记日志、不阻断重启
 * @param update checkForUpdate 返回的待安装更新
 * @param onProgress 进度回调（可选）
 * @param beforeRelaunch 安装完成后的收尾回调（可选）
 * @returns Promise<void>
 *
 * @example await installUpdate(update, p => console.log(p.percent), clearXattr)
 *
 */
export async function installUpdate (update: Update, onProgress?: (progress: UpdateProgress) => void, beforeRelaunch?: () => Promise<void>): Promise<void> {
    let total: number | null = null
    let received = 0
    await update.downloadAndInstall(event => {
        switch (event.event) {
            case 'Started':
                total = event.data.contentLength ?? null
                break
            case 'Progress':
                received += event.data.chunkLength ?? 0
                break
            case 'Finished':
                break
        }
        const percent = total && total > 0 ? Math.floor((received / total) * 100) : null
        onProgress?.({ total, received, percent })
    })
    if (beforeRelaunch) {
        try {
            await beforeRelaunch()
        } catch (error) {
            console.error('[updater] before-relaunch hook failed:', error)
        }
    }
    await relaunch()
}

/**
 * @description 启动自动检查（advanced.updateAutoCheck 关闭时直接返回）：静默检查
 *              新版本，发现时记入 knownUpdate 并发送系统通知引导到设置·关于页；
 *              网络/端点失败静默吞掉（启动后台检查不打扰用户）
 * @returns Promise<void>
 *
 * @example await startupAutoCheck()
 *
 */
export async function startupAutoCheck (): Promise<void> {
    if (!useConfigStore().store.advanced.updateAutoCheck) {
        return
    }
    try {
        const update = await checkForUpdate()
        if (update) {
            knownUpdate = update
            const { t } = i18n.global
            await sendAppNotification(t('settings.updateNotifyTitle'), t('settings.updateNotifyBody', { v: update.version }))
        }
    } catch (error) {
        console.error('[updater] startup check failed:', error)
        void invoke('dev_log', { message: `[updater] startup check failed: ${String(error)}` }).catch(() => {})
    }
}
