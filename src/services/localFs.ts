/**
 * @description 本地文件栏服务：fs_browse_dir / fs_home_dir 的 IPC 封装。
 *              大小/修改时间跟随 symlink；隐藏文件过滤由前端栏级开关控制
 *              （列目录恒取全量，客户端过滤，与远端栏行为一致）。
 */
import { invoke } from '@tauri-apps/api/core'

/** 本地目录条目（fs_browse_dir 返回形状） */
export interface LocalFsEntry {
    name: string
    path: string
    isDir: boolean
    isSymlink: boolean
    size: number
    mtimeMs: number
}

/**
 * @description 列出本地目录（含大小/修改时间；错误显式抛出供 UI 呈现 banner）
 * @param path 本地目录绝对路径（支持 ~ 展开）
 * @param showHidden 是否包含隐藏文件（恒取全量由调用方控制）
 * @returns Promise<LocalFsEntry[]> 目录在前、名称不区分大小写升序
 *
 * @example const entries = await browseLocalDir('/Users/scx', true)
 *
 */
export function browseLocalDir (path: string, showHidden = true): Promise<LocalFsEntry[]> {
    return invoke<LocalFsEntry[]>('fs_browse_dir', { path, showHidden })
}

/**
 * @description 本地用户主目录（SFTP 本地栏初始路径）
 * @returns Promise<string> 主目录绝对路径
 *
 * @example const home = await localHomeDir()
 *
 */
export function localHomeDir (): Promise<string> {
    return invoke<string>('fs_home_dir')
}
