//! @description 旧版 config.yaml 一次性迁移：读取原文（前端解析入库）后改名归档
//! （config.yaml.migrated 作为迁移完成标记 + 天然备份）。

use std::path::{Path, PathBuf};

use tauri::Manager;

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
pub(super) fn archive_legacy_yaml_at(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let mut target = path.to_path_buf();
    target.set_file_name("config.yaml.migrated");
    std::fs::rename(path, target).map_err(|e| format!("could not archive {}: {e}", path.display()))?;
    Ok(true)
}

///
/// @description 读取旧版 config.yaml 原文；文件不存在返回 None
/// @param app 应用句柄
/// @returns Result<Option<String>, String> yaml 原文
///
#[tauri::command]
pub fn config_load_legacy_yaml(app: tauri::AppHandle) -> Result<Option<String>, String> {
    match std::fs::read_to_string(legacy_config_path(&app)) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("could not read legacy config.yaml: {e}")),
    }
}

///
/// @description 旧 config.yaml 改名归档（config.yaml.migrated）
/// @param app 应用句柄
/// @returns Result<bool, String> 是否执行了改名
///
#[tauri::command]
pub fn config_archive_legacy_yaml(app: tauri::AppHandle) -> Result<bool, String> {
    archive_legacy_yaml_at(&legacy_config_path(&app))
}
