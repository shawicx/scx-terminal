//! @description 命令历史持久化：SQLite（history.db，独立于 config.db——历史是高频写
//! 数据不属于配置语义）。沿用 config.rs 的「Mutex 单连接 + WAL + PRAGMA user_version
//! 迁移」模式。同 source 同命令去重存储（更新 run_at/hit_count）；导入经 meta 表
//! `imported:{source}` 标记幂等，清空时顺带清除标记以便重新导入。

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

/// 历史条目（history_list 返回；camelCase 序列化）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub source: String,
    pub command: String,
    pub run_at: i64,
    pub hit_count: i64,
}

/// 导入条目（前端解析 shell history 文件后批量传入）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryImportEntry {
    pub command: String,
    pub run_at: i64,
}

/// 历史库状态：app_data_dir/history.db 的单连接（WAL）
pub struct HistoryState {
    conn: Mutex<Connection>,
}

impl HistoryState {
    /// 打开/建库并执行迁移；失败 panic（与 config.rs 同策略：不可写则功能不可用，fast-fail）
    pub fn new (dir: &Path) -> Self {
        std::fs::create_dir_all(dir).expect("failed to create app data dir");
        let conn = Connection::open(dir.join("history.db")).expect("failed to open history.db");
        let _mode: String = conn
            .query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))
            .expect("failed to enable WAL");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                command TEXT NOT NULL,
                run_at INTEGER NOT NULL,
                hit_count INTEGER NOT NULL DEFAULT 1,
                UNIQUE(source, command)
            );
            CREATE INDEX IF NOT EXISTS idx_history_source_run ON history(source, run_at DESC);
            PRAGMA user_version = 1;",
        )
        .expect("failed to init history schema");
        Self { conn: Mutex::new(conn) }
    }
}

/// 记录一次命令执行（同 source 同命令 upsert：更新 run_at、hit_count +1）
#[tauri::command]
pub fn history_record (state: State<'_, HistoryState>, source: String, command: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    history_record_impl(&conn, &source, &command)
}

fn history_record_impl (conn: &Connection, source: &str, command: &str) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO history (source, command, run_at, hit_count) VALUES (?1, ?2, ?3, 1)
         ON CONFLICT(source, command) DO UPDATE SET run_at = ?3, hit_count = hit_count + 1",
        params![source, command, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 按执行时间降序列出历史；source 为 None 时跨全部来源（limit 缺省 5000）
#[tauri::command]
pub fn history_list (state: State<'_, HistoryState>, source: Option<String>, limit: Option<i64>) -> Result<Vec<HistoryEntry>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    history_list_impl(&conn, source.as_deref(), limit)
}

fn history_list_impl (conn: &Connection, source: Option<&str>, limit: Option<i64>) -> Result<Vec<HistoryEntry>, String> {
    let limit = limit.unwrap_or(5000).clamp(1, 50000);
    let mut stmt = match source {
        Some(_) => conn
            .prepare("SELECT source, command, run_at, hit_count FROM history WHERE source = ?1 ORDER BY run_at DESC LIMIT ?2")
            .map_err(|e| e.to_string())?,
        None => conn
            .prepare("SELECT source, command, run_at, hit_count FROM history ORDER BY run_at DESC LIMIT ?1")
            .map_err(|e| e.to_string())?,
    };
    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<HistoryEntry> {
        Ok(HistoryEntry { source: row.get(0)?, command: row.get(1)?, run_at: row.get(2)?, hit_count: row.get(3)? })
    };
    let rows = match source {
        Some(source) => stmt.query_map(params![source, limit], map_row).map_err(|e| e.to_string())?,
        None => stmt.query_map(params![limit], map_row).map_err(|e| e.to_string())?,
    };
    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| e.to_string())?);
    }
    Ok(entries)
}

/// 批量导入（幂等：meta 表 imported:{source} 已标记则跳过返回 0）
#[tauri::command]
pub fn history_import (state: State<'_, HistoryState>, source: String, entries: Vec<HistoryImportEntry>) -> Result<usize, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    history_import_impl(&mut conn, &source, &entries)
}

