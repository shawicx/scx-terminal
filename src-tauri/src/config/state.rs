//! @description 配置库状态与 schema：app_data_dir/config.db 的单连接（WAL）、
//! PRAGMA user_version 版本化迁移、meta 键值读写与 JSON/排序通用工具。

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

/// 配置库状态：app_data_dir/config.db 的单连接（WAL）
pub struct ConfigState {
    conn: Mutex<Connection>,
}

impl ConfigState {
    /// 打开/建库并执行迁移；失败直接 panic（配置不可写则应用无法持久化）
    pub fn new(dir: &Path) -> Self {
        std::fs::create_dir_all(dir).expect("failed to create app data dir");
        let conn = Connection::open(dir.join("config.db")).expect("failed to open config.db");
        // WAL 返回新 journal mode，需走 query 而非 pragma_update
        let _mode: String = conn
            .query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))
            .expect("failed to enable WAL");
        migrate(&conn).expect("failed to init config schema");
        Self { conn: Mutex::new(conn) }
    }

    /// 供域内写入函数与备份模块（snapshot.rs）做行级读写；锁语义与模块内一致
    pub(crate) fn lock_conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }
}

/// 基于 PRAGMA user_version 的迁移；v1 = 初始表结构
fn migrate(conn: &Connection) -> Result<(), String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| format!("failed to read user_version: {e}"))?;
    if version < 1 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS hotkeys (
                action TEXT PRIMARY KEY,
                bindings TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL,
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS color_schemes (
                name TEXT PRIMARY KEY,
                sort_order INTEGER NOT NULL,
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS quick_command_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS quick_commands (
                id TEXT PRIMARY KEY,
                group_id TEXT,
                name TEXT NOT NULL,
                command TEXT NOT NULL,
                auto_run INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL
            );
            PRAGMA user_version = 1;",
        )
        .map_err(|e| format!("failed to create config schema: {e}"))?;
    }
    if version < 2 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS ssh_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL
            );
            PRAGMA user_version = 2;",
        )
        .map_err(|e| format!("failed to create ssh_groups schema: {e}"))?;
    }
    if version < 3 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS tab_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT,
                sort_order INTEGER NOT NULL,
                persist_tabs INTEGER NOT NULL DEFAULT 0,
                collapsed INTEGER NOT NULL DEFAULT 0
            );
            PRAGMA user_version = 3;",
        )
        .map_err(|e| format!("failed to create tab_groups schema: {e}"))?;
    }
    if version < 4 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS local_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL
            );
            PRAGMA user_version = 4;",
        )
        .map_err(|e| format!("failed to create local_groups schema: {e}"))?;
    }
    Ok(())
}

/// 在写入事务中标记「库已初始化」（区分从未写过与写了空配置；备份导入复用）
pub(crate) fn mark_initialized(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('initialized', '1')
         ON CONFLICT(key) DO UPDATE SET value = '1'",
        [],
    )
}

/// 读 meta 键值（不存在返回 None）——deviceId / 云端同步时间戳等机器本地元数据
pub(crate) fn meta_get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| row.get(0))
        .optional()
}

/// upsert meta 键值（机器本地元数据；不影响 initialized 语义）
pub(crate) fn meta_set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
}

/// 从 JSON 提取字符串字段（缺失/类型不符时用空串兜底）
pub(super) fn json_str(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

/// 从 JSON 提取布尔字段（缺失/类型不符时用 false 兜底）
pub(super) fn json_bool(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// 追加排序号：当前最大值 + 1（空表为 0）
pub(super) fn next_sort_order(conn: &Connection, table: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        &format!("SELECT COALESCE(MAX(sort_order) + 1, 0) FROM {table}"),
        [],
        |row| row.get(0),
    )
}
