//! @description 应用配置持久化：SQLite（config.db）实体级 CRUD。
//! 前端拥有配置形状（类型 + 默认值 + 合并），Rust 只负责可靠存储——沿用与
//! secrets.db 相同的「Mutex 单连接 + 同步命令」模式。表结构经 PRAGMA user_version
//! 迁移；档案/自定义配色用「身份/排序列 + data JSON」混合存储（形状随前端演进），
//! 快捷命令与分组字段稳定，用真实列。旧 config.yaml 仅用于一次性迁移（读取后改名归档）。
//!
//! 模块拆分：model（记录类型与快照）/ state（连接、迁移、meta 与提取工具）/ load（聚合读取）/
//! settings·profiles·quick_commands·groups（分域写入与命令）/ legacy（旧 yaml 迁移）。
//! 注意：#[tauri::command] 生成的 `__tauri_command_name_*` 宏留在定义模块，
//! lib.rs 的 invoke_handler 需按完整模块路径引用（如 config::settings::hotkey_set）；
//! 前端 invoke 命令名与函数名一致，不受路径影响。

pub(crate) mod groups;
pub(crate) mod legacy;
pub(crate) mod load;
mod model;
pub(crate) mod profiles;
pub(crate) mod quick_commands;
pub(crate) mod settings;
mod state;
#[cfg(test)]
mod tests;

pub use state::ConfigState;

pub(crate) use state::{mark_initialized, meta_get, meta_set};

/// settings 表分片白名单（load 聚合读取与 settings 写入校验共用）
pub(super) const SETTINGS_KEYS: [&str; 5] = ["terminal", "appearance", "advanced", "recents", "monitor"];

///
/// @description 暴露配置库所在目录（设置页展示/在 Finder 打开；config.db 与 secrets.db 同目录）
/// @param app 应用句柄
/// @returns Result<String, String> 配置库目录绝对路径
///
#[tauri::command]
pub fn config_dir_path(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}
