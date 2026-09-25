//! @description 分组域写入：本地档案分组 / SSH 分组 / 标签分组 CRUD。
//! local/ssh 档案的 groupId 存于 profiles 的 data JSON 内，删组需逐行改写 JSON 降级
//! （ungroup_profiles 共用）；标签分组成员归属由前端运行时清理。

use serde_json::Value;
use tauri::State;

use super::model::{LocalGroupRecord, SshGroupRecord, TabGroupRecord};
use super::state::{mark_initialized, next_sort_order};
use super::ConfigState;

/// 把指定类型档案 data JSON 里的 groupId 键移除（删组降级）；其余字段原样保留
fn ungroup_profiles(tx: &rusqlite::Transaction, profile_type: &str, group_id: &str) -> Result<(), String> {
    let members: Vec<(String, String)> = {
        let mut stmt = tx
            .prepare("SELECT id, data FROM profiles WHERE type = ?1")
            .map_err(|e| format!("failed to read {profile_type} profiles: {e}"))?;
        let rows = stmt
            .query_map([profile_type], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| format!("failed to read {profile_type} profiles: {e}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?
    };
    for (profile_id, raw) in members {
        let Ok(mut data) = serde_json::from_str::<serde_json::Map<String, Value>>(&raw) else {
            continue;
        };
        if data.get("groupId").and_then(Value::as_str) == Some(group_id) {
            data.remove("groupId");
            tx.execute(
                "UPDATE profiles SET data = ?1 WHERE id = ?2",
                rusqlite::params![Value::Object(data).to_string(), profile_id],
            )
            .map_err(|e| format!("failed to ungroup {profile_type} profile {profile_id}: {e}"))?;
        }
    }
    Ok(())
}

// ---- 本地档案分组 ----

/// 新增本地档案分组
pub(super) fn local_group_create_internal(state: &ConfigState, group: &LocalGroupRecord) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let sort_order = next_sort_order(&tx, "local_groups").map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO local_groups (id, name, is_default, sort_order) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![group.id, group.name, group.is_default as i64, sort_order],
    )
    .map_err(|e| format!("failed to create local group {}: {e}", group.id))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit local group create: {e}"))
}

/// 更新本地档案分组（按 id）
pub(super) fn local_group_update_internal(state: &ConfigState, group: &LocalGroupRecord) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let changed = tx
        .execute(
            "UPDATE local_groups SET name = ?1, is_default = ?2 WHERE id = ?3",
            rusqlite::params![group.name, group.is_default as i64, group.id],
        )
        .map_err(|e| format!("failed to update local group {}: {e}", group.id))?;
    if changed == 0 {
        return Err(format!("local group not found: {}", group.id));
    }
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit local group update: {e}"))
}

/// 删除本地档案分组：单事务内删组并把组内本地档案降级未分组（对齐 SSH 分组「删组降级」语义）
pub(super) fn local_group_delete_internal(state: &ConfigState, id: &str) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM local_groups WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete local group {id}: {e}"))?;
    ungroup_profiles(&tx, "local", id)?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit local group delete: {e}"))
}

// ---- SSH 分组 ----

/// 新增 SSH 分组
pub(super) fn ssh_group_create_internal(state: &ConfigState, group: &SshGroupRecord) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let sort_order = next_sort_order(&tx, "ssh_groups").map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO ssh_groups (id, name, sort_order) VALUES (?1, ?2, ?3)",
        rusqlite::params![group.id, group.name, sort_order],
    )
    .map_err(|e| format!("failed to create ssh group {}: {e}", group.id))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit ssh group create: {e}"))
}

/// 更新 SSH 分组（按 id）
pub(super) fn ssh_group_update_internal(state: &ConfigState, group: &SshGroupRecord) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let changed = tx
        .execute(
            "UPDATE ssh_groups SET name = ?1 WHERE id = ?2",
            rusqlite::params![group.name, group.id],
        )
        .map_err(|e| format!("failed to update ssh group {}: {e}", group.id))?;
    if changed == 0 {
        return Err(format!("ssh group not found: {}", group.id));
    }
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit ssh group update: {e}"))
}

/// 删除 SSH 分组：单事务内删组并把组内 SSH 档案降级默认分组（对齐快捷命令「删组降级」语义）
pub(super) fn ssh_group_delete_internal(state: &ConfigState, id: &str) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM ssh_groups WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete ssh group {id}: {e}"))?;
    ungroup_profiles(&tx, "ssh", id)?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit ssh group delete: {e}"))
}

