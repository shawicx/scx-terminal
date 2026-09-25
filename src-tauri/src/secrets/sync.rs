//! @description 云端同步（S3 兼容）配置存取：非敏感字段明文列 + secretKey 加密列；
//!              secret 明文仅在 Rust 侧解密供签名使用，不经前端。

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use super::crypto::{decrypt_field, encrypt_field};
use super::SecretsState;

/// 云端同步（S3 兼容）配置：非敏感字段明文列 + secretKey 加密列；secret 仅存于 Rust 侧
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3SyncConfig {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub path_style: bool,
    pub access_key: String,
    pub secret_key: String,
}

/// 读取云端同步配置（未配置返回 None；secretKey 用主密钥解密，仅供 Rust 侧签名使用）
///
/// # Arguments
///
/// * `state` - 加密存储状态
///
/// # Returns
///
/// 配置或 None
///
/// # Examples
///
/// `if let Some(cfg) = s3_sync_load(&state)? { ... }`
pub fn s3_sync_load(state: &SecretsState) -> Result<Option<S3SyncConfig>, String> {
    let conn = state.lock_conn();
    let row = conn
        .query_row(
            "SELECT endpoint, region, bucket, path_style, access_key, secret_key_enc
             FROM s3_sync WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)? != 0,
                    row.get::<_, String>(4)?,
                    row.get::<_, Vec<u8>>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|e| format!("failed to read s3 sync config: {e}"))?;
    drop(conn);
    match row {
        None => Ok(None),
        Some((endpoint, region, bucket, path_style, access_key, secret_enc)) => Ok(Some(S3SyncConfig {
            endpoint,
            region,
            bucket,
            path_style,
            access_key,
            secret_key: decrypt_field(state.cipher(), &secret_enc)?,
        })),
    }
}

/// 保存/覆盖云端同步配置（secretKey 入库前加密；单行表）
///
/// # Arguments
///
/// * `state` - 加密存储状态
/// * `config` - 完整配置（含 secretKey 明文）
///
/// # Examples
///
/// `s3_sync_store(&state, &config)?;`
pub fn s3_sync_store(state: &SecretsState, config: &S3SyncConfig) -> Result<(), String> {
    let secret_enc = encrypt_field(state.cipher(), &config.secret_key)?;
    let conn = state.lock_conn();
    conn.execute(
        "INSERT INTO s3_sync (id, endpoint, region, bucket, path_style, access_key, secret_key_enc)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            endpoint = excluded.endpoint,
            region = excluded.region,
            bucket = excluded.bucket,
            path_style = excluded.path_style,
            access_key = excluded.access_key,
            secret_key_enc = excluded.secret_key_enc",
        rusqlite::params![
            config.endpoint,
            config.region,
            config.bucket,
            config.path_style as i64,
            config.access_key,
            secret_enc
        ],
    )
    .map_err(|e| format!("failed to save s3 sync config: {e}"))?;
    Ok(())
}

/// 清除云端同步配置
///
/// # Arguments
///
/// * `state` - 加密存储状态
///
/// # Examples
///
/// `s3_sync_forget(&state)?;`
pub fn s3_sync_forget(state: &SecretsState) -> Result<(), String> {
    let conn = state.lock_conn();
    conn.execute("DELETE FROM s3_sync WHERE id = 1", [])
        .map_err(|e| format!("failed to clear s3 sync config: {e}"))?;
    Ok(())
}
