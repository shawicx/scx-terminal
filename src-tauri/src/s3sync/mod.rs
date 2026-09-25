//! @description 配置云端同步（S3 兼容，MinIO 先行）：reqwest + 手签 AWS SigV4。
//! 快照复用 snapshot.rs（build_snapshot / parse_and_apply），凭据存 secrets.db
//! s3_sync 表（secretKey 加密列）。对象布局 backups/{deviceId}.json，每设备一对象；
//! 手动 push/pull，无自动同步；path-style 寻址默认（AWS virtual-host 留 pathStyle 开关）。
//!
//! 模块拆分：signing（SigV4 纯函数）/ client（请求执行与 S3 对象操作）；
//! 编排与 Tauri 命令留在本模块（命令定义处即宏展开处，lib.rs 路径不变）。

mod client;
mod signing;

#[cfg(test)]
mod tests;

use chrono::Utc;
use serde::Serialize;
use tauri::State;

use crate::config::{meta_get, meta_set, ConfigState};
use crate::secrets::{s3_sync_forget, s3_sync_load, s3_sync_store, S3SyncConfig, SecretsState};
use crate::snapshot::{build_snapshot, parse_and_apply};
use crate::s3sync::client::{s3_get, s3_list, s3_put};

/// 对象键前缀（每设备一对象：backups/{deviceId}.json）
pub(crate) const KEY_PREFIX: &str = "backups/";
/// 云端同步配置未设置的统一错误
pub(crate) const NOT_CONFIGURED: &str = "s3 sync is not configured";

/// 云端同步配置的前端视图（secretKey 永不回传）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct S3SyncConfigView {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub path_style: bool,
    pub access_key: String,
    pub has_secret_key: bool,
}

/// 云端设备快照条目（LIST 解析结果）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSnapshot {
    pub key: String,
    pub device_id: String,
    pub last_modified: String,
    pub size: i64,
}

/// push 结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub key: String,
    pub size: u64,
}

// ---- 编排 ----

/// 取/建本机 deviceId（config.db meta 持久；首次生成 uuid v4；导入备份不覆盖）
pub(crate) fn device_id_or_create(config: &ConfigState) -> Result<String, String> {
    let conn = config.lock_conn();
    if let Some(existing) = meta_get(&conn, "deviceId").map_err(|e| e.to_string())? {
        return Ok(existing);
    }
    let id = uuid::Uuid::new_v4().to_string();
    meta_set(&conn, "deviceId", &id).map_err(|e| e.to_string())?;
    Ok(id)
}

/// 记录同步时间戳（push/pull 成功后调用）
fn stamp_meta(config: &ConfigState, key: &str) -> Result<(), String> {
    let conn = config.lock_conn();
    let now = Utc::now().timestamp_millis().to_string();
    meta_set(&conn, key, &now).map_err(|e| e.to_string())?;
    Ok(())
}

/// push：build_snapshot → PUT backups/{deviceId}.json → meta 记 lastPushAt
pub(crate) fn push_internal(
    config: &ConfigState,
    secrets: &SecretsState,
    passphrase: &str,
    app_version: &str,
) -> Result<PushResult, String> {
    let sync = s3_sync_load(secrets)?.ok_or(NOT_CONFIGURED.to_string())?;
    let (snapshot, _summary) = build_snapshot(config, secrets, passphrase, app_version)?;
    let body = serde_json::to_vec(&snapshot).map_err(|e| format!("failed to serialize backup: {e}"))?;
    let size = body.len() as u64;
    let key = format!("{KEY_PREFIX}{}.json", device_id_or_create(config)?);
    s3_put(&sync, &key, body)?;
    stamp_meta(config, "lastPushAt")?;
    Ok(PushResult { key, size })
}

/// pull：GET 指定对象 → parse_and_apply（校验失败本机零改动）→ meta 记 lastPullAt
pub(crate) fn pull_internal(
    config: &ConfigState,
    secrets: &SecretsState,
    key: &str,
    passphrase: &str,
) -> Result<(), String> {
    let sync = s3_sync_load(secrets)?.ok_or(NOT_CONFIGURED.to_string())?;
    let bytes = s3_get(&sync, key)?;
    let raw = String::from_utf8(bytes).map_err(|_| "invalid backup file: not UTF-8".to_string())?;
    parse_and_apply(config, secrets, &raw, passphrase)?;
    stamp_meta(config, "lastPullAt")
}