// ---- 标签分组 ----

/// 新增标签分组
pub(super) fn tab_group_create_internal(state: &ConfigState, group: &TabGroupRecord) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let sort_order = next_sort_order(&tx, "tab_groups").map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO tab_groups (id, name, color, sort_order, persist_tabs, collapsed) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![group.id, group.name, group.color, sort_order, group.persist_tabs as i64, group.collapsed as i64],
    )
    .map_err(|e| format!("failed to create tab group {}: {e}", group.id))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit tab group create: {e}"))
}

/// 更新标签分组（按 id）
pub(super) fn tab_group_update_internal(state: &ConfigState, group: &TabGroupRecord) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let changed = tx
        .execute(
            "UPDATE tab_groups SET name = ?1, color = ?2, persist_tabs = ?3, collapsed = ?4 WHERE id = ?5",
            rusqlite::params![group.name, group.color, group.persist_tabs as i64, group.collapsed as i64, group.id],
        )
        .map_err(|e| format!("failed to update tab group {}: {e}", group.id))?;
    if changed == 0 {
        return Err(format!("tab group not found: {}", group.id));
    }
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit tab group update: {e}"))
}

/// 删除标签分组（幂等；成员归属由前端运行时清理）
pub(super) fn tab_group_delete_internal(state: &ConfigState, id: &str) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM tab_groups WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete tab group {id}: {e}"))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit tab group delete: {e}"))
}

// ---- Tauri 命令 ----

///
/// @description 新增本地档案分组
/// @param state 配置库状态
/// @param group 分组记录
/// @returns Result<(), String>
///
#[tauri::command]
pub fn local_group_create(state: State<'_, ConfigState>, group: LocalGroupRecord) -> Result<(), String> {
    local_group_create_internal(&state, &group)
}

///
/// @description 更新本地档案分组
/// @param state 配置库状态
/// @param group 分组记录（按 id 匹配）
/// @returns Result<(), String>
///
#[tauri::command]
pub fn local_group_update(state: State<'_, ConfigState>, group: LocalGroupRecord) -> Result<(), String> {
    local_group_update_internal(&state, &group)
}

///
/// @description 删除本地档案分组（组内本地档案降级未分组）
/// @param state 配置库状态
/// @param id 分组 id
/// @returns Result<(), String>
///
#[tauri::command]
pub fn local_group_delete(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    local_group_delete_internal(&state, &id)
}

///
/// @description 新增 SSH 分组
/// @param state 配置库状态
/// @param group 分组记录
/// @returns Result<(), String>
///
#[tauri::command]
pub fn ssh_group_create(state: State<'_, ConfigState>, group: SshGroupRecord) -> Result<(), String> {
    ssh_group_create_internal(&state, &group)
}

///
/// @description 更新 SSH 分组
/// @param state 配置库状态
/// @param group 分组记录（按 id 匹配）
/// @returns Result<(), String>
///
#[tauri::command]
pub fn ssh_group_update(state: State<'_, ConfigState>, group: SshGroupRecord) -> Result<(), String> {
    ssh_group_update_internal(&state, &group)
}

///
/// @description 删除 SSH 分组（组内 SSH 档案降级默认分组）
/// @param state 配置库状态
/// @param id 分组 id
/// @returns Result<(), String>
///
#[tauri::command]
pub fn ssh_group_delete(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    ssh_group_delete_internal(&state, &id)
}

///
/// @description 新增标签分组
/// @param state 配置库状态
/// @param group 分组记录
/// @returns Result<(), String>
///
#[tauri::command]
pub fn tab_group_create(state: State<'_, ConfigState>, group: TabGroupRecord) -> Result<(), String> {
    tab_group_create_internal(&state, &group)
}

///
/// @description 更新标签分组
/// @param state 配置库状态
/// @param group 分组记录（按 id 匹配）
/// @returns Result<(), String>
///
#[tauri::command]
pub fn tab_group_update(state: State<'_, ConfigState>, group: TabGroupRecord) -> Result<(), String> {
    tab_group_update_internal(&state, &group)
}

///
/// @description 删除标签分组
/// @param state 配置库状态
/// @param id 分组 id
/// @returns Result<(), String>
///
#[tauri::command]
pub fn tab_group_delete(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    tab_group_delete_internal(&state, &id)
}
