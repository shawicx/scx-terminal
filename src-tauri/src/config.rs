//! @description 应用配置持久化：SQLite（config.db）实体级 CRUD。
//! 前端拥有配置形状（类型 + 默认值 + 合并），Rust 只负责可靠存储——沿用与
//! secrets.db 相同的「Mutex 单连接 + 同步命令」模式。表结构经 PRAGMA user_version
//! 迁移；档案/自定义配色用「身份/排序列 + data JSON」混合存储（形状随前端演进），
//! 快捷命令与分组字段稳定，用真实列。旧 config.yaml 仅用于一次性迁移（读取后改名归档）。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, State};

const SETTINGS_KEYS: [&str; 5] = ["terminal", "appearance", "advanced", "recents", "monitor"];

/// 快捷命令记录（真实列存储；groupId 为 NULL 时序列化省略键，保持 optional 语义）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickCommandRecord {
    pub id: String,
    pub name: String,
    pub command: String,
    /// 所属分组 id；None = 未分组
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(default)]
    pub auto_run: bool,
}

/// 快捷命令分组记录
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickCommandGroupRecord {
    pub id: String,
    pub name: String,
}

/// SSH 档案分组记录
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshGroupRecord {
    pub id: String,
    pub name: String,
}

/// 本地档案分组记录（is_default 标系统默认分组：不可删除、不可重命名，锁定为前端 UI 约束）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalGroupRecord {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub is_default: bool,
}

/// 标签分组记录（collapsed 为 TabStrip 折叠态，随定义持久化）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabGroupRecord {
    pub id: String,
    pub name: String,
    /// 组色（7 色预设色板色值）；None = 无色
    pub color: Option<String>,
    #[serde(default)]
    pub persist_tabs: bool,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub sort_order: i64,
}

/// 启动聚合读取的全量快照（档案/配色从 data JSON 重建，快捷命令/分组从列重建）
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSnapshot {
    pub terminal: Option<Value>,
    pub appearance: Option<Value>,
    pub advanced: Option<Value>,
    pub recents: Option<Value>,
    pub monitor: Option<Value>,
    pub hotkeys: BTreeMap<String, Value>,
    pub profiles: Vec<Value>,
    pub color_schemes: Vec<Value>,
    pub quick_commands: Vec<QuickCommandRecord>,
    pub quick_command_groups: Vec<QuickCommandGroupRecord>,
    pub local_groups: Vec<LocalGroupRecord>,
    pub ssh_groups: Vec<SshGroupRecord>,
    pub tab_groups: Vec<TabGroupRecord>,
}

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

    /// 供备份模块（snapshot.rs）做行级读写；锁语义与本模块内部一致
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
fn json_str(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

/// 从 JSON 提取布尔字段（缺失/类型不符时用 false 兜底）
fn json_bool(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// 追加排序号：当前最大值 + 1（空表为 0）
fn next_sort_order(conn: &Connection, table: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        &format!("SELECT COALESCE(MAX(sort_order) + 1, 0) FROM {table}"),
        [],
        |row| row.get(0),
    )
}

// ---- 读取 ----

/// 聚合读取全量配置；meta 无 initialized 标记（全新库）时返回 None（备份模块导入后校验复用）
pub(crate) fn load_internal(state: &ConfigState) -> Result<Option<ConfigSnapshot>, String> {
    let conn = state.conn.lock().unwrap();
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

// ---- 写入：settings / hotkeys ----

/// upsert 设置分片（key 白名单校验）
fn settings_set_section_internal(state: &ConfigState, key: &str, value: &Value) -> Result<(), String> {
    if !SETTINGS_KEYS.contains(&key) {
        return Err(format!("unknown settings section: {key}"));
    }
    let mut conn = state.conn.lock().unwrap();
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
fn hotkey_set_internal(state: &ConfigState, action: &str, bindings: &Value) -> Result<(), String> {
    if action.is_empty() {
        return Err("hotkey action must not be empty".to_string());
    }
    let mut conn = state.conn.lock().unwrap();
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

// ---- 写入：profiles ----

/// 新增配置档案（id 必填；排序列取当前最大值 + 1）
fn profile_create_internal(state: &ConfigState, profile: &Value) -> Result<(), String> {
    let id = profile
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "profile is missing a non-empty id".to_string())?
        .to_string();
    let profile_type = json_str(profile, "type");
    let name = json_str(profile, "name");
    let is_default = json_bool(profile, "isDefault");
    let mut conn = state.conn.lock().unwrap();
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
fn profile_update_internal(state: &ConfigState, profile: &Value) -> Result<(), String> {
    let id = profile
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "profile is missing a non-empty id".to_string())?
        .to_string();
    let mut conn = state.conn.lock().unwrap();
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
fn profile_delete_internal(state: &ConfigState, id: &str) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM profiles WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete profile {id}: {e}"))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit profile delete: {e}"))
}

// ---- 写入：快捷命令与分组 ----

/// 新增快捷命令（排序列取当前最大值 + 1）
fn quick_command_create_internal(state: &ConfigState, command: &QuickCommandRecord) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
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
fn quick_command_update_internal(state: &ConfigState, command: &QuickCommandRecord) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
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
fn quick_command_delete_internal(state: &ConfigState, id: &str) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM quick_commands WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete quick command {id}: {e}"))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit quick command delete: {e}"))
}

