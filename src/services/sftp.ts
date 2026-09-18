/**
 * @description SFTP 服务封装：目录浏览/文件管理命令 + 上传/下载（任务注册进 Rust
 *              TransferManager，进度经全局 `sftp-transfers-changed` 事件广播、支持取消
 *              与目录递归）。会话 id 由 Rust 生成（sftp_open），SSH 会话断开后所有命令
 *              自然报错。
 */
import { invoke } from '@tauri-apps/api/core'

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

/** 传输任务快照（sftp-transfers-changed 事件 / sftp_transfers 查询负载） */
export interface TransferSnapshot {
    id: string
    kind: 'upload' | 'download'
    sshId: string
    fileName: string
    localPath: string
    remotePath: string
    totalBytes: number
    transferredBytes: number
    status: 'queued' | 'running' | 'done' | 'error' | 'canceled'
    error: string | null
    startedAt: number
    finishedAt: number | null
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
 * @description 列出远端目录（目录在前、名称排序由 Rust 完成；symlink 指向目录已修正）
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
 * @description 下载远端文件/目录到本地（TransferManager 后台任务；进度经全局事件广播，
 *              可经传输中心取消；目录自动递归）
 * @param id SFTP 会话 id
 * @param remotePath 远端源路径（文件或目录）
 * @param localPath 本地目标路径（与源同形）
 * @returns Promise<string> 传输任务 id
 *
 * @example await sftpDownload(id, '/remote/logs', '/Users/scx/Downloads/logs')
 *
 */
export function sftpDownload (id: string, remotePath: string, localPath: string): Promise<string> {
    return invoke<string>('sftp_download', { id, remotePath, localPath })
}

/**
 * @description 上传本地文件/目录到远端（语义同 sftpDownload，方向相反）
 * @param id SFTP 会话 id
 * @param localPath 本地源路径（文件或目录）
 * @param remotePath 远端目标路径（与源同形）
 * @returns Promise<string> 传输任务 id
 *
 * @example await sftpUpload(id, '/Users/scx/app.tar.gz', '/srv/app.tar.gz')
 *
 */
export function sftpUpload (id: string, localPath: string, remotePath: string): Promise<string> {
    return invoke<string>('sftp_upload', { id, localPath, remotePath })
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

/**
 * @description 查询传输任务（传输中心全量拉取；可按连接过滤）
 * @param sshId 可选 SSH 连接 id 过滤（null = 全部）
 * @returns Promise<TransferSnapshot[]>
 *
 * @example const list = await listTransfers(null)
 *
 */
export function listTransfers (sshId: string | null): Promise<TransferSnapshot[]> {
    return invoke<TransferSnapshot[]>('sftp_transfers', { sshId })
}

/**
 * @description 请求取消一条传输任务
 * @param id 传输任务 id
 * @returns Promise<void> 任务不存在/已终态时抛错
 *
 * @example await cancelTransfer(id)
 *
 */
export function cancelTransfer (id: string): Promise<void> {
    return invoke<void>('sftp_transfer_cancel', { id })
}

/**
 * @description 清除终态传输任务（不影响进行中任务）
 * @param sshId 可选 SSH 连接 id 过滤（null = 全部）
 * @returns Promise<void>
 *
 * @example await clearTransfers(null)
 *
 */
export function clearTransfers (sshId: string | null): Promise<void> {
    return invoke<void>('sftp_transfers_clear', { sshId })
}
