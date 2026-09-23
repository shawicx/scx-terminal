/**
 * @description 配置备份 IPC 封装：本地快照导出/导入（Rust snapshot.rs 命令薄包装）。
 *              备份文件含口令加密的 SSH 凭据密文段；导入为全量替换语义。
 */
import { invoke } from '@tauri-apps/api/core'

/** config_export 返回：导出规模摘要（成功提示展示用） */
export interface BackupExportSummary {
    profileCount: number
    quickCommandCount: number
    sshKeyCount: number
}

/**
 * @description 导出配置备份到指定路径（含口令加密的 SSH 凭据）
 * @param path 目标文件绝对路径（保存对话框选定）
 * @param passphrase 用户口令（AES-256-GCM 包裹密钥的派生源）
 * @returns Promise<BackupExportSummary> 导出摘要
 *
 * @example const summary = await exportConfigBackup(path, passphrase)
 *
 */
export function exportConfigBackup (path: string, passphrase: string): Promise<BackupExportSummary> {
    return invoke<BackupExportSummary>('config_export', { path, passphrase })
}

/**
 * @description 从备份文件导入（全量替换本机配置与凭据；预校验失败时零改动）
 * @param path 备份文件绝对路径
 * @param passphrase 导出时设定的口令
 * @returns Promise<void>
 *
 * @example await importConfigBackup(path, passphrase)
 *
 */
export function importConfigBackup (path: string, passphrase: string): Promise<void> {
    return invoke('config_import', { path, passphrase })
}