/// 新增快捷命令分组
fn quick_command_group_create_internal(state: &ConfigState, group: &QuickCommandGroupRecord) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
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
fn quick_command_group_update_internal(state: &ConfigState, group: &QuickCommandGroupRecord) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
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
fn quick_command_group_delete_internal(state: &ConfigState, id: &str) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM quick_command_groups WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete quick command group {id}: {e}"))?;
    tx.execute("UPDATE quick_commands SET group_id = NULL WHERE group_id = ?1", [id])
        .map_err(|e| format!("failed to ungroup quick commands of {id}: {e}"))?;
    mark_initialized(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| format!("failed to commit quick command group delete: {e}"))
}

// ---- 写入：本地档案分组 ----

/// 新增本地档案分组
fn local_group_create_internal(state: &ConfigState, group: &LocalGroupRecord) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let sort_order = next_sort_order(&tx, "local_groups").map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO local_groups (id, name, is_default, sort_order) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![group.id, group.name, group.is_default as i64, sort_order],
    )
    .map_err(|e| format!("failed to create local group {}: {e}", group.id))?;
    mark_initialized(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| format!("failed to commit local group create: {e}"))
}

/// 更新本地档案分组（按 id）
fn local_group_update_internal(state: &ConfigState, group: &LocalGroupRecord) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
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
    mark_initialized(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| format!("failed to commit local group update: {e}"))
}

/// 删除本地档案分组：单事务内删组并把组内本地档案降级未分组（groupId 存于 profiles 的
/// data JSON 内，需逐行改写 JSON 后回写；对齐 SSH 分组「删组降级」语义）
fn local_group_delete_internal(state: &ConfigState, id: &str) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM local_groups WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete local group {id}: {e}"))?;
    let members: Vec<(String, String)> = {
        let mut stmt = tx
            .prepare("SELECT id, data FROM profiles WHERE type = 'local'")
            .map_err(|e| format!("failed to read local profiles: {e}"))?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| format!("failed to read local profiles: {e}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?
    };
    for (profile_id, raw) in members {
        let Ok(mut data) = serde_json::from_str::<serde_json::Map<String, Value>>(&raw) else {
            continue;
        };
        if data.get("groupId").and_then(Value::as_str) == Some(id) {
            data.remove("groupId");
            tx.execute(
                "UPDATE profiles SET data = ?1 WHERE id = ?2",
                rusqlite::params![Value::Object(data).to_string(), profile_id],
            )
            .map_err(|e| format!("failed to ungroup local profile {profile_id}: {e}"))?;
        }
    }
    mark_initialized(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| format!("failed to commit local group delete: {e}"))
}

// ---- 写入：SSH 分组 ----

/// 新增 SSH 分组
fn ssh_group_create_internal(state: &ConfigState, group: &SshGroupRecord) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let sort_order = next_sort_order(&tx, "ssh_groups").map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO ssh_groups (id, name, sort_order) VALUES (?1, ?2, ?3)",
        rusqlite::params![group.id, group.name, sort_order],
    )
    .map_err(|e| format!("failed to create ssh group {}: {e}", group.id))?;
    mark_initialized(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| format!("failed to commit ssh group create: {e}"))
}

/// 更新 SSH 分组（按 id）
fn ssh_group_update_internal(state: &ConfigState, group: &SshGroupRecord) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
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
    mark_initialized(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| format!("failed to commit ssh group update: {e}"))
}

