//! @description 配置记录类型与全量快照：与前端共享形状的 serde 结构体
//! （分组/快捷命令等字段稳定用真实列，档案与配色经 data JSON 重建，见 state.rs 注释）。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

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
