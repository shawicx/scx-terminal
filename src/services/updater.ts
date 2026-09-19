/**
 * @description 自动更新服务（仅手动检查）：check 的三条路径透传给调用方，
 *              安装流程聚合下载进度并在成功后重启应用（失败不重启）。
 */
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

/** 下载进度快照；total 未知时 percent 为 null（按钮只显示已收字节数） */
export interface UpdateProgress {
    total: number | null
    received: number
    percent: number | null
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
 * @description 下载并安装更新，完成后重启应用；下载失败时抛出且不重启
 * @param update checkForUpdate 返回的待安装更新
 * @param onProgress 进度回调（可选）
 * @returns Promise<void>
 *
 * @example await installUpdate(update, p => console.log(p.percent))
 *
 */
export async function installUpdate (update: Update, onProgress?: (progress: UpdateProgress) => void): Promise<void> {
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
    await relaunch()
}