/// 测试连接：LIST prefix（403=凭据无效 / 404=桶不存在 / 连接失败=端点不可达）
///
/// `options` 提供时用表单值测试（secretKey 留空 = 沿用已存密钥），否则用已保存配置
pub(crate) fn test_connection(secrets: &SecretsState, options: Option<&S3SyncConfig>) -> Result<(), String> {
    let config = match options {
        Some(options) => {
            let mut options = options.clone();
            if options.secret_key.is_empty() {
                options.secret_key =
                    s3_sync_load(secrets)?.ok_or(NOT_CONFIGURED.to_string())?.secret_key;
            }
            options
        }
        None => s3_sync_load(secrets)?.ok_or(NOT_CONFIGURED.to_string())?,
    };
    s3_list(&config, KEY_PREFIX)?;
    Ok(())
}

// ---- Tauri 命令（薄包装）----

/// 读取云端同步配置（secretKey 不回传）
///
/// # Examples
///
/// `invoke('s3_sync_get')`
#[tauri::command]
pub fn s3_sync_get(state: State<'_, SecretsState>) -> Result<Option<S3SyncConfigView>, String> {
    Ok(s3_sync_load(&state)?.map(|config| S3SyncConfigView {
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        path_style: config.path_style,
        access_key: config.access_key,
        has_secret_key: !config.secret_key.is_empty(),
    }))
}

/// 保存/覆盖云端同步配置
///
/// # Examples
///
/// `invoke('s3_sync_set', { options })`
#[tauri::command]
pub fn s3_sync_set(state: State<'_, SecretsState>, options: S3SyncConfig) -> Result<(), String> {
    s3_sync_store(&state, &options)
}

/// 清除云端同步配置
///
/// # Examples
///
/// `invoke('s3_sync_clear')`
#[tauri::command]
pub fn s3_sync_clear(state: State<'_, SecretsState>) -> Result<(), String> {
    s3_sync_forget(&state)
}

/// 测试连接（见 test_connection）；options 传当前表单值（secretKey 留空沿用已存）
///
/// # Examples
///
/// `invoke('s3_sync_test', { options })`
#[tauri::command]
pub fn s3_sync_test(state: State<'_, SecretsState>, options: Option<S3SyncConfig>) -> Result<(), String> {
    test_connection(&state, options.as_ref())
}

/// 上传本机快照到云端
///
/// # Examples
///
/// `invoke('s3_sync_push', { passphrase })`
#[tauri::command]
pub fn s3_sync_push(
    app: tauri::AppHandle,
    config: State<'_, ConfigState>,
    secrets: State<'_, SecretsState>,
    passphrase: String,
) -> Result<PushResult, String> {
    push_internal(&config, &secrets, &passphrase, &app.package_info().version.to_string())
}

/// 云端同步状态（设置页展示：本机设备标识 + 最后上传/恢复时间）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub device_id: String,
    pub last_push_at: Option<i64>,
    pub last_pull_at: Option<i64>,
}

/// 读取同步状态（deviceId 不存在则顺手创建，与 push 行为一致）
///
/// # Arguments
///
/// * `config` - 配置库状态
///
/// # Returns
///
/// 设备标识与最近同步时间戳（毫秒，未同步为 None）
///
/// # Examples
///
/// `invoke('s3_sync_status')`
#[tauri::command]
pub fn s3_sync_status(config: State<'_, ConfigState>) -> Result<SyncStatus, String> {
    let device_id = device_id_or_create(&config)?;
    let conn = config.lock_conn();
    let read_stamp = |key: &str| -> Result<Option<i64>, String> {
        Ok(meta_get(&conn, key).map_err(|e| e.to_string())?.and_then(|value| value.parse().ok()))
    };
    Ok(SyncStatus {
        device_id,
        last_push_at: read_stamp("lastPushAt")?,
        last_pull_at: read_stamp("lastPullAt")?,
    })
}

/// 列出云端全部设备快照
///
/// # Examples
///
/// `invoke('s3_sync_list_remote')`
#[tauri::command]
pub fn s3_sync_list_remote(secrets: State<'_, SecretsState>) -> Result<Vec<RemoteSnapshot>, String> {
    let config = s3_sync_load(&secrets)?.ok_or("s3 sync is not configured")?;
    s3_list(&config, "backups/")
}

/// 从云端拉取指定快照并应用（见 pull_internal）
///
/// # Examples
///
/// `invoke('s3_sync_pull', { key, passphrase })`
#[tauri::command]
pub fn s3_sync_pull(
    config: State<'_, ConfigState>,
    secrets: State<'_, SecretsState>,
    key: String,
    passphrase: String,
) -> Result<(), String> {
    pull_internal(&config, &secrets, &key, &passphrase)
}