/// 删除 SSH 分组：单事务内删组并把组内 SSH 档案降级默认分组（groupId 存于 profiles 的
/// data JSON 内，需逐行改写 JSON 后回写；对齐快捷命令「删组降级」语义）
fn ssh_group_delete_internal(state: &ConfigState, id: &str) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM ssh_groups WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete ssh group {id}: {e}"))?;
    let members: Vec<(String, String)> = {
        let mut stmt = tx
            .prepare("SELECT id, data FROM profiles WHERE type = 'ssh'")
            .map_err(|e| format!("failed to read ssh profiles: {e}"))?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| format!("failed to read ssh profiles: {e}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?
    };
    for (profile_id, raw) in members {
        let Ok(mut data) = serde_json::from_str::<serde_json::Map<String, Value>>(&raw) else {
            continue;
        };
        if data.get("groupId").and_then(Value::as_str) == Some(id) {
            data.remove("groupId");
            tx.execute(
                "UPDATE profiles SET data = ?1 WHERE id = ?2",
                rusqlite::params![Value::Object(data).to_string(), profile_id],
            )
            .map_err(|e| format!("failed to ungroup ssh profile {profile_id}: {e}"))?;
        }
    }
    mark_initialized(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| format!("failed to commit ssh group delete: {e}"))
}

// ---- 写入：标签分组 ----

/// 新增标签分组
fn tab_group_create_internal(state: &ConfigState, group: &TabGroupRecord) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let sort_order = next_sort_order(&tx, "tab_groups").map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO tab_groups (id, name, color, sort_order, persist_tabs, collapsed) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![group.id, group.name, group.color, sort_order, group.persist_tabs as i64, group.collapsed as i64],
    )
    .map_err(|e| format!("failed to create tab group {}: {e}", group.id))?;
    mark_initialized(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| format!("failed to commit tab group create: {e}"))
}

/// 更新标签分组（按 id）
fn tab_group_update_internal(state: &ConfigState, group: &TabGroupRecord) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
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
    mark_initialized(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| format!("failed to commit tab group update: {e}"))
}

/// 删除标签分组（幂等；成员归属由前端运行时清理）
fn tab_group_delete_internal(state: &ConfigState, id: &str) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM tab_groups WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete tab group {id}: {e}"))?;
    mark_initialized(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| format!("failed to commit tab group delete: {e}"))
}

// ---- 写入：标签恢复快照 ----

/// 读取标签恢复快照（settings 表 tabSession 键）
fn tab_session_get_internal(state: &ConfigState) -> Result<Option<Value>, String> {
    let conn = state.conn.lock().unwrap();
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
fn tab_session_set_internal(state: &ConfigState, value: &Value) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('tabSession', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [value.to_string()],
    )
    .map_err(|e| format!("failed to save tab session: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit tab session: {e}"))
}

// ---- 写入：自定义配色 ----

/// upsert 自定义配色（按 name；重命名由前端按「删旧建新」处理，净效果等价）
fn color_scheme_save_internal(state: &ConfigState, name: &str, data: &Value) -> Result<(), String> {
    if name.is_empty() {
        return Err("color scheme name must not be empty".to_string());
    }
    let mut conn = state.conn.lock().unwrap();
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
fn color_scheme_delete_internal(state: &ConfigState, name: &str) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM color_schemes WHERE name = ?1", [name])
        .map_err(|e| format!("failed to delete color scheme {name}: {e}"))?;
    mark_initialized(&tx).map_err(|e| format!("failed to mark config initialized: {e}"))?;
    tx.commit().map_err(|e| format!("failed to commit color scheme delete: {e}"))
}

// ---- 旧版 config.yaml 一次性迁移 ----

/// 旧版手写配置目录（仅迁移读取用；新库一律走 app_data_dir）
fn legacy_config_path(app: &tauri::AppHandle) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let base = app
            .path()
            .home_dir()
            .expect("home directory should be resolvable");
        base.join("Library/Application Support/scx-terminal/config.yaml")
    }
    #[cfg(target_os = "linux")]
    {
        let base = std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                app.path()
                    .home_dir()
                    .expect("home directory should be resolvable")
                    .join(".config")
            });
        base.join("scx-terminal/config.yaml")
    }
    #[cfg(target_os = "windows")]
    {
        let base = app
            .path()
            .app_config_dir()
            .expect("app config dir should be resolvable");
        base.join("scx-terminal/config.yaml")
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        app.path()
            .app_config_dir()
            .expect("app config dir should be resolvable")
            .join("scx-terminal/config.yaml")
    }
}

/// 把旧 config.yaml 改名为 config.yaml.migrated（迁移完成标记 + 天然备份）；文件不存在返回 false
fn archive_legacy_yaml_at(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let mut target = path.to_path_buf();
    target.set_file_name("config.yaml.migrated");
    std::fs::rename(path, target).map_err(|e| format!("could not archive {}: {e}", path.display()))?;
    Ok(true)
}

