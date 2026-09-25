//! @description 聚合读取：settings 分片 + 热键 + 档案/配色（data JSON）+ 各分组表
//! 重建 ConfigSnapshot；全新库（meta 无 initialized 标记）返回 None。

use rusqlite::OptionalExtension;
use tauri::State;

use super::model::{
    ConfigSnapshot, LocalGroupRecord, QuickCommandGroupRecord, QuickCommandRecord, SshGroupRecord,
    TabGroupRecord,
};
use super::{ConfigState, SETTINGS_KEYS};

/// 聚合读取全量配置；meta 无 initialized 标记（全新库）时返回 None（备份模块导入后校验复用）
pub(crate) fn load_internal(state: &ConfigState) -> Result<Option<ConfigSnapshot>, String> {
    let conn = state.lock_conn();
    let initialized: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = 'initialized'", [], |row| row.get(0))
        .optional()
        .map_err(|e| format!("failed to read config meta: {e}"))?;
    if initialized.is_none() {
        return Ok(None);
    }

    let mut snapshot = ConfigSnapshot::default();
    for key in SETTINGS_KEYS {
        let raw: Option<String> = conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0))
            .optional()
            .map_err(|e| format!("failed to read settings/{key}: {e}"))?;
        if let Some(raw) = raw {
            let value = serde_json::from_str(&raw)
                .map_err(|e| format!("settings/{key} is corrupted: {e}"))?;
            match key {
                "terminal" => snapshot.terminal = Some(value),
                "advanced" => snapshot.advanced = Some(value),
                "recents" => snapshot.recents = Some(value),
                "monitor" => snapshot.monitor = Some(value),
                _ => snapshot.appearance = Some(value),
            }
        }
    }

    let mut stmt = conn
        .prepare("SELECT action, bindings FROM hotkeys ORDER BY action")
        .map_err(|e| format!("failed to read hotkeys: {e}"))?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| format!("failed to read hotkeys: {e}"))?;
    for row in rows {
        let (action, raw) = row.map_err(|e| format!("failed to read hotkeys: {e}"))?;
        let bindings = serde_json::from_str(&raw)
            .map_err(|e| format!("hotkeys/{action} is corrupted: {e}"))?;
        snapshot.hotkeys.insert(action, bindings);
    }

    for (table, into) in [
        ("profiles", &mut snapshot.profiles),
        ("color_schemes", &mut snapshot.color_schemes),
    ] {
        let mut stmt = conn
            .prepare(&format!("SELECT data FROM {table} ORDER BY sort_order"))
            .map_err(|e| format!("failed to read {table}: {e}"))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("failed to read {table}: {e}"))?;
        for row in rows {
            let raw = row.map_err(|e| format!("failed to read {table}: {e}"))?;
            let data = serde_json::from_str(&raw)
                .map_err(|e| format!("{table} row is corrupted: {e}"))?;
            into.push(data);
        }
    }

    {
        let mut stmt = conn
            .prepare("SELECT id, name FROM quick_command_groups ORDER BY sort_order")
            .map_err(|e| format!("failed to read quick command groups: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(QuickCommandGroupRecord { id: row.get(0)?, name: row.get(1)? })
            })
            .map_err(|e| format!("failed to read quick command groups: {e}"))?;
        for row in rows {
            snapshot.quick_command_groups.push(row.map_err(|e| e.to_string())?);
        }
    }

    let mut stmt = conn
        .prepare("SELECT id, name, command, group_id, auto_run FROM quick_commands ORDER BY sort_order")
        .map_err(|e| format!("failed to read quick commands: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(QuickCommandRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                command: row.get(2)?,
                group_id: row.get(3)?,
                auto_run: row.get::<_, i64>(4)? != 0,
            })
        })
        .map_err(|e| format!("failed to read quick commands: {e}"))?;
    for row in rows {
        snapshot.quick_commands.push(row.map_err(|e| e.to_string())?);
    }

    {
        let mut stmt = conn
            .prepare("SELECT id, name, is_default FROM local_groups ORDER BY sort_order")
            .map_err(|e| format!("failed to read local groups: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(LocalGroupRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    is_default: row.get::<_, i64>(2)? != 0,
                })
            })
            .map_err(|e| format!("failed to read local groups: {e}"))?;
        for row in rows {
            snapshot.local_groups.push(row.map_err(|e| e.to_string())?);
        }
    }

    {
        let mut stmt = conn
            .prepare("SELECT id, name FROM ssh_groups ORDER BY sort_order")
            .map_err(|e| format!("failed to read ssh groups: {e}"))?;
        let rows = stmt
            .query_map([], |row| Ok(SshGroupRecord { id: row.get(0)?, name: row.get(1)? }))
            .map_err(|e| format!("failed to read ssh groups: {e}"))?;
        for row in rows {
            snapshot.ssh_groups.push(row.map_err(|e| e.to_string())?);
        }
    }

    {
        let mut stmt = conn
            .prepare("SELECT id, name, color, persist_tabs, collapsed, sort_order FROM tab_groups ORDER BY sort_order")
            .map_err(|e| format!("failed to read tab groups: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TabGroupRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    persist_tabs: row.get::<_, i64>(3)? != 0,
                    collapsed: row.get::<_, i64>(4)? != 0,
                    sort_order: row.get(5)?,
                })
            })
            .map_err(|e| format!("failed to read tab groups: {e}"))?;
        for row in rows {
            snapshot.tab_groups.push(row.map_err(|e| e.to_string())?);
        }
    }

    Ok(Some(snapshot))
}

///
/// @description 聚合读取全量配置；全新库返回 None（前端据此走 legacy yaml 迁移分支）
/// @param state 配置库状态
/// @returns Result<Option<ConfigSnapshot>, String> 库内快照；全新库为 None
///
#[tauri::command]
pub fn config_load(state: State<'_, ConfigState>) -> Result<Option<ConfigSnapshot>, String> {
    load_internal(&state)
}
