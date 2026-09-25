//! @description 敏感数据加密存储：SQLite（secrets.db）+ AES-256-GCM 字段级加密。
//! 主密钥随机生成存 macOS 钥匙串（keyring，service `scx-terminal`/user `master-key`），
//! 密文格式 = 12 字节随机 nonce 前置 + 密文（含 GCM tag）。
//! 存储范围：SSH 密钥链（私钥/口令加密，元数据明文）、SSH 档案密码（按 profileId）、
//! 云端同步配置的 secretKey。
//!
//! 模块拆分：crypto（主密钥与字段加解密）/ keys（密钥链 CRUD 与解析）/ creds（档案密码）/
//! backup（明文导出/导入）/ sync（S3 同步配置）。`#[tauri::command]` 的
//! `__tauri_command_name_*` 宏留在定义模块，lib.rs 按 `secrets::keys::xxx` 完整路径引用。

mod backup;
pub(crate) mod creds;
mod crypto;
pub(crate) mod keys;
mod sync;

use std::path::Path;
use std::sync::Mutex;

use aes_gcm::Aes256Gcm;
use aes_gcm::KeyInit;
use rusqlite::Connection;
use serde::Serialize;

pub use backup::{export_all, replace_all, SecretsPlain};
pub use creds::load_password;
pub use keys::load_private_key;
pub use sync::{s3_sync_forget, s3_sync_load, s3_sync_store, S3SyncConfig};

// 仅 s3sync 单测构造导入明文集合时按名引用
#[cfg(test)]
pub use backup::{CredPlain, KeyPlain};

const KEYCHAIN_SERVICE: &str = "scx-terminal";
const KEYCHAIN_USER: &str = "master-key";

const SCHEMA_SQL: &str = "CREATE TABLE IF NOT EXISTS ssh_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    public_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    private_key_enc BLOB NOT NULL,
    passphrase_enc BLOB,
    comment TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ssh_credentials (
    profile_id TEXT PRIMARY KEY,
    password_enc BLOB NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS s3_sync (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    endpoint TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'us-east-1',
    bucket TEXT NOT NULL,
    path_style INTEGER NOT NULL DEFAULT 1,
    access_key TEXT NOT NULL,
    secret_key_enc BLOB NOT NULL
);";

/// 打开/建库并初始化 schema
fn open_db(dir: &Path) -> Connection {
    std::fs::create_dir_all(dir).expect("failed to create app data dir");
    let conn = Connection::open(dir.join("secrets.db")).expect("failed to open secrets.db");
    conn.execute_batch(SCHEMA_SQL).expect("failed to init secrets schema");
    conn
}

/// 密钥链条目元数据（私钥本体不出库）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyMeta {
    pub id: String,
    pub name: String,
    pub algorithm: String,
    pub public_key: String,
    pub fingerprint: String,
    pub comment: String,
    pub created_at: i64,
    pub has_passphrase: bool,
}

/// 密钥库状态：SQLite 连接 + 主密钥派生的 AES-256-GCM 实例
pub struct SecretsState {
    conn: Mutex<Connection>,
    cipher: Aes256Gcm,
}

impl SecretsState {
    /// 打开/建库并初始化主密钥；失败直接 panic（无加密库则敏感功能全不可用）
    pub fn new(dir: &Path) -> Self {
        let conn = open_db(dir);
        let master = crypto::load_or_create_master_key().expect("failed to load master key");
        let cipher = Aes256Gcm::new((&master).into());
        Self { conn: Mutex::new(conn), cipher }
    }

    /// 测试构造：注入主密钥，绕过系统钥匙串——单测不得依赖/触发钥匙串授权弹窗
    #[cfg(test)]
    pub fn with_master_key(dir: &Path, master: [u8; 32]) -> Self {
        let conn = open_db(dir);
        let cipher = Aes256Gcm::new((&master).into());
        Self { conn: Mutex::new(conn), cipher }
    }

    /// 域内读取连接（锁语义与原单文件一致）
    pub(super) fn lock_conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }

    /// 域内取 AES 实例（字段加解密用）
    pub(super) fn cipher(&self) -> &Aes256Gcm {
        &self.cipher
    }
}

/// 测试用：随机主密钥构造（不同实例即不同「机器」，天然覆盖跨机迁移路径）
#[cfg(test)]
pub(crate) fn test_state(dir: &Path) -> SecretsState {
    let mut key = [0u8; 32];
    getrandom::fill(&mut key).expect("random generation failed");
    SecretsState::with_master_key(dir, key)
}

/// 毫秒级时间戳（keys/creds/backup 写入 created_at/updated_at 共用）
pub(super) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests;
