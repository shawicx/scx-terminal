//! @description 配置备份：本地 JSON 快照的导出/导入。
//! 快照 = config.db 纳入实体（settings/hotkeys/profiles/colorSchemes/quickCommands/
//! quickCommandGroups/sshGroups）的行级全量 + secrets.db 凭据明文经用户口令
//! Argon2id 派生密钥 AES-256-GCM 包裹后的密文段。主密钥（系统钥匙串）全程不出本机；
//! 导入为全量替换语义：预校验全部通过后才写库，先 secrets 后 config，各库单事务。

use std::path::Path;

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::config::{mark_initialized, ConfigState};
use crate::secrets::{export_all, replace_all, SecretsPlain, SecretsState};

/// 快照格式标识（文件信封字段 format 的固定值）
pub const BACKUP_FORMAT: &str = "scx-terminal-backup";
/// 快照格式版本（不识别即拒绝导入）
pub const BACKUP_VERSION: i64 = 1;
/// 导出纳入的 settings 分片（recents/tabSession 为机器本地数据，排除）
const BACKUP_SETTINGS_KEYS: [&str; 3] = ["terminal", "appearance", "advanced"];
/// Argon2id 内存成本（KiB，OWASP 推荐档）
const KDF_M_KIB: u32 = 19456;
/// Argon2id 时间成本
const KDF_T: u32 = 2;
/// Argon2id 并行度
const KDF_P: u32 = 1;
/// KDF 盐长度（字节）
const SALT_LEN: usize = 16;
/// AES-GCM nonce 长度（字节）
const NONCE_LEN: usize = 12;

/// KDF 参数（随快照明文携带，导入端按同参数重派生）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KdfParams {
    /// 固定 "argon2id"
    pub algo: String,
    /// 随机盐（b64，16 字节）
    pub salt: String,
    /// 内存成本（KiB，OWASP 推荐档 19456）
    pub m: u32,
    /// 时间成本（2）
    pub t: u32,
    /// 并行度（1）
    pub p: u32,
}

/// 凭据密文段：口令派生密钥加密后的 secrets 明文 JSON
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSecrets {
    pub kdf: KdfParams,
    /// AES-256-GCM nonce（b64，12 字节）
    pub nonce: String,
    /// 密文（b64，含 GCM tag）
    pub ciphertext: String,
}

/// profiles 备份行（data JSON + 排序列，保序回写）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRow {
    pub sort_order: i64,
    pub data: serde_json::Value,
}

/// color_schemes 备份行（name 为身份列）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorSchemeRow {
    pub name: String,
    pub sort_order: i64,
    pub data: serde_json::Value,
}

/// quick_commands 备份行（真实列存储）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickCommandRow {
    pub id: String,
    pub group_id: Option<String>,
    pub name: String,
    pub command: String,
    pub auto_run: bool,
    pub sort_order: i64,
}

/// 快捷命令分组 / SSH 分组备份行（同构：id + name + 排序列）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupRow {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
}

/// config.db 纳入实体的行级全量
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupConfig {
    pub settings: std::collections::BTreeMap<String, serde_json::Value>,
    pub hotkeys: std::collections::BTreeMap<String, serde_json::Value>,
    pub profiles: Vec<ProfileRow>,
    pub color_schemes: Vec<ColorSchemeRow>,
    pub quick_commands: Vec<QuickCommandRow>,
    pub quick_command_groups: Vec<GroupRow>,
    pub ssh_groups: Vec<GroupRow>,
}

/// 备份快照文件根结构
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSnapshot {
    pub format: String,
    pub version: i64,
    pub exported_at: i64,
    pub app_version: String,
    pub config: BackupConfig,
    pub secrets: BackupSecrets,
}

/// 导出结果摘要（前端成功提示展示规模）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub profile_count: usize,
    pub quick_command_count: usize,
    pub ssh_key_count: usize,
}

