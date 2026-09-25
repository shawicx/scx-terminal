//! @description 档案密码凭据：按 profileId 加密存取/清除/存在性查询。

use tauri::State;

use super::crypto::{decrypt_field, encrypt_field};
use super::{now_millis, SecretsState};

/// 认证链内部读取：按档案 id 解密已存密码；未设置返回 None
pub fn load_password(state: &SecretsState, profile_id: &str) -> Result<Option<String>, String> {
    let conn = state.lock_conn();
    let blob = match conn
        .query_row(
            "SELECT password_enc FROM ssh_credentials WHERE profile_id = ?1",
            [profile_id],
            |row| row.get::<_, Vec<u8>>(0),
        )
    {
        Ok(blob) => blob,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(format!("failed to read stored password: {e}")),
    };
    decrypt_field(state.cipher(), &blob).map(Some)
}

/// 设置/覆盖档案密码（加密入库）
///
/// # Arguments
///
/// * `state` - 加密存储状态
/// * `profileId` - 档案 id
/// * `password` - 密码明文（入库前加密）
///
/// # Examples
///
/// `invoke('cred_set_password', { profileId, password })`
pub(super) fn set_password_internal(state: &SecretsState, profile_id: &str, password: &str) -> Result<(), String> {
    let blob = encrypt_field(state.cipher(), password)?;
    let conn = state.lock_conn();
    conn.execute(
        "INSERT INTO ssh_credentials (profile_id, password_enc, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(profile_id) DO UPDATE SET password_enc = excluded.password_enc, updated_at = excluded.updated_at",
        rusqlite::params![profile_id, blob, now_millis()],
    )
    .map_err(|e| format!("failed to save password: {e}"))?;
    Ok(())
}

/// 命令包装：设置档案密码（见 set_password_internal）
#[tauri::command]
pub fn cred_set_password(state: State<'_, SecretsState>, profile_id: String, password: String) -> Result<(), String> {
    set_password_internal(&state, &profile_id, &password)
}

/// 清除档案密码
///
/// # Arguments
///
/// * `state` - 加密存储状态
/// * `profileId` - 档案 id
///
/// # Examples
///
/// `invoke('cred_remove', { profileId })`
pub(super) fn remove_password_internal(state: &SecretsState, profile_id: &str) -> Result<(), String> {
    let conn = state.lock_conn();
    conn.execute("DELETE FROM ssh_credentials WHERE profile_id = ?1", [profile_id])
        .map_err(|e| format!("failed to remove password: {e}"))?;
    Ok(())
}

/// 命令包装：清除档案密码（见 remove_password_internal）
#[tauri::command]
pub fn cred_remove(state: State<'_, SecretsState>, profile_id: String) -> Result<(), String> {
    remove_password_internal(&state, &profile_id)
}

/// 查询档案是否已设置密码（不返回内容）
///
/// # Arguments
///
/// * `state` - 加密存储状态
/// * `profileId` - 档案 id
///
/// # Returns
///
/// 已设置返回 true
///
/// # Examples
///
/// `invoke('cred_has_password', { profileId })`
pub(super) fn has_password_internal(state: &SecretsState, profile_id: &str) -> Result<bool, String> {
    let conn = state.lock_conn();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ssh_credentials WHERE profile_id = ?1",
            [&profile_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("failed to query password state: {e}"))?;
    Ok(count > 0)
}

/// 命令包装：查询档案密码状态（见 has_password_internal）
#[tauri::command]
pub fn cred_has_password(state: State<'_, SecretsState>, profile_id: String) -> Result<bool, String> {
    has_password_internal(&state, &profile_id)
}
