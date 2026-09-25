//! config.db 纳入实体的行级读写：导出侧全量读取（保排序、settings 走备份白名单）、
//! 导入侧身份键预校验与全量替换写回（单事务）。

use rusqlite::OptionalExtension;

use crate::config::{mark_initialized, ConfigState};

use super::model::{
    BackupConfig, ColorSchemeRow, GroupRow, LocalGroupRow, ProfileRow, QuickCommandRow,
    BACKUP_SETTINGS_KEYS,
};

/// 行级读取 config.db 纳入实体（保排序；settings 只取备份白名单键）
pub(super) fn read_config_rows(config: &ConfigState) -> Result<BackupConfig, String> {
    let conn = config.lock_conn();
    let mut rows = BackupConfig::default();

    for key in BACKUP_SETTINGS_KEYS {
        let raw: Option<String> = conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0))
            .optional()
            .map_err(|e| format!("failed to read settings/{key}: {e}"))?;
        if let Some(raw) = raw {
            let value = serde_json::from_str(&raw)
                .map_err(|e| format!("settings/{key} is corrupted: {e}"))?;
            rows.settings.insert(key.to_string(), value);
        }
    }

    {
        let mut stmt = conn
            .prepare("SELECT action, bindings FROM hotkeys ORDER BY action")
            .map_err(|e| format!("failed to read hotkeys: {e}"))?;
        let result = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| format!("failed to read hotkeys: {e}"))?;
        for row in result {
            let (action, raw) = row.map_err(|e| format!("failed to read hotkeys: {e}"))?;
            let bindings = serde_json::from_str(&raw)
                .map_err(|e| format!("hotkeys/{action} is corrupted: {e}"))?;
            rows.hotkeys.insert(action, bindings);
        }
    }

    {
        let mut stmt = conn
            .prepare("SELECT sort_order, data FROM profiles ORDER BY sort_order")
            .map_err(|e| format!("failed to read profiles: {e}"))?;
        let result = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| format!("failed to read profiles: {e}"))?;
        for row in result {
            let (sort_order, raw) = row.map_err(|e| format!("failed to read profiles: {e}"))?;
            let data = serde_json::from_str(&raw).map_err(|e| format!("profile row is corrupted: {e}"))?;
            rows.profiles.push(ProfileRow { sort_order, data });
        }
    }

    {
        let mut stmt = conn
            .prepare("SELECT name, sort_order, data FROM color_schemes ORDER BY sort_order")
            .map_err(|e| format!("failed to read color schemes: {e}"))?;
        let result = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?))
            })
            .map_err(|e| format!("failed to read color schemes: {e}"))?;
        for row in result {
            let (name, sort_order, raw) = row.map_err(|e| format!("failed to read color schemes: {e}"))?;
            let data = serde_json::from_str(&raw).map_err(|e| format!("color scheme {name} is corrupted: {e}"))?;
            rows.color_schemes.push(ColorSchemeRow { name, sort_order, data });
        }
    }

    {
        let mut stmt = conn
            .prepare("SELECT id, group_id, name, command, auto_run, sort_order FROM quick_commands ORDER BY sort_order")
            .map_err(|e| format!("failed to read quick commands: {e}"))?;
        let result = stmt
            .query_map([], |row| {
                Ok(QuickCommandRow {
                    id: row.get(0)?,
                    group_id: row.get(1)?,
                    name: row.get(2)?,
                    command: row.get(3)?,
                    auto_run: row.get::<_, i64>(4)? != 0,
                    sort_order: row.get(5)?,
                })
            })
            .map_err(|e| format!("failed to read quick commands: {e}"))?;
        for row in result {
            rows.quick_commands.push(row.map_err(|e| format!("failed to read quick commands: {e}"))?);
        }
    }

    {
        let mut stmt = conn
            .prepare("SELECT id, name, is_default, sort_order FROM local_groups ORDER BY sort_order")
            .map_err(|e| format!("failed to read local groups: {e}"))?;
        let result = stmt
            .query_map([], |row| {
                Ok(LocalGroupRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    is_default: row.get::<_, i64>(2)? != 0,
                    sort_order: row.get(3)?,
                })
            })
            .map_err(|e| format!("failed to read local groups: {e}"))?;
        for row in result {
            rows.local_groups.push(row.map_err(|e| format!("failed to read local groups: {e}"))?);
        }
    }

    for (table, into) in [
        ("quick_command_groups", &mut rows.quick_command_groups),
        ("ssh_groups", &mut rows.ssh_groups),
    ] {
        let mut stmt = conn
            .prepare(&format!("SELECT id, name, sort_order FROM {table} ORDER BY sort_order"))
            .map_err(|e| format!("failed to read {table}: {e}"))?;
        let result = stmt
            .query_map([], |row| {
                Ok(GroupRow { id: row.get(0)?, name: row.get(1)?, sort_order: row.get(2)? })
            })
            .map_err(|e| format!("failed to read {table}: {e}"))?;
        for row in result {
            into.push(row.map_err(|e| format!("failed to read {table}: {e}"))?);
        }
    }

    Ok(rows)
}