/// 口令派生 32 字节密钥（参数随快照携带，导入端按同参数重派生）
fn derive_key(passphrase: &str, kdf: &KdfParams) -> Result<[u8; 32], String> {
    if kdf.algo != "argon2id" {
        return Err("invalid backup file: unsupported kdf algorithm".to_string());
    }
    let salt = B64
        .decode(kdf.salt.as_bytes())
        .map_err(|_| "invalid backup file: bad kdf salt".to_string())?;
    let params =
        Params::new(kdf.m, kdf.t, kdf.p, Some(32)).map_err(|e| format!("invalid backup file: bad kdf params: {e}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon
        .hash_password_into(passphrase.as_bytes(), &salt, &mut key)
        .map_err(|_| "invalid backup file: kdf failed".to_string())?;
    Ok(key)
}

/// 用口令包裹 secrets 明文 JSON：Argon2id 派生 32 字节密钥 → AES-256-GCM（nonce 随机）
pub(crate) fn wrap_secrets(plaintext_json: &str, passphrase: &str) -> Result<BackupSecrets, String> {
    let mut salt = [0u8; SALT_LEN];
    getrandom::fill(&mut salt).map_err(|e| format!("random generation failed: {e}"))?;
    let kdf =
        KdfParams { algo: "argon2id".into(), salt: B64.encode(salt), m: KDF_M_KIB, t: KDF_T, p: KDF_P };
    let key = derive_key(passphrase, &kdf)?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce_bytes).map_err(|e| format!("random generation failed: {e}"))?;
    let cipher = Aes256Gcm::new((&key).into());
    let nonce = Nonce::try_from(nonce_bytes.as_slice()).map_err(|_| "encryption failed".to_string())?;
    let ciphertext = cipher
        .encrypt(&nonce, plaintext_json.as_bytes())
        .map_err(|_| "encryption failed".to_string())?;
    Ok(BackupSecrets { kdf, nonce: B64.encode(nonce_bytes), ciphertext: B64.encode(ciphertext) })
}

/// 解包 secrets 密文段；口令错误与文件损坏统一报错（不区分，防探测）
pub(crate) fn unwrap_secrets(secrets: &BackupSecrets, passphrase: &str) -> Result<String, String> {
    let key = derive_key(passphrase, &secrets.kdf)?;
    let nonce_bytes = B64
        .decode(secrets.nonce.as_bytes())
        .map_err(|_| "invalid backup file: bad nonce".to_string())?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err("invalid backup file: bad nonce".to_string());
    }
    let ciphertext = B64
        .decode(secrets.ciphertext.as_bytes())
        .map_err(|_| "invalid backup file: bad ciphertext".to_string())?;
    let cipher = Aes256Gcm::new((&key).into());
    let nonce = Nonce::try_from(nonce_bytes.as_slice())
        .map_err(|_| "invalid backup file: bad nonce".to_string())?;
    let plain = cipher
        .decrypt(&nonce, ciphertext.as_slice())
        .map_err(|_| "口令错误或文件损坏".to_string())?;
    String::from_utf8(plain).map_err(|_| "口令错误或文件损坏".to_string())
}

