//! @description settings 域写入：settings 分片（terminal/appearance/...）、热键绑定、
//! 标签恢复快照（tabSession）与自定义配色；各命令薄包装，逻辑在 *_internal 供单测复用。

use rusqlite::OptionalExtension;
use serde_json::Value;
use tauri::State;

use super::state::{mark_initialized, next_sort_order};
use super::ConfigState;

/// upsert 设置分片（key 白名单校验）
pub(super) fn settings_set_section_internal(state: &ConfigState, key: &str, value: &Value) -> Result<(), String> {
    if !super::SETTINGS_KEYS.contains(&key) {
        return Err(format!("unknown settings section: {key}"));
    }
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value.to_string()],
    )
    .map_err(|e| format!("failed to save settings/{key}: {e}"))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit settings/{key}: {e}"))
}

/// upsert 单个热键绑定
pub(super) fn hotkey_set_internal(state: &ConfigState, action: &str, bindings: &Value) -> Result<(), String> {
    if action.is_empty() {
        return Err("hotkey action must not be empty".to_string());
    }
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO hotkeys (action, bindings) VALUES (?1, ?2)
         ON CONFLICT(action) DO UPDATE SET bindings = excluded.bindings",
        rusqlite::params![action, bindings.to_string()],
    )
    .map_err(|e| format!("failed to save hotkey/{action}: {e}"))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit hotkey/{action}: {e}"))
}

/// 读取标签恢复快照（settings 表 tabSession 键）
pub(super) fn tab_session_get_internal(state: &ConfigState) -> Result<Option<Value>, String> {
    let conn = state.lock_conn();
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'tabSession'", [], |row| row.get(0))
        .optional()
        .map_err(|e| format!("failed to read tab session: {e}"))?;
    match raw {
        Some(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| format!("tabSession is corrupted: {e}")),
        None => Ok(None),
    }
}

/// 写标签恢复快照。不置 initialized 位：全新库写快照不得抑制 legacy config.yaml 迁移
pub(super) fn tab_session_set_internal(state: &ConfigState, value: &Value) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('tabSession', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [value.to_string()],
    )
    .map_err(|e| format!("failed to save tab session: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit tab session: {e}"))
}

/// upsert 自定义配色（按 name；重命名由前端按「删旧建新」处理，净效果等价）
pub(super) fn color_scheme_save_internal(state: &ConfigState, name: &str, data: &Value) -> Result<(), String> {
    if name.is_empty() {
        return Err("color scheme name must not be empty".to_string());
    }
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO color_schemes (name, sort_order, data) VALUES (?1, ?2, ?3)
         ON CONFLICT(name) DO UPDATE SET data = excluded.data",
        rusqlite::params![name, next_sort_order(&tx, "color_schemes").map_err(|e| e.to_string())?, data.to_string()],
    )
    .map_err(|e| format!("failed to save color scheme {name}: {e}"))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit color scheme save: {e}"))
}

/// 删除自定义配色（幂等）
pub(super) fn color_scheme_delete_internal(state: &ConfigState, name: &str) -> Result<(), String> {
    let mut conn = state.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM color_schemes WHERE name = ?1", [name])
        .map_err(|e| format!("failed to delete color scheme {name}: {e}"))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit color scheme delete: {e}"))
}

///
/// @description upsert 设置分片（terminal / appearance）
/// @param state 配置库状态
/// @param key 分片键
/// @param value 分片 JSON 值
/// @returns Result<(), String>
///
#[tauri::command]
pub fn settings_set_section(
    state: State<'_, ConfigState>,
    key: String,
    value: Value,
) -> Result<(), String> {
    settings_set_section_internal(&state, &key, &value)
}

///
/// @description upsert 单个热键绑定
/// @param state 配置库状态
/// @param action 动作 id
/// @param bindings 绑定序列 JSON
/// @returns Result<(), String>
///
#[tauri::command]
pub fn hotkey_set(state: State<'_, ConfigState>, action: String, bindings: Value) -> Result<(), String> {
    hotkey_set_internal(&state, &action, &bindings)
}

///
/// @description 读取标签恢复快照
/// @param state 配置库状态
/// @returns Result<Option<Value>, String>
///
#[tauri::command]
pub fn tab_session_get(state: State<'_, ConfigState>) -> Result<Option<Value>, String> {
    tab_session_get_internal(&state)
}

///
/// @description 写标签恢复快照
/// @param state 配置库状态
/// @param value 快照 JSON
/// @returns Result<(), String>
///
#[tauri::command]
pub fn tab_session_set(state: State<'_, ConfigState>, value: Value) -> Result<(), String> {
    tab_session_set_internal(&state, &value)
}

///
/// @description upsert 自定义配色
/// @param state 配置库状态
/// @param name 配色名（唯一键）
/// @param data 配色 JSON
/// @returns Result<(), String>
///
#[tauri::command]
pub fn color_scheme_save(state: State<'_, ConfigState>, name: String, data: Value) -> Result<(), String> {
    color_scheme_save_internal(&state, &name, &data)
}

///
/// @description 删除自定义配色
/// @param state 配置库状态
/// @param name 配色名
/// @returns Result<(), String>
///
#[tauri::command]
pub fn color_scheme_delete(state: State<'_, ConfigState>, name: String) -> Result<(), String> {
    color_scheme_delete_internal(&state, &name)
}
