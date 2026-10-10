//! @description 工作流域写入：CRUD（真实列存储，步骤列表整体存 steps JSON 列）。
//! 命令薄包装，逻辑在 *_internal 供单测复用。

use tauri::State;

use super::model::WorkflowRecord;
use super::state::{mark_initialized, next_sort_order};
use super::ConfigState;

/// 新增工作流（排序列取当前最大值 + 1）
pub(super) fn workflow_create_internal(state: &ConfigState, workflow: &WorkflowRecord) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let sort_order = next_sort_order(&tx, "workflows").map_err(|e| e.to_string())?;
    let steps = serde_json::to_string(&workflow.steps)
        .map_err(|e| format!("failed to serialize workflow {} steps: {e}", workflow.id))?;
    tx.execute(
        "INSERT INTO workflows (id, name, description, execution, step_interval_ms, sort_order, steps, stop_on_error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            workflow.id,
            workflow.name,
            workflow.description,
            workflow.execution,
            workflow.step_interval_ms,
            sort_order,
            steps,
            workflow.stop_on_error
        ],
    )
    .map_err(|e| format!("failed to create workflow {}: {e}", workflow.id))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit workflow create: {e}"))
}

/// 更新工作流（按 id；排序列不变）
pub(super) fn workflow_update_internal(state: &ConfigState, workflow: &WorkflowRecord) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let steps = serde_json::to_string(&workflow.steps)
        .map_err(|e| format!("failed to serialize workflow {} steps: {e}", workflow.id))?;
    let changed = tx
        .execute(
            "UPDATE workflows SET name = ?1, description = ?2, execution = ?3, step_interval_ms = ?4, steps = ?5, stop_on_error = ?6 WHERE id = ?7",
            rusqlite::params![
                workflow.name,
                workflow.description,
                workflow.execution,
                workflow.step_interval_ms,
                steps,
                workflow.stop_on_error,
                workflow.id
            ],
        )
        .map_err(|e| format!("failed to update workflow {}: {e}", workflow.id))?;
    if changed == 0 {
        return Err(format!("workflow not found: {}", workflow.id));
    }
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit workflow update: {e}"))
}

/// 删除工作流（幂等）
pub(super) fn workflow_delete_internal(state: &ConfigState, id: &str) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM workflows WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete workflow {id}: {e}"))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit workflow delete: {e}"))
}

///
/// @description 新增工作流
/// @param state 配置库状态
/// @param workflow 工作流记录
/// @returns Result<(), String>
///
#[tauri::command]
pub fn workflow_create(state: State<'_, ConfigState>, workflow: WorkflowRecord) -> Result<(), String> {
    workflow_create_internal(&state, &workflow)
}

///
/// @description 更新工作流（按 id）
/// @param state 配置库状态
/// @param workflow 工作流记录（按 id 匹配）
/// @returns Result<(), String>
///
#[tauri::command]
pub fn workflow_update(state: State<'_, ConfigState>, workflow: WorkflowRecord) -> Result<(), String> {
    workflow_update_internal(&state, &workflow)
}

///
/// @description 删除工作流（幂等）
/// @param state 配置库状态
/// @param id 工作流 id
/// @returns Result<(), String>
///
#[tauri::command]
pub fn workflow_delete(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    workflow_delete_internal(&state, &id)
}
