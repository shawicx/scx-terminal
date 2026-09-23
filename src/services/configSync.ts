/**
 * @description 配置云端同步（S3 兼容/MinIO）IPC 封装：Rust s3sync.rs 命令薄包装。
 *              secretKey 仅在保存时上行，读取接口永不回传。
 */
import { invoke } from '@tauri-apps/api/core'

/** 云端同步配置（保存入参；secretKey 仅此处出现） */
export interface S3SyncConfig {
    endpoint: string
    region: string
    bucket: string
    pathStyle: boolean
    accessKey: string
    secretKey: string
}

/** 云端同步配置读取视图（无 secretKey） */
export interface S3SyncConfigView {
    endpoint: string
    region: string
    bucket: string
    pathStyle: boolean
    accessKey: string
    hasSecretKey: boolean
}

/** 云端设备快照条目 */
export interface RemoteSnapshot {
    key: string
    deviceId: string
    lastModified: string
    size: number
}

/** push 结果 */
export interface CloudPushResult {
    key: string
    size: number
}

/** 同步状态（设置页展示） */
export interface SyncStatus {
    deviceId: string
    lastPushAt: number | null
    lastPullAt: number | null
}

/**
 * @description 读取云端同步配置（未配置返回 null；不含 secretKey）
 * @returns Promise<S3SyncConfigView | null>
 *
 * @example const view = await getS3SyncConfig()
 *
 */
export function getS3SyncConfig (): Promise<S3SyncConfigView | null> {
    return invoke<S3SyncConfigView | null>('s3_sync_get')
}

/**
 * @description 保存/覆盖云端同步配置
 * @param options 完整配置（含 secretKey）
 * @returns Promise<void>
 *
 * @example await setS3SyncConfig(options)
 *
 */
export function setS3SyncConfig (options: S3SyncConfig): Promise<void> {
    return invoke('s3_sync_set', { options })
}

/**
 * @description 清除云端同步配置
 * @returns Promise<void>
 *
 * @example await clearS3SyncConfig()
 *
 */
export function clearS3SyncConfig (): Promise<void> {
    return invoke('s3_sync_clear')
}

/**
 * @description 测试连接（端点可达 + 凭据有效 + 桶存在）
 * @param options 可选：用当前表单值测试（secretKey 留空 = 沿用已存密钥）；缺省用已保存配置
 * @returns Promise<void> 失败时抛分类错误
 *
 * @example await testS3SyncConnection(options)
 *
 */
export function testS3SyncConnection (options?: S3SyncConfig): Promise<void> {
    return invoke('s3_sync_test', { options: options ?? null })
}

/**
 * @description 读取同步状态（deviceId + 最后上传/恢复时间）
 * @returns Promise<SyncStatus>
 *
 * @example const status = await getS3SyncStatus()
 *
 */
export function getS3SyncStatus (): Promise<SyncStatus> {
    return invoke<SyncStatus>('s3_sync_status')
}

/**
 * @description 上传本机快照到云端（backups/{deviceId}.json）
 * @param passphrase 备份口令（与本地导出一致）
 * @returns Promise<CloudPushResult> 对象键与大小
 *
 * @example const result = await pushBackupToCloud(passphrase)
 *
 */
export function pushBackupToCloud (passphrase: string): Promise<CloudPushResult> {
    return invoke<CloudPushResult>('s3_sync_push', { passphrase })
}

/**
 * @description 列出云端全部设备快照
 * @returns Promise<RemoteSnapshot[]>
 *
 * @example const items = await listRemoteSnapshots()
 *
 */
export function listRemoteSnapshots (): Promise<RemoteSnapshot[]> {
    return invoke<RemoteSnapshot[]>('s3_sync_list_remote')
}

/**
 * @description 从云端拉取指定快照并全量应用（校验失败本机零改动）
 * @param key 对象键（来自列表条目）
 * @param passphrase 导出时设定的口令
 * @returns Promise<void>
 *
 * @example await pullRemoteSnapshot(key, passphrase)
 *
 */
export function pullRemoteSnapshot (key: string, passphrase: string): Promise<void> {
    return invoke('s3_sync_pull', { key, passphrase })
}