/// 行级读取 config.db 纳入实体（保排序；settings 只取备份白名单键）
fn read_config_rows(config: &ConfigState) -> Result<BackupConfig, String> {
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
fn validate_backup_rows(rows: &BackupConfig) -> Result<(), String> {
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
    Ok(())
}

/// 全量替换写回 config.db 纳入表（单事务；settings 仅覆盖备份白名单键，保留 tabSession 等本机键）
fn write_config_rows(config: &ConfigState, rows: &BackupConfig) -> Result<(), String> {
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

/// 导出：读两库 → 组装快照 → 口令包裹 secrets → 写入 path
pub(crate) fn export_internal(
    config: &ConfigState,
    secrets: &SecretsState,
    path: &Path,
    passphrase: &str,
    app_version: &str,
) -> Result<ExportSummary, String> {
    if passphrase.trim().is_empty() {
        return Err("passphrase must not be empty".to_string());
    }
    let backup_config = read_config_rows(config)?;
    let plain = export_all(secrets)?;
    let summary = ExportSummary {
        profile_count: backup_config.profiles.len(),
        quick_command_count: backup_config.quick_commands.len(),
        ssh_key_count: plain.ssh_keys.len(),
    };
    let plain_json = serde_json::to_string(&plain).map_err(|e| format!("failed to serialize secrets: {e}"))?;
    let snapshot = BackupSnapshot {
        format: BACKUP_FORMAT.to_string(),
        version: BACKUP_VERSION,
        exported_at: chrono::Utc::now().timestamp_millis(),
        app_version: app_version.to_string(),
        config: backup_config,
        secrets: wrap_secrets(&plain_json, passphrase)?,
    };
    let json = serde_json::to_string_pretty(&snapshot).map_err(|e| format!("failed to serialize backup: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("failed to write backup file: {e}"))?;
    Ok(summary)
}

/// 导入：读文件 → 校验信封/版本/行身份键 → 解包 secrets → 全部通过后先 secrets 后 config 全量替换写库
pub(crate) fn import_internal(
    config: &ConfigState,
    secrets: &SecretsState,
    path: &Path,
    passphrase: &str,
) -> Result<(), String> {
    if passphrase.trim().is_empty() {
        return Err("passphrase must not be empty".to_string());
    }
    let raw = std::fs::read_to_string(path).map_err(|e| format!("failed to read backup file: {e}"))?;
    let doc: BackupSnapshot =
        serde_json::from_str(&raw).map_err(|_| "invalid backup file: not JSON".to_string())?;
    if doc.format != BACKUP_FORMAT {
        return Err("invalid backup file: unknown format".to_string());
    }
    if doc.version != BACKUP_VERSION {
        return Err(format!("unsupported backup version: {} (expected {})", doc.version, BACKUP_VERSION));
    }
    validate_backup_rows(&doc.config)?;
    let plain_json = unwrap_secrets(&doc.secrets, passphrase)?;
    let plain: SecretsPlain =
        serde_json::from_str(&plain_json).map_err(|_| "invalid backup file: bad secrets payload".to_string())?;
    replace_all(secrets, &plain)?;
    write_config_rows(config, &doc.config)?;
    Ok(())
}

/// 导出配置备份到本地文件（见 export_internal）
///
/// # Arguments
///
/// * `app` - 应用句柄（读取版本号）
/// * `config` - 配置库状态
/// * `secrets` - 加密存储状态
/// * `path` - 目标文件绝对路径（前端保存对话框选定）
/// * `passphrase` - 用户口令
///
/// # Returns
///
/// 导出摘要
///
/// # Examples
///
/// `invoke('config_export', { path, passphrase })`
#[tauri::command]
pub fn config_export(
    app: tauri::AppHandle,
    config: State<'_, ConfigState>,
    secrets: State<'_, SecretsState>,
    path: String,
    passphrase: String,
) -> Result<ExportSummary, String> {
    export_internal(&config, &secrets, Path::new(&path), &passphrase, &app.package_info().version.to_string())
}

/// 从本地文件导入配置备份（见 import_internal）
///
/// # Arguments
///
/// * `config` - 配置库状态
/// * `secrets` - 加密存储状态
/// * `path` - 备份文件绝对路径（前端文件选择框选定）
/// * `passphrase` - 导出时设定的口令
///
/// # Examples
///
/// `invoke('config_import', { path, passphrase })`
#[tauri::command]
pub fn config_import(
    config: State<'_, ConfigState>,
    secrets: State<'_, SecretsState>,
    path: String,
    passphrase: String,
) -> Result<(), String> {
    import_internal(&config, &secrets, Path::new(&path), &passphrase)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::load_internal;
    use crate::secrets::{
        load_password, load_private_key, replace_all, CredPlain, KeyPlain, SecretsPlain,
    };
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    static SEQ: AtomicU32 = AtomicU32::new(0);

    /// 唯一临时目录（tag + pid + 自增序号，避免同进程测试互撞）
    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "scx-snapshot-test-{tag}-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 机器 A 的 config.db 种子数据（覆盖全部纳入实体 + 应被排除的 recents）
    fn seed_config(state: &ConfigState) {
        state.lock_conn().execute_batch(
            r##"INSERT INTO settings (key, value) VALUES
                ('terminal', '{"fontSize":14}'),
                ('advanced', '{"debugLog":true}'),
                ('recents', '{"hosts":["should-not-export"]}');
            INSERT INTO hotkeys (action, bindings) VALUES ('command-palette', '["Ctrl+P"]');
            INSERT INTO profiles (id, type, name, is_default, sort_order, data) VALUES
                ('p-ssh', 'ssh', 'srv1', 0, 0, '{"id":"p-ssh","type":"ssh","name":"srv1","host":"1.2.3.4","keyId":"k1"}'),
                ('p-local', 'local', 'zsh', 1, 1, '{"id":"p-local","type":"local","name":"zsh"}');
            INSERT INTO color_schemes (name, sort_order, data) VALUES ('mine', 0, '{"background":"#0f0f0f"}');
            INSERT INTO quick_command_groups (id, name, sort_order) VALUES ('g1', 'ops', 0);
            INSERT INTO quick_commands (id, group_id, name, command, auto_run, sort_order)
                VALUES ('q1', 'g1', 'df', 'df -h', 1, 0);
            INSERT INTO ssh_groups (id, name, sort_order) VALUES ('sg1', 'prod', 0);
            INSERT INTO meta (key, value) VALUES ('initialized', '1');"##,
        ).unwrap();
    }

    /// 生成一把真实 ed25519 私钥 PEM（与 secrets.rs 测试同源方式）
    fn test_pem() -> String {
        let key = russh::keys::ssh_key::PrivateKey::random(
            &mut russh::keys::key::safe_rng(),
            russh::keys::ssh_key::Algorithm::Ed25519,
        )
        .unwrap();
        key.to_openssh(russh::keys::ssh_key::LineEnding::LF).unwrap().to_string()
    }

    /// 机器 A 的 secrets.db 种子数据（1 把带口令私钥 + 1 条档案密码）
    fn seed_secrets(state: &SecretsState, pem: &str) {
        replace_all(
            state,
            &SecretsPlain {
                ssh_keys: vec![KeyPlain {
                    id: "k1".into(),
                    name: "backup key".into(),
                    algorithm: "ed25519".into(),
                    public_key: "ssh-ed25519 AAAAtest".into(),
                    fingerprint: "SHA256:test".into(),
                    comment: String::new(),
                    created_at: 42,
                    private_key_pem: pem.to_string(),
                    passphrase: Some("keypass".into()),
                }],
                ssh_credentials: vec![CredPlain {
                    profile_id: "p-ssh".into(),
                    password: "hunter2".into(),
                }],
            },
        )
        .unwrap();
    }

    #[test]
    fn secrets_wrap_round_trip_wrong_passphrase_and_tamper_fail() {
        let wrapped = wrap_secrets(r#"{"a":1}"#, "pass123").unwrap();
        assert_eq!(unwrap_secrets(&wrapped, "pass123").unwrap(), r#"{"a":1}"#);

        let err = unwrap_secrets(&wrapped, "wrong-pass").unwrap_err();
        assert!(err.contains("口令错误或文件损坏"), "unexpected error: {err}");

        // 篡改：换入另一段合法 b64 密文（nonce 不同 → GCM tag 校验失败）
        let other = wrap_secrets(r#"{"a":1}"#, "pass123").unwrap();
        let tampered = BackupSecrets { ciphertext: other.ciphertext, ..wrapped.clone() };
        let err = unwrap_secrets(&tampered, "pass123").unwrap_err();
        assert!(err.contains("口令错误或文件损坏"), "unexpected error: {err}");
    }

    #[test]
    fn export_import_round_trip_across_machines() {
        // 机器 A：种子 + 导出
        let dir_a = temp_dir("a");
        let config_a = ConfigState::new(&dir_a);
        let secrets_a = SecretsState::new(&dir_a);
        seed_config(&config_a);
        let pem = test_pem();
        seed_secrets(&secrets_a, &pem);

        let file = dir_a.join("backup.json");
        let summary = export_internal(&config_a, &secrets_a, &file, "pass123", "0.1.6-test").unwrap();
        assert_eq!(summary.profile_count, 2);
        assert_eq!(summary.quick_command_count, 1);
        assert_eq!(summary.ssh_key_count, 1);

        // 文件层：信封正确，明文痕迹不得出现
        let raw = std::fs::read_to_string(&file).unwrap();
        let doc: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(doc["format"], BACKUP_FORMAT);
        assert_eq!(doc["version"], BACKUP_VERSION);
        assert!(!raw.contains("hunter2"));
        assert!(!raw.contains("PRIVATE KEY"));

        // 机器 B：全新状态导入（不同主密钥）
        let dir_b = temp_dir("b");
        let config_b = ConfigState::new(&dir_b);
        let secrets_b = SecretsState::new(&dir_b);
        import_internal(&config_b, &secrets_b, &file, "pass123").unwrap();

        let snapshot = load_internal(&config_b).unwrap().expect("imported config must be initialized");
        assert_eq!(snapshot.terminal, Some(serde_json::json!({"fontSize": 14})));
        assert_eq!(snapshot.advanced.as_ref().unwrap()["debugLog"], true);
        assert!(snapshot.recents.is_none(), "recents must not travel with backup");
        assert_eq!(snapshot.profiles.len(), 2);
        assert_eq!(snapshot.profiles[0]["host"], "1.2.3.4", "sort_order must be preserved");
        assert_eq!(snapshot.profiles[1]["name"], "zsh");
        assert_eq!(snapshot.quick_commands.len(), 1);
        assert_eq!(snapshot.quick_commands[0].id, "q1");
        assert!(snapshot.quick_commands[0].auto_run);
        assert_eq!(snapshot.quick_commands[0].group_id.as_deref(), Some("g1"));
        assert_eq!(snapshot.quick_command_groups.len(), 1);
        assert_eq!(snapshot.quick_command_groups[0].name, "ops");
        assert_eq!(snapshot.ssh_groups.len(), 1);
        assert_eq!(snapshot.ssh_groups[0].name, "prod");

        // B 机凭据：用 B 自己的主密钥可解回明文
        let loaded = load_private_key(&secrets_b, "k1").unwrap();
        assert_eq!(loaded.private_key_pem, pem);
        assert_eq!(loaded.passphrase.as_deref(), Some("keypass"));
        assert_eq!(load_password(&secrets_b, "p-ssh").unwrap().as_deref(), Some("hunter2"));
    }

    #[test]
    fn import_rejects_unknown_version_without_touching_target() {
        let dir_a = temp_dir("a");
        let config_a = ConfigState::new(&dir_a);
        let secrets_a = SecretsState::new(&dir_a);
        seed_config(&config_a);
        let pem = test_pem();
        seed_secrets(&secrets_a, &pem);
        let file = dir_a.join("backup.json");
        export_internal(&config_a, &secrets_a, &file, "pass123", "0.1.6-test").unwrap();

        let mut doc: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        doc["version"] = serde_json::json!(99);
        let bad = dir_a.join("bad-version.json");
        std::fs::write(&bad, doc.to_string()).unwrap();

        let dir_b = temp_dir("b");
        let config_b = ConfigState::new(&dir_b);
        let secrets_b = SecretsState::new(&dir_b);
        let err = import_internal(&config_b, &secrets_b, &bad, "pass123").unwrap_err();
        assert!(err.contains("unsupported backup version"), "unexpected error: {err}");
        assert!(
            load_internal(&config_b).unwrap().is_none(),
            "rejected import must not touch target config"
        );
        assert!(
            load_password(&secrets_b, "p-ssh").unwrap().is_none(),
            "rejected import must not touch target secrets"
        );
    }

    #[test]
    fn import_rejects_corrupted_json_without_touching_target() {
        let dir_a = temp_dir("a");
        let bad = dir_a.join("corrupted.json");
        std::fs::write(&bad, "not-json{{{").unwrap();

        let dir_b = temp_dir("b");
        let config_b = ConfigState::new(&dir_b);
        let secrets_b = SecretsState::new(&dir_b);
        let err = import_internal(&config_b, &secrets_b, &bad, "pass123").unwrap_err();
        assert!(err.contains("invalid backup file"), "unexpected error: {err}");
        assert!(load_internal(&config_b).unwrap().is_none());
    }

    #[test]
    fn import_snapshot_with_empty_secrets_succeeds() {
        let dir_a = temp_dir("a");
        let config_a = ConfigState::new(&dir_a);
        let secrets_a = SecretsState::new(&dir_a);
        let file = dir_a.join("empty.json");
        export_internal(&config_a, &secrets_a, &file, "pass123", "0.1.6-test").unwrap();

        let dir_b = temp_dir("b");
        let config_b = ConfigState::new(&dir_b);
        let secrets_b = SecretsState::new(&dir_b);
        import_internal(&config_b, &secrets_b, &file, "pass123").unwrap();

        let snapshot = load_internal(&config_b).unwrap().expect("empty import still initializes");
        assert!(snapshot.profiles.is_empty());
        assert!(snapshot.quick_commands.is_empty());
        assert!(load_password(&secrets_b, "any").unwrap().is_none());
    }
}