/// 写库前校验备份行身份键（缺 id/name 的行在触碰任何库之前拒绝）
pub(super) fn validate_backup_rows(rows: &BackupConfig) -> Result<(), String> {
    for row in &rows.profiles {
        let missing = row
            .data
            .get("id")
            .and_then(serde_json::Value::as_str)
            .filter(|id| !id.is_empty())
            .is_none();
        if missing {
            return Err("invalid backup file: profile row missing id".to_string());
        }
    }
    if rows.color_schemes.iter().any(|row| row.name.is_empty()) {
        return Err("invalid backup file: color scheme row missing name".to_string());
    }
    if rows.quick_commands.iter().any(|row| row.id.is_empty()) {
        return Err("invalid backup file: quick command row missing id".to_string());
    }
    if rows.quick_command_groups.iter().chain(rows.ssh_groups.iter()).any(|row| row.id.is_empty()) {
        return Err("invalid backup file: group row missing id".to_string());
    }
    if rows.local_groups.iter().any(|row| row.id.is_empty()) {
        return Err("invalid backup file: local group row missing id".to_string());
    }
    Ok(())
}

/// 全量替换写回 config.db 纳入表（单事务；settings 仅覆盖备份白名单键，保留 tabSession 等本机键）
pub(super) fn write_config_rows(config: &ConfigState, rows: &BackupConfig) -> Result<(), String> {
    let mut conn = config.lock_conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM settings WHERE key IN ('terminal', 'appearance', 'advanced')",
        [],
    )
    .map_err(|e| format!("failed to clear settings: {e}"))?;
    for (key, value) in &rows.settings {
        tx.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value.to_string()],
        )
        .map_err(|e| format!("failed to import settings/{key}: {e}"))?;
    }
    tx.execute("DELETE FROM hotkeys", []).map_err(|e| format!("failed to clear hotkeys: {e}"))?;
    for (action, value) in &rows.hotkeys {
        tx.execute(
            "INSERT INTO hotkeys (action, bindings) VALUES (?1, ?2)",
            rusqlite::params![action, value.to_string()],
        )
        .map_err(|e| format!("failed to import hotkey/{action}: {e}"))?;
    }
    tx.execute("DELETE FROM profiles", []).map_err(|e| format!("failed to clear profiles: {e}"))?;
    for row in &rows.profiles {
        let data = &row.data;
        tx.execute(
            "INSERT INTO profiles (id, type, name, is_default, sort_order, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                data.get("id").and_then(serde_json::Value::as_str).unwrap_or_default(),
                data.get("type").and_then(serde_json::Value::as_str).unwrap_or_default(),
                data.get("name").and_then(serde_json::Value::as_str).unwrap_or_default(),
                data.get("isDefault").and_then(serde_json::Value::as_bool).unwrap_or(false),
                row.sort_order,
                data.to_string(),
            ],
        )
        .map_err(|e| format!("failed to import profile: {e}"))?;
    }
    tx.execute("DELETE FROM color_schemes", [])
        .map_err(|e| format!("failed to clear color schemes: {e}"))?;
    for row in &rows.color_schemes {
        tx.execute(
            "INSERT INTO color_schemes (name, sort_order, data) VALUES (?1, ?2, ?3)",
            rusqlite::params![row.name, row.sort_order, row.data.to_string()],
        )
        .map_err(|e| format!("failed to import color scheme {}: {e}", row.name))?;
    }
    tx.execute("DELETE FROM quick_command_groups", [])
        .map_err(|e| format!("failed to clear quick command groups: {e}"))?;
    for row in &rows.quick_command_groups {
        tx.execute(
            "INSERT INTO quick_command_groups (id, name, sort_order) VALUES (?1, ?2, ?3)",
            rusqlite::params![row.id, row.name, row.sort_order],
        )
        .map_err(|e| format!("failed to import quick command group {}: {e}", row.id))?;
    }
    tx.execute("DELETE FROM quick_commands", [])
        .map_err(|e| format!("failed to clear quick commands: {e}"))?;
    for row in &rows.quick_commands {
        tx.execute(
            "INSERT INTO quick_commands (id, group_id, name, command, auto_run, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![row.id, row.group_id, row.name, row.command, row.auto_run, row.sort_order],
        )
        .map_err(|e| format!("failed to import quick command {}: {e}", row.id))?;
    }
    tx.execute("DELETE FROM local_groups", []).map_err(|e| format!("failed to clear local groups: {e}"))?;
    for row in &rows.local_groups {
        tx.execute(
            "INSERT INTO local_groups (id, name, is_default, sort_order) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![row.id, row.name, row.is_default, row.sort_order],
        )
        .map_err(|e| format!("failed to import local group {}: {e}", row.id))?;
    }
    tx.execute("DELETE FROM ssh_groups", []).map_err(|e| format!("failed to clear ssh groups: {e}"))?;
    for row in &rows.ssh_groups {
        tx.execute(
            "INSERT INTO ssh_groups (id, name, sort_order) VALUES (?1, ?2, ?3)",
            rusqlite::params![row.id, row.name, row.sort_order],
        )
        .map_err(|e| format!("failed to import ssh group {}: {e}", row.id))?;
    }
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit config import: {e}"))
}
