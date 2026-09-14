/**
 * @description SFTP 文件面板前端封装：目录浏览/文件管理命令 + 上传/下载（进度经 Channel 推送）。
 *              会话 id 由 Rust 生成（sftp_open），SSH 会话断开后所有命令自然报错。
 */
import { Channel, invoke } from '@tauri-apps/api/core'

/** 远端目录条目 */
export interface SftpFileEntry {
    name: string
    path: string
    isDir: boolean
    isSymlink: boolean
    size: number | null
    mtimeMs: number | null
}

/** sftp_open 返回：会话 id 与远端主目录 */
export interface SftpOpened {
    id: string
    home: string
}

/** 传输进度/状态（progress | done | error） */
export interface TransferProgress {
    transferId: string
    path: string
    done: number
    total: number
    state: 'progress' | 'done' | 'error'
    error: string | null
}

/**
 * @description 在 SSH 会话上打开 SFTP 会话（同连接第二 channel 跑 sftp subsystem）
 * @param sshId SSH 会话 id
 * @returns Promise<SftpOpened> 会话 id 与远端主目录
 *
 * @example const { id, home } = await openSftp(sshId)
 *
 */
export function openSftp (sshId: string): Promise<SftpOpened> {
    return invoke<SftpOpened>('sftp_open', { sshId })
}

/**
 * @description 列出远端目录（目录在前、名称排序由 Rust 完成）
 * @param id SFTP 会话 id
 * @param path 远端目录绝对路径
 * @returns Promise<SftpFileEntry[]>
 *
 * @example const entries = await readSftpDir(id, '/home')
 *
 */
export function readSftpDir (id: string, path: string): Promise<SftpFileEntry[]> {
    return invoke<SftpFileEntry[]>('sftp_read_dir', { id, path })
}

/**
 * @description 新建远端目录
 * @param id SFTP 会话 id
 * @param path 新目录绝对路径
 * @returns Promise<void>
 *
 * @example await sftpMkdir(id, '/home/user/newdir')
 *
 */
export function sftpMkdir (id: string, path: string): Promise<void> {
    return invoke<void>('sftp_mkdir', { id, path })
}

/**
 * @description 重命名/移动远端条目
 * @param id SFTP 会话 id
 * @param from 原路径
 * @param to 新路径
 * @returns Promise<void>
 *
 * @example await sftpRename(id, '/home/a.txt', '/home/b.txt')
 *
 */
export function sftpRename (id: string, from: string, to: string): Promise<void> {
    return invoke<void>('sftp_rename', { id, from, to })
}

/**
 * @description 删除远端文件
 * @param id SFTP 会话 id
 * @param path 文件绝对路径
 * @returns Promise<void>
 *
 * @example await sftpRemoveFile(id, path)
 *
 */
export function sftpRemoveFile (id: string, path: string): Promise<void> {
    return invoke<void>('sftp_remove_file', { id, path })
}

/**
 * @description 删除远端空目录
 * @param id SFTP 会话 id
 * @param path 目录绝对路径
 * @returns Promise<void>
 *
 * @example await sftpRemoveDir(id, path)
 *
 */
export function sftpRemoveDir (id: string, path: string): Promise<void> {
    return invoke<void>('sftp_remove_dir', { id, path })
}

/**
 * @description 下载远端文件（分块流式；进度经 Channel 推送，完成/失败经 Channel 收尾）
 * @param id SFTP 会话 id
 * @param remotePath 远端文件绝对路径
 * @param localPath 本地目标文件路径
 * @param onProgress 进度回调（progress 与最终 done/error 都会到达）
 * @returns Promise<void> 命令立即返回（传输在后台进行）
 *
 * @example await sftpDownload(id, '/remote/a.log', '/tmp/a.log', p => update(p))
 *
 */
export function sftpDownload (id: string, remotePath: string, localPath: string, onProgress: (progress: TransferProgress) => void): Promise<void> {
    const progress = new Channel<TransferProgress>()
    progress.onmessage = onProgress
    return invoke<void>('sftp_download', { id, remotePath, localPath, progress })
}

/**
 * @description 上传本地文件到远端（分块流式；进度经 Channel 推送）
 * @param id SFTP 会话 id
 * @param localPath 本地源文件路径
 * @param remotePath 远端目标文件路径
 * @param onProgress 进度回调
 * @returns Promise<void> 命令立即返回（传输在后台进行）
 *
 * @example await sftpUpload(id, '/tmp/a.log', '/remote/a.log', p => update(p))
 *
 */
export function sftpUpload (id: string, localPath: string, remotePath: string, onProgress: (progress: TransferProgress) => void): Promise<void> {
    const progress = new Channel<TransferProgress>()
    progress.onmessage = onProgress
    return invoke<void>('sftp_upload', { id, localPath, remotePath, progress })
}

/**
 * @description 关闭 SFTP 会话
 * @param id SFTP 会话 id
 * @returns Promise<void>
 *
 * @example await closeSftp(id)
 *
 */
export function closeSftp (id: string): Promise<void> {
    return invoke<void>('sftp_close', { id })
}
