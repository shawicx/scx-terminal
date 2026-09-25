//! @description profiles 域写入：终端配置档案 CRUD（身份/排序列 + data JSON 混合存储，
//! 形状随前端演进）；命令薄包装，逻辑在 *_internal 供单测复用。

use serde_json::Value;
use tauri::State;

use super::state::{json_bool, json_str, mark_initialized, next_sort_order};
use super::ConfigState;

/// 新增配置档案（id 必填；排序列取当前最大值 + 1）
pub(super) fn profile_create_internal(state: &ConfigState, profile: &Value) -> Result<(), String> {
    let id = profile
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "profile is missing a non-empty id".to_string())?
        .to_string();
    let profile_type = json_str(profile, "type");
    let name = json_str(profile, "name");
    let is_default = json_bool(profile, "isDefault");
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let sort_order = next_sort_order(&tx, "profiles").map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO profiles (id, type, name, is_default, sort_order, data)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, profile_type, name, is_default, sort_order, profile.to_string()],
    )
    .map_err(|e| format!("failed to create profile {id}: {e}"))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit profile create: {e}"))
}

/// 更新配置档案（按 id；data 为权威数据，排序列不变）
pub(super) fn profile_update_internal(state: &ConfigState, profile: &Value) -> Result<(), String> {
    let id = profile
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "profile is missing a non-empty id".to_string())?
        .to_string();
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let changed = tx
        .execute(
            "UPDATE profiles SET type = ?1, name = ?2, is_default = ?3, data = ?4 WHERE id = ?5",
            rusqlite::params![
                json_str(profile, "type"),
                json_str(profile, "name"),
                json_bool(profile, "isDefault"),
                profile.to_string(),
                id
            ],
        )
        .map_err(|e| format!("failed to update profile {id}: {e}"))?;
    if changed == 0 {
        return Err(format!("profile not found: {id}"));
    }
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit profile update: {e}"))
}

/// 删除配置档案（幂等：目标不存在也视为成功，配合前端 diff flush 重试）
pub(super) fn profile_delete_internal(state: &ConfigState, id: &str) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM profiles WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete profile {id}: {e}"))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit profile delete: {e}"))
}

///
/// @description 新增配置档案
/// @param state 配置库状态
/// @param profile 档案 JSON（须含非空 id）
/// @returns Result<(), String>
///
#[tauri::command]
pub fn profile_create(state: State<'_, ConfigState>, profile: Value) -> Result<(), String> {
    profile_create_internal(&state, &profile)
}

///
/// @description 更新配置档案
/// @param state 配置库状态
/// @param profile 档案 JSON（按 id 匹配）
/// @returns Result<(), String>
///
#[tauri::command]
pub fn profile_update(state: State<'_, ConfigState>, profile: Value) -> Result<(), String> {
    profile_update_internal(&state, &profile)
}

///
/// @description 删除配置档案（幂等）
/// @param state 配置库状态
/// @param id 档案 id
/// @returns Result<(), String>
///
#[tauri::command]
pub fn profile_delete(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    profile_delete_internal(&state, &id)
}