// ---- Tauri 命令（薄包装，逻辑在 *_internal 供单测复用） ----

/// 聚合读取全量配置；全新库返回 None（前端据此走 legacy yaml 迁移分支）
#[tauri::command]
pub fn config_load(state: State<'_, ConfigState>) -> Result<Option<ConfigSnapshot>, String> {
    load_internal(&state)
}

/// 读取旧版 config.yaml 原文；文件不存在返回 None
#[tauri::command]
pub fn config_load_legacy_yaml(app: tauri::AppHandle) -> Result<Option<String>, String> {
    match std::fs::read_to_string(legacy_config_path(&app)) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("could not read legacy config.yaml: {e}")),
    }
}

/// 旧 config.yaml 改名归档（config.yaml.migrated），返回是否执行了改名
#[tauri::command]
pub fn config_archive_legacy_yaml(app: tauri::AppHandle) -> Result<bool, String> {
    archive_legacy_yaml_at(&legacy_config_path(&app))
}

/// 暴露配置库所在目录（设置页展示/在 Finder 打开；config.db 与 secrets.db 同目录）
#[tauri::command]
pub fn config_dir_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// upsert 设置分片（terminal / appearance）
#[tauri::command]
pub fn settings_set_section(
    state: State<'_, ConfigState>,
    key: String,
    value: Value,
) -> Result<(), String> {
    settings_set_section_internal(&state, &key, &value)
}

/// upsert 单个热键绑定
#[tauri::command]
pub fn hotkey_set(state: State<'_, ConfigState>, action: String, bindings: Value) -> Result<(), String> {
    hotkey_set_internal(&state, &action, &bindings)
}

/// 新增配置档案
#[tauri::command]
pub fn profile_create(state: State<'_, ConfigState>, profile: Value) -> Result<(), String> {
    profile_create_internal(&state, &profile)
}

/// 更新配置档案
#[tauri::command]
pub fn profile_update(state: State<'_, ConfigState>, profile: Value) -> Result<(), String> {
    profile_update_internal(&state, &profile)
}

/// 删除配置档案
#[tauri::command]
pub fn profile_delete(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    profile_delete_internal(&state, &id)
}

/// 新增快捷命令
#[tauri::command]
pub fn quick_command_create(state: State<'_, ConfigState>, command: QuickCommandRecord) -> Result<(), String> {
    quick_command_create_internal(&state, &command)
}

/// 更新快捷命令
#[tauri::command]
pub fn quick_command_update(state: State<'_, ConfigState>, command: QuickCommandRecord) -> Result<(), String> {
    quick_command_update_internal(&state, &command)
}

/// 删除快捷命令
#[tauri::command]
pub fn quick_command_delete(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    quick_command_delete_internal(&state, &id)
}

/// 新增快捷命令分组
#[tauri::command]
pub fn quick_command_group_create(
    state: State<'_, ConfigState>,
    group: QuickCommandGroupRecord,
) -> Result<(), String> {
    quick_command_group_create_internal(&state, &group)
}

/// 更新快捷命令分组
#[tauri::command]
pub fn quick_command_group_update(
    state: State<'_, ConfigState>,
    group: QuickCommandGroupRecord,
) -> Result<(), String> {
    quick_command_group_update_internal(&state, &group)
}

/// 删除快捷命令分组（组内命令降级为未分组）
#[tauri::command]
pub fn quick_command_group_delete(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    quick_command_group_delete_internal(&state, &id)
}

/// 新增本地档案分组
#[tauri::command]
pub fn local_group_create(state: State<'_, ConfigState>, group: LocalGroupRecord) -> Result<(), String> {
    local_group_create_internal(&state, &group)
}

/// 更新本地档案分组
#[tauri::command]
pub fn local_group_update(state: State<'_, ConfigState>, group: LocalGroupRecord) -> Result<(), String> {
    local_group_update_internal(&state, &group)
}

/// 删除本地档案分组（组内本地档案降级未分组）
#[tauri::command]
pub fn local_group_delete(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    local_group_delete_internal(&state, &id)
}

/// 新增 SSH 分组
#[tauri::command]
pub fn ssh_group_create(state: State<'_, ConfigState>, group: SshGroupRecord) -> Result<(), String> {
    ssh_group_create_internal(&state, &group)
}

/// 更新 SSH 分组
#[tauri::command]
pub fn ssh_group_update(state: State<'_, ConfigState>, group: SshGroupRecord) -> Result<(), String> {
    ssh_group_update_internal(&state, &group)
}

