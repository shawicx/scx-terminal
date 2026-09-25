//! @description 配置备份：本地 JSON 快照的导出/导入。
//! 快照 = config.db 纳入实体（settings/hotkeys/profiles/colorSchemes/quickCommands/
//! quickCommandGroups/sshGroups）的行级全量 + secrets.db 凭据明文经用户口令
//! Argon2id 派生密钥 AES-256-GCM 包裹后的密文段。主密钥（系统钥匙串）全程不出本机；
//! 导入为全量替换语义：预校验全部通过后才写库，先 secrets 后 config，各库单事务。
//!
//! 模块拆分：model（快照类型契约）/ crypto（口令包裹）/ rows（行级读写）；
//! 快照组装/校验应用与 Tauri 命令留在本模块。

mod crypto;
mod model;
mod rows;

#[cfg(test)]
mod tests;

use std::path::Path;

use tauri::State;

use crate::config::ConfigState;
use crate::secrets::{export_all, replace_all, SecretsPlain, SecretsState};

use crypto::{unwrap_secrets, wrap_secrets};
use model::{BackupSnapshot, ExportSummary, BACKUP_FORMAT, BACKUP_VERSION};
use rows::{read_config_rows, validate_backup_rows, write_config_rows};

/// 组装完整快照（云端 push 与本地导出共用）：读两库 → 口令包裹 secrets 段
///
/// # Arguments
///
/// * `config` - 配置库状态
/// * `secrets` - 加密存储状态
/// * `passphrase` - 用户口令（非空）
/// * `app_version` - 应用版本号（写入信封）
///
/// # Returns
///
/// (快照, 导出摘要)——摘要需在包裹前统计（密文段不可回推条数）
pub(crate) fn build_snapshot(
    config: &ConfigState,
    secrets: &SecretsState,
    passphrase: &str,
    app_version: &str,
) -> Result<(BackupSnapshot, ExportSummary), String> {
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
    Ok((snapshot, summary))
}

/// 校验并应用快照（云端 pull 与本地导入共用）：信封/版本/行身份键 → 解包 → 先 secrets 后 config 替换
pub(crate) fn parse_and_apply(
    config: &ConfigState,
    secrets: &SecretsState,
    raw: &str,
    passphrase: &str,
) -> Result<(), String> {
    if passphrase.trim().is_empty() {
        return Err("passphrase must not be empty".to_string());
    }
    let doc: BackupSnapshot =
        serde_json::from_str(raw).map_err(|_| "invalid backup file: not JSON".to_string())?;
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

/// 导出：组装快照 → 写入 path
pub(crate) fn export_internal(
    config: &ConfigState,
    secrets: &SecretsState,
    path: &Path,
    passphrase: &str,
    app_version: &str,
) -> Result<ExportSummary, String> {
    let (snapshot, summary) = build_snapshot(config, secrets, passphrase, app_version)?;
    let json = serde_json::to_string_pretty(&snapshot).map_err(|e| format!("failed to serialize backup: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("failed to write backup file: {e}"))?;
    Ok(summary)
}

/// 导入：读文件 → 校验并应用（见 parse_and_apply）
pub(crate) fn import_internal(
    config: &ConfigState,
    secrets: &SecretsState,
    path: &Path,
    passphrase: &str,
) -> Result<(), String> {
    let raw = std::fs::read_to_string(path).map_err(|e| format!("failed to read backup file: {e}"))?;
    parse_and_apply(config, secrets, &raw, passphrase)
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
