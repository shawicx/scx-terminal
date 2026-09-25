//! 备份快照类型契约：KDF 参数、凭据密文段、config.db 行级备份行与文件信封根结构
//!（与备份 JSON 的 camelCase 字段一一对应）。

use serde::{Deserialize, Serialize};

/// 快照格式标识（文件信封字段 format 的固定值）
pub const BACKUP_FORMAT: &str = "scx-terminal-backup";
/// 快照格式版本（不识别即拒绝导入）
pub const BACKUP_VERSION: i64 = 1;
/// 导出纳入的 settings 分片（recents/tabSession 为机器本地数据，排除）
pub(super) const BACKUP_SETTINGS_KEYS: [&str; 3] = ["terminal", "appearance", "advanced"];

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

/// 本地档案分组备份行（多 is_default 列：系统默认分组标记随备份往返）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalGroupRow {
    pub id: String,
    pub name: String,
    pub is_default: bool,
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
    /// 本地档案分组（v1 后期新增；default 使旧备份缺字段仍可导入）
    #[serde(default)]
    pub local_groups: Vec<LocalGroupRow>,
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