/// 删除 SSH 分组（组内 SSH 档案降级默认分组）
#[tauri::command]
pub fn ssh_group_delete(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    ssh_group_delete_internal(&state, &id)
}

/// 新增标签分组
#[tauri::command]
pub fn tab_group_create(state: State<'_, ConfigState>, group: TabGroupRecord) -> Result<(), String> {
    tab_group_create_internal(&state, &group)
}

/// 更新标签分组
#[tauri::command]
pub fn tab_group_update(state: State<'_, ConfigState>, group: TabGroupRecord) -> Result<(), String> {
    tab_group_update_internal(&state, &group)
}

/// 删除标签分组
#[tauri::command]
pub fn tab_group_delete(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    tab_group_delete_internal(&state, &id)
}

/// 读取标签恢复快照
#[tauri::command]
pub fn tab_session_get(state: State<'_, ConfigState>) -> Result<Option<Value>, String> {
    tab_session_get_internal(&state)
}

/// 写标签恢复快照
#[tauri::command]
pub fn tab_session_set(state: State<'_, ConfigState>, value: Value) -> Result<(), String> {
    tab_session_set_internal(&state, &value)
}

/// upsert 自定义配色
#[tauri::command]
pub fn color_scheme_save(state: State<'_, ConfigState>, name: String, data: Value) -> Result<(), String> {
    color_scheme_save_internal(&state, &name, &data)
}