fn history_import_impl (conn: &mut Connection, source: &str, entries: &[HistoryImportEntry]) -> Result<usize, String> {
    let marker = format!("imported:{source}");
    let imported: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = ?1", params![marker], |row| row.get(0))
        .map(Some)
        .or_else(|e| if e == rusqlite::Error::QueryReturnedNoRows { Ok(None) } else { Err(e) })
        .map_err(|e| e.to_string())?;
    if imported.is_some() {
        return Ok(0);
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for entry in entries {
        tx.execute(
            "INSERT INTO history (source, command, run_at, hit_count) VALUES (?1, ?2, ?3, 1)
             ON CONFLICT(source, command) DO UPDATE SET run_at = MAX(run_at, ?3)",
            params![source, entry.command, entry.run_at],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute("INSERT INTO meta (key, value) VALUES (?1, '1') ON CONFLICT(key) DO UPDATE SET value = '1'", params![marker])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(entries.len())
}

/// 清空历史；source 为 None 清全部。顺带删除 imported 标记（允许之后重新导入）
#[tauri::command]
pub fn history_clear (state: State<'_, HistoryState>, source: Option<String>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    history_clear_impl(&conn, source.as_deref())
}

fn history_clear_impl (conn: &Connection, source: Option<&str>) -> Result<(), String> {
    match source {
        Some(source) => {
            conn.execute("DELETE FROM history WHERE source = ?1", params![source]).map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM meta WHERE key = ?1", params![format!("imported:{source}")]).map_err(|e| e.to_string())?;
        }
        None => {
            conn.execute("DELETE FROM history", []).map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM meta WHERE key LIKE 'imported:%'", []).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_conn () -> Connection {
        let dir = std::env::temp_dir().join(format!("scx-history-test-{}", uuid::Uuid::new_v4()));
        HistoryState::new(&dir).conn.into_inner().unwrap()
    }

    #[test]
    fn record_upserts_run_at_and_hit_count () {
        let conn = temp_conn();
        history_record_impl(&conn, "local:p1", "git status").unwrap();
        history_record_impl(&conn, "local:p1", "git status").unwrap();
        let entries = history_list_impl(&conn, None, None).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].hit_count, 2);
        assert_eq!(entries[0].command, "git status");
    }

    #[test]
    fn list_orders_by_run_at_desc_and_filters_source () {
        let conn = temp_conn();
        history_record_impl(&conn, "local:a", "cmd-a").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        history_record_impl(&conn, "ssh:h", "cmd-b").unwrap();
        let all = history_list_impl(&conn, None, None).unwrap();
        assert_eq!(all[0].command, "cmd-b");
        let only = history_list_impl(&conn, Some("local:a"), None).unwrap();
        assert_eq!(only.len(), 1);
        assert_eq!(only[0].command, "cmd-a");
    }

    #[test]
    fn import_is_idempotent_per_source () {
        let mut conn = temp_conn();
        let entries = vec![HistoryImportEntry { command: "ls -la".into(), run_at: 100 }];
        let first = history_import_impl(&mut conn, "local:p1", &entries).unwrap();
        let second = history_import_impl(&mut conn, "local:p1", &entries).unwrap();
        assert_eq!(first, 1);
        assert_eq!(second, 0);
    }

    #[test]
    fn clear_removes_entries_and_import_marker () {
        let mut conn = temp_conn();
        history_import_impl(&mut conn, "local:p1", &[HistoryImportEntry { command: "x".into(), run_at: 1 }]).unwrap();
        history_clear_impl(&conn, Some("local:p1")).unwrap();
        assert!(history_list_impl(&conn, None, None).unwrap().is_empty());
        // 清空后可重新导入（imported 标记一并清除）
        let again = history_import_impl(&mut conn, "local:p1", &[HistoryImportEntry { command: "x".into(), run_at: 1 }]).unwrap();
        assert_eq!(again, 1);
    }
}
