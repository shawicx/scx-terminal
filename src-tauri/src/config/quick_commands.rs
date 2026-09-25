//! @description 快捷命令域写入：命令与分组 CRUD（真实列存储）；
//! 删组在单事务内把组内命令降级为未分组。命令薄包装，逻辑在 *_internal 供单测复用。

use tauri::State;

use super::model::{QuickCommandGroupRecord, QuickCommandRecord};
use super::state::{mark_initialized, next_sort_order};
use super::ConfigState;

/// 新增快捷命令（排序列取当前最大值 + 1）
pub(super) fn quick_command_create_internal(state: &ConfigState, command: &QuickCommandRecord) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let sort_order = next_sort_order(&tx, "quick_commands").map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO quick_commands (id, group_id, name, command, auto_run, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            command.id,
            command.group_id,
            command.name,
            command.command,
            command.auto_run,
            sort_order
        ],
    )
    .map_err(|e| format!("failed to create quick command {}: {e}", command.id))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit quick command create: {e}"))
}

/// 更新快捷命令（按 id；排序列不变）
pub(super) fn quick_command_update_internal(state: &ConfigState, command: &QuickCommandRecord) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let changed = tx
        .execute(
            "UPDATE quick_commands SET group_id = ?1, name = ?2, command = ?3, auto_run = ?4 WHERE id = ?5",
            rusqlite::params![
                command.group_id,
                command.name,
                command.command,
                command.auto_run,
                command.id
            ],
        )
        .map_err(|e| format!("failed to update quick command {}: {e}", command.id))?;
    if changed == 0 {
        return Err(format!("quick command not found: {}", command.id));
    }
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit quick command update: {e}"))
}

/// 删除快捷命令（幂等）
pub(super) fn quick_command_delete_internal(state: &ConfigState, id: &str) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM quick_commands WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete quick command {id}: {e}"))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit quick command delete: {e}"))
}

/// 新增快捷命令分组
pub(super) fn quick_command_group_create_internal(state: &ConfigState, group: &QuickCommandGroupRecord) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let sort_order = next_sort_order(&tx, "quick_command_groups").map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO quick_command_groups (id, name, sort_order) VALUES (?1, ?2, ?3)",
        rusqlite::params![group.id, group.name, sort_order],
    )
    .map_err(|e| format!("failed to create quick command group {}: {e}", group.id))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit quick command group create: {e}"))
}

/// 更新快捷命令分组（按 id）
pub(super) fn quick_command_group_update_internal(state: &ConfigState, group: &QuickCommandGroupRecord) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let changed = tx
        .execute(
            "UPDATE quick_command_groups SET name = ?1 WHERE id = ?2",
            rusqlite::params![group.name, group.id],
        )
        .map_err(|e| format!("failed to update quick command group {}: {e}", group.id))?;
    if changed == 0 {
        return Err(format!("quick command group not found: {}", group.id));
    }
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit quick command group update: {e}"))
}

/// 删除分组：单事务内删组并把组内命令降级为未分组（对齐设置页「删组降级」语义）
pub(super) fn quick_command_group_delete_internal(state: &ConfigState, id: &str) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM quick_command_groups WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete quick command group {id}: {e}"))?;
    tx.execute("UPDATE quick_commands SET group_id = NULL WHERE group_id = ?1", [id])
        .map_err(|e| format!("failed to ungroup quick commands of {id}: {e}"))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit quick command group delete: {e}"))
}

///
/// @description 新增快捷命令
/// @param state 配置库状态
/// @param command 快捷命令记录
/// @returns Result<(), String>
///
#[tauri::command]
pub fn quick_command_create(state: State<'_, ConfigState>, command: QuickCommandRecord) -> Result<(), String> {
    quick_command_create_internal(&state, &command)
}

///
/// @description 更新快捷命令
/// @param state 配置库状态
/// @param command 快捷命令记录（按 id 匹配）
/// @returns Result<(), String>
///
#[tauri::command]
pub fn quick_command_update(state: State<'_, ConfigState>, command: QuickCommandRecord) -> Result<(), String> {
    quick_command_update_internal(&state, &command)
}

///
/// @description 删除快捷命令（幂等）
/// @param state 配置库状态
/// @param id 命令 id
/// @returns Result<(), String>
///
#[tauri::command]
pub fn quick_command_delete(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    quick_command_delete_internal(&state, &id)
}

///
/// @description 新增快捷命令分组
/// @param state 配置库状态
/// @param group 分组记录
/// @returns Result<(), String>
///
#[tauri::command]
pub fn quick_command_group_create(
    state: State<'_, ConfigState>,
    group: QuickCommandGroupRecord,
) -> Result<(), String> {
    quick_command_group_create_internal(&state, &group)
}

///
/// @description 更新快捷命令分组
/// @param state 配置库状态
/// @param group 分组记录（按 id 匹配）
/// @returns Result<(), String>
///
#[tauri::command]
pub fn quick_command_group_update(
    state: State<'_, ConfigState>,
    group: QuickCommandGroupRecord,
) -> Result<(), String> {
    quick_command_group_update_internal(&state, &group)
}

///
/// @description 删除快捷命令分组（组内命令降级为未分组）
/// @param state 配置库状态
/// @param id 分组 id
/// @returns Result<(), String>
///
#[tauri::command]
pub fn quick_command_group_delete(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    quick_command_group_delete_internal(&state, &id)
}