/// 删除自定义配色
#[tauri::command]
pub fn color_scheme_delete(state: State<'_, ConfigState>, name: String) -> Result<(), String> {
    color_scheme_delete_internal(&state, &name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_state(tag: &str) -> ConfigState {
        let dir = std::env::temp_dir().join(format!("scx-config-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        ConfigState::new(&dir)
    }

    fn profile_json(id: &str, name: &str, profile_type: &str, is_default: bool) -> Value {
        serde_json::json!({
            "id": id,
            "type": profile_type,
            "name": name,
            "isDefault": is_default,
        })
    }

    fn command_json(id: &str, name: &str, group_id: Option<&str>) -> QuickCommandRecord {
        QuickCommandRecord {
            id: id.into(),
            name: name.into(),
            command: format!("echo {name}"),
            group_id: group_id.map(str::to_string),
            auto_run: false,
        }
    }

    #[test]
    fn load_returns_none_until_first_write() {
        let state = temp_state("fresh");
        assert!(load_internal(&state).unwrap().is_none());
        hotkey_set_internal(&state, "copy", &serde_json::json!([["⌘-C"]])).unwrap();
        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.hotkeys["copy"], serde_json::json!([["⌘-C"]]));
    }

    #[test]
    fn schema_is_versioned() {
        let state = temp_state("version");
        let conn = state.conn.lock().unwrap();
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap();
        assert_eq!(version, 4);
    }

    #[test]
    fn tab_groups_roundtrip_through_snapshot() {
        let state = temp_state("tabgroups-read");
        {
            let conn = state.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO tab_groups (id, name, color, sort_order, persist_tabs, collapsed) VALUES ('tg1', 'work', '#61afef', 0, 1, 0)",
                [],
            )
            .unwrap();
            // load_internal 对未写过配置的库返回 None，需先打初始化标记（等价真实写入路径）
            mark_initialized(&conn).unwrap();
        }
        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.tab_groups.len(), 1);
        assert_eq!(snapshot.tab_groups[0].name, "work");
        assert_eq!(snapshot.tab_groups[0].color.as_deref(), Some("#61afef"));
        assert!(snapshot.tab_groups[0].persist_tabs);
        assert!(!snapshot.tab_groups[0].collapsed);
    }

    #[test]
    fn tab_group_crud_roundtrip() {
        let state = temp_state("tabgroups-crud");
        tab_group_create_internal(&state, &TabGroupRecord {
            id: "tg1".into(), name: "work".into(), color: Some("#61afef".into()),
            sort_order: 0, persist_tabs: true, collapsed: false,
        })
        .unwrap();
        tab_group_update_internal(&state, &TabGroupRecord {
            id: "tg1".into(), name: "ops".into(), color: None,
            sort_order: 0, persist_tabs: false, collapsed: true,
        })
        .unwrap();
        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.tab_groups.len(), 1);
        assert_eq!(snapshot.tab_groups[0].name, "ops");
        assert!(snapshot.tab_groups[0].color.is_none());
        assert!(!snapshot.tab_groups[0].persist_tabs);
        assert!(snapshot.tab_groups[0].collapsed);
        assert!(tab_group_update_internal(&state, &TabGroupRecord {
            id: "missing".into(), name: "x".into(), color: None, sort_order: 0, persist_tabs: false, collapsed: false,
        })
        .is_err());
        tab_group_delete_internal(&state, "tg1").unwrap();
        tab_group_delete_internal(&state, "tg1").unwrap(); // 幂等
        let snapshot = load_internal(&state).unwrap().unwrap();
        assert!(snapshot.tab_groups.is_empty());
    }

    #[test]
    fn tab_session_roundtrip_without_initialized() {
        let state = temp_state("tabsession");
        assert!(tab_session_get_internal(&state).unwrap().is_none());
        tab_session_set_internal(&state, &serde_json::json!({ "version": 1, "entries": [] })).unwrap();
        let value = tab_session_get_internal(&state).unwrap().unwrap();
        assert_eq!(value["version"], 1);
        // 关键不变量：写快照不得置 initialized 位，否则全新库会跳过 legacy config.yaml 迁移
        assert!(load_internal(&state).unwrap().is_none());
    }

    #[test]
    fn settings_section_upsert_and_key_validation() {
        let state = temp_state("settings");
        assert!(settings_set_section_internal(&state, "hotkeys", &serde_json::json!({})).is_err());
        settings_set_section_internal(&state, "terminal", &serde_json::json!({"fontSize": 15})).unwrap();
        settings_set_section_internal(&state, "terminal", &serde_json::json!({"fontSize": 16})).unwrap();
        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.terminal.unwrap()["fontSize"], 16);
        assert!(snapshot.appearance.is_none());
    }

    #[test]
    fn advanced_section_round_trips() {
        let state = temp_state("advanced");
        settings_set_section_internal(&state, "advanced", &serde_json::json!({"debugEnabled": true})).unwrap();
        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.advanced.unwrap()["debugEnabled"], true);
    }

    #[test]
    fn recents_section_round_trips() {
        let state = temp_state("recents");
        settings_set_section_internal(&state, "recents", &serde_json::json!({"ssh-1": 1700000000000_u64})).unwrap();
        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.recents.unwrap()["ssh-1"], 1700000000000_u64);
    }

    #[test]
    fn profile_crud_round_trip_and_order_stability() {
        let state = temp_state("profiles");
        profile_create_internal(&state, &profile_json("p1", "zsh", "local", true)).unwrap();
        profile_create_internal(&state, &profile_json("p2", "build", "ssh", false)).unwrap();
        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.profiles.len(), 2);
        assert_eq!(snapshot.profiles[0]["id"], "p1");
        assert_eq!(snapshot.profiles[0]["isDefault"], true);
        assert_eq!(snapshot.profiles[1]["type"], "ssh");

        // 更新不改排序，列与 data 同步重提取
        profile_update_internal(&state, &profile_json("p1", "bash", "local", false)).unwrap();
        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.profiles[0]["name"], "bash");
        assert_eq!(snapshot.profiles[0]["isDefault"], false);
        assert_eq!(snapshot.profiles[0].as_object().unwrap().len(), 4); // data 只含传入字段

        // 删除幂等；缺 id 的档案被拒绝
        profile_delete_internal(&state, "p1").unwrap();
        profile_delete_internal(&state, "p1").unwrap();
        assert!(profile_create_internal(&state, &serde_json::json!({"name": "x"})).is_err());
        assert_eq!(load_internal(&state).unwrap().unwrap().profiles.len(), 1);
    }

    #[test]
    fn profile_update_missing_id_fails() {
        let state = temp_state("profile-miss");
        assert!(profile_update_internal(&state, &profile_json("ghost", "x", "local", false)).is_err());
    }

    #[test]
    fn quick_command_crud_round_trip() {
        let state = temp_state("qc");
        quick_command_create_internal(&state, &command_json("c1", "list", None)).unwrap();
        quick_command_create_internal(&state, &command_json("c2", "deploy", Some("g1"))).unwrap();

        // 更新换组 + 开 autoRun，排序不变
        let mut updated = command_json("c2", "deploy", Some("g2"));
        updated.auto_run = true;
        quick_command_update_internal(&state, &updated).unwrap();

        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.quick_commands.len(), 2);
        assert_eq!(snapshot.quick_commands[0].id, "c1");
        assert!(snapshot.quick_commands[0].group_id.is_none());
        assert_eq!(snapshot.quick_commands[1].group_id.as_deref(), Some("g2"));
        assert!(snapshot.quick_commands[1].auto_run);

        quick_command_delete_internal(&state, "c1").unwrap();
        quick_command_delete_internal(&state, "c1").unwrap();
        assert!(quick_command_update_internal(&state, &command_json("c1", "x", None)).is_err());
        assert_eq!(load_internal(&state).unwrap().unwrap().quick_commands.len(), 1);
    }

    #[test]
    fn group_delete_cascades_ungroup() {
        let state = temp_state("qc-group");
        quick_command_group_create_internal(&state, &QuickCommandGroupRecord { id: "g1".into(), name: "ops".into() }).unwrap();
        quick_command_create_internal(&state, &command_json("c1", "list", Some("g1"))).unwrap();
        quick_command_create_internal(&state, &command_json("c2", "free", None)).unwrap();

        quick_command_group_delete_internal(&state, "g1").unwrap();

        let snapshot = load_internal(&state).unwrap().unwrap();
        assert!(snapshot.quick_command_groups.is_empty());
        assert!(snapshot.quick_commands.iter().all(|c| c.group_id.is_none()));
    }

    #[test]
    fn group_crud_round_trip() {
        let state = temp_state("qc-group-crud");
        quick_command_group_create_internal(
            &state,
            &QuickCommandGroupRecord { id: "g1".into(), name: "ops".into() },
        )
        .unwrap();
        quick_command_group_update_internal(
            &state,
            &QuickCommandGroupRecord { id: "g1".into(), name: "运维".into() },
        )
        .unwrap();
        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.quick_command_groups[0].name, "运维");
        assert!(quick_command_group_update_internal(
            &state,
            &QuickCommandGroupRecord { id: "ghost".into(), name: "x".into() }
        )
        .is_err());
        quick_command_group_delete_internal(&state, "g1").unwrap();
        assert!(load_internal(&state).unwrap().unwrap().quick_command_groups.is_empty());
    }

    #[test]
    fn ssh_group_crud_round_trip() {
        let state = temp_state("ssh-group");
        ssh_group_create_internal(&state, &SshGroupRecord { id: "sg1".into(), name: "生产".into() }).unwrap();
        ssh_group_create_internal(&state, &SshGroupRecord { id: "sg2".into(), name: "测试".into() }).unwrap();
        ssh_group_update_internal(&state, &SshGroupRecord { id: "sg1".into(), name: "prod".into() }).unwrap();

        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.ssh_groups.len(), 2);
        assert_eq!(snapshot.ssh_groups[0].name, "prod");
        assert_eq!(snapshot.ssh_groups[1].name, "测试");
        assert!(ssh_group_update_internal(&state, &SshGroupRecord { id: "ghost".into(), name: "x".into() }).is_err());

        ssh_group_delete_internal(&state, "sg1").unwrap();
        ssh_group_delete_internal(&state, "sg1").unwrap(); // 幂等
        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.ssh_groups.len(), 1);
        assert_eq!(snapshot.ssh_groups[0].id, "sg2");
    }

    #[test]
    fn ssh_group_delete_cascades_ungroup() {
        let state = temp_state("ssh-group-cascade");
        ssh_group_create_internal(&state, &SshGroupRecord { id: "sg1".into(), name: "prod".into() }).unwrap();
        profile_create_internal(&state, &serde_json::json!({
            "id": "s1", "type": "ssh", "name": "web", "host": "h", "port": 22,
            "user": "root", "auth": "auto", "keyId": null, "colorScheme": null,
            "isDefault": false, "groupId": "sg1",
        }))
        .unwrap();
        profile_create_internal(&state, &serde_json::json!({
            "id": "s2", "type": "ssh", "name": "db", "host": "h2", "port": 22,
            "user": "root", "auth": "auto", "keyId": null, "colorScheme": null,
            "isDefault": false,
        }))
        .unwrap();
        profile_create_internal(&state, &profile_json("l1", "zsh", "local", false)).unwrap();

        ssh_group_delete_internal(&state, "sg1").unwrap();

        let snapshot = load_internal(&state).unwrap().unwrap();
        assert!(snapshot.ssh_groups.is_empty());
        for profile in &snapshot.profiles {
            assert!(profile.get("groupId").is_none(), "groupId must be dropped: {profile}");
        }
        // 其余字段原样保留（仅移除 groupId 键）
        assert_eq!(snapshot.profiles[0]["name"], "web");
        assert_eq!(snapshot.profiles[0]["host"], "h");
    }

    #[test]
    fn local_group_crud_round_trip() {
        let state = temp_state("local-group");
        local_group_create_internal(
            &state,
            &LocalGroupRecord { id: "lg1".into(), name: "zsh".into(), is_default: true },
        )
        .unwrap();
        local_group_create_internal(
            &state,
            &LocalGroupRecord { id: "lg2".into(), name: "工作".into(), is_default: false },
        )
        .unwrap();
        local_group_update_internal(
            &state,
            &LocalGroupRecord { id: "lg1".into(), name: "Zsh".into(), is_default: true },
        )
        .unwrap();

        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.local_groups.len(), 2);
        assert_eq!(snapshot.local_groups[0].name, "Zsh");
        assert!(snapshot.local_groups[0].is_default);
        assert!(!snapshot.local_groups[1].is_default);
        assert!(local_group_update_internal(
            &state,
            &LocalGroupRecord { id: "ghost".into(), name: "x".into(), is_default: false },
        )
        .is_err());

        local_group_delete_internal(&state, "lg1").unwrap();
        local_group_delete_internal(&state, "lg1").unwrap(); // 幂等
        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.local_groups.len(), 1);
        assert_eq!(snapshot.local_groups[0].id, "lg2");
    }

    #[test]
    fn local_group_delete_cascades_ungroup() {
        let state = temp_state("local-group-cascade");
        local_group_create_internal(
            &state,
            &LocalGroupRecord { id: "lg1".into(), name: "zsh".into(), is_default: true },
        )
        .unwrap();
        profile_create_internal(&state, &serde_json::json!({
            "id": "l1", "type": "local", "name": "zsh", "command": "/bin/zsh",
            "isDefault": false, "builtin": true, "groupId": "lg1",
        }))
        .unwrap();
        profile_create_internal(&state, &serde_json::json!({
            "id": "s1", "type": "ssh", "name": "web", "isDefault": false, "groupId": "lg1",
        }))
        .unwrap();

        local_group_delete_internal(&state, "lg1").unwrap();

        let snapshot = load_internal(&state).unwrap().unwrap();
        assert!(snapshot.local_groups.is_empty());
        // local 档案被降级（groupId 键移除），builtin 等其余字段原样保留
        let local = snapshot.profiles.iter().find(|p| p["id"] == "l1").unwrap();
        assert!(local.get("groupId").is_none(), "groupId must be dropped: {local}");
        assert_eq!(local["builtin"], true);
        // ssh 档案的 groupId 不受 local 分组删除影响（分组空间互不相干）
        let ssh = snapshot.profiles.iter().find(|p| p["id"] == "s1").unwrap();
        assert_eq!(ssh["groupId"], "lg1");
    }

    #[test]
    fn color_scheme_upsert_overwrites_same_name() {
        let state = temp_state("schemes");
        color_scheme_save_internal(&state, "solarized", &serde_json::json!({"background": "#000"})).unwrap();
        color_scheme_save_internal(&state, "solarized", &serde_json::json!({"background": "#fff"})).unwrap();
        color_scheme_save_internal(&state, "gruvbox", &serde_json::json!({"background": "#222"})).unwrap();
        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.color_schemes.len(), 2);
        assert_eq!(snapshot.color_schemes[0]["background"], "#fff");
        assert!(color_scheme_save_internal(&state, "", &serde_json::json!({})).is_err());
        color_scheme_delete_internal(&state, "gruvbox").unwrap();
        color_scheme_delete_internal(&state, "gruvbox").unwrap();
        assert_eq!(load_internal(&state).unwrap().unwrap().color_schemes.len(), 1);
    }

    #[test]
    fn hotkey_set_upsert() {
        let state = temp_state("hotkeys");
        hotkey_set_internal(&state, "copy", &serde_json::json!([["⌘-C"]])).unwrap();
        hotkey_set_internal(&state, "copy", &serde_json::json!([["⌘-⇧-C"]])).unwrap();
        hotkey_set_internal(&state, "copy", &serde_json::json!([])).unwrap();
        assert!(hotkey_set_internal(&state, "", &serde_json::json!([])).is_err());
        let snapshot = load_internal(&state).unwrap().unwrap();
        assert_eq!(snapshot.hotkeys.len(), 1);
        assert_eq!(snapshot.hotkeys["copy"], serde_json::json!([]));
    }

    #[test]
    fn legacy_archive_renames_once() {
        let dir = std::env::temp_dir().join(format!("scx-config-legacy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let yaml = dir.join("config.yaml");
        std::fs::write(&yaml, "terminal: {}").unwrap();

        assert!(archive_legacy_yaml_at(&yaml).unwrap());
        assert!(!yaml.exists());
        assert!(dir.join("config.yaml.migrated").exists());
        // 二次归档（已迁移过的库）返回 false 不报错
        assert!(!archive_legacy_yaml_at(&yaml).unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
