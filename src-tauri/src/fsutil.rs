//! @description 文件系统工具命令：路径补全的列目录与 shell history 文件读取，
//!              以及 SFTP 本地栏的目录浏览（含大小/修改时间、隐藏文件开关、错误显式传播）。
//!              补全命令做 `~` → $HOME 展开（前端不知道 HOME，统一传 ~ 相对路径）；
//!              列目录错误（权限/不存在）返回空数组静默降级，读取文件不存在返回 None，
//!              浏览命令错误显式返回 Err（UI 呈现 banner）。

use serde::Serialize;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// 目录条目（路径补全用；只暴露名称与是否目录）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsDirEntry {
    pub name: String,
    pub is_dir: bool,
}

/// `~` 开头路径展开为 $HOME（其余原样返回）
fn expand_tilde_std (path: &str) -> PathBuf {
    if path == "~" {
        return PathBuf::from(std::env::var("HOME").unwrap_or_default());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        let home = std::env::var("HOME").unwrap_or_default();
        return PathBuf::from(home).join(rest);
    }
    PathBuf::from(path)
}

/// 列目录（内部实现，命令函数转发）：错误返回空数组
fn fs_list_dir_inner (path: String) -> std::io::Result<Vec<FsDirEntry>> {
    let mut entries = Vec::new();
    // read_dir 失败（不存在/无权限）静默为 Ok(空)——与函数注释和测试契约一致
    let Ok(dir) = std::fs::read_dir(expand_tilde_std(&path)) else {
        return Ok(entries);
    };
    for entry in dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue; // 隐藏文件不进补全（与常见 shell 默认一致）
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        entries.push(FsDirEntry { name, is_dir });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// 读取文本文件（内部实现）：不存在返回 Ok(None)，读失败返回 Err
fn fs_read_text_file_inner (path: String) -> std::io::Result<Option<String>> {
    let expanded = expand_tilde_std(&path);
    if !expanded.is_file() {
        return Ok(None);
    }
    Ok(Some(std::fs::read_to_string(expanded)?))
}

/// 浏览条目（SFTP 本地栏展示用；含大小与修改时间）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsBrowseEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub mtime_ms: u64,
}

/// SystemTime → Unix 毫秒（不可得时回退 0）
fn system_time_ms (time: std::io::Result<SystemTime>) -> u64 {
    time.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(0))
        .unwrap_or(0)
}

/// 目录浏览（内部实现）：错误显式传播（不存在/无权限返回 Err）
fn fs_browse_dir_inner (path: String, show_hidden: bool) -> std::io::Result<Vec<FsBrowseEntry>> {
    let root = expand_tilde_std(&path);
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&root)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !show_hidden && name.starts_with('.') {
            continue;
        }
        let file_type = entry.file_type()?;
        let path = entry.path();
        // 大小/修改时间跟随 symlink（失效链接回退 lstat 元数据）
        let meta = std::fs::metadata(&path).or_else(|_| entry.metadata())?;
        entries.push(FsBrowseEntry {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
            is_symlink: file_type.is_symlink(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            mtime_ms: system_time_ms(meta.modified()),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// 路径补全列目录（错误静默为空数组——前端把空当"无建议"处理）
#[tauri::command]
pub fn fs_list_dir (path: String) -> Vec<FsDirEntry> {
    fs_list_dir_inner(path).unwrap_or_default()
}

/// 读取文本文件内容（shell history 导入用）
#[tauri::command]
pub fn fs_read_text_file (path: String) -> Result<Option<String>, String> {
    fs_read_text_file_inner(path).map_err(|e| e.to_string())
}

/// 目录浏览（SFTP 本地栏）：含大小/修改时间；错误显式返回（UI 呈现 banner）
///
/// # Arguments
///
/// * `path` - 本地目录绝对路径（支持 ~ 展开）
/// * `show_hidden` - 是否包含隐藏文件（`.` 开头）
///
/// # Returns
///
/// Vec<FsBrowseEntry>（目录在前、名称不区分大小写升序）
///
/// # Examples
///
/// `invoke('fs_browse_dir', { path: '~', showHidden: false })`
#[tauri::command]
pub fn fs_browse_dir (path: String, show_hidden: bool) -> Result<Vec<FsBrowseEntry>, String> {
    fs_browse_dir_inner(path, show_hidden).map_err(|e| e.to_string())
}

/// 本地用户主目录（SFTP 本地栏初始路径；前端不知道 $HOME）
///
/// # Returns
///
/// String 主目录绝对路径（不可得时回退 /）
///
/// # Examples
///
/// `invoke('fs_home_dir')`
#[tauri::command]
pub fn fs_home_dir () -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_dir_returns_entries_and_tilde_expands () {
        let entries = fs_list_dir_inner("~/Library".into()).unwrap();
        assert!(entries.iter().any(|e| e.name == "Fonts"));
    }

    #[test]
    fn list_dir_missing_path_returns_empty () {
        let entries = fs_list_dir_inner("/nonexistent-scx-path-xyz".into()).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn read_text_file_returns_none_for_missing () {
        assert!(fs_read_text_file_inner("~/no-such-file-scx.txt".into()).unwrap().is_none());
    }

    #[test]
    fn browse_dir_lists_entries_with_metadata () {
        let entries = fs_browse_dir_inner("~/Library".into(), false).unwrap();
        let fonts = entries.iter().find(|e| e.name == "Fonts").expect("Fonts entry");
        assert!(fonts.is_dir);
        assert_eq!(fonts.path, format!("{}/Library/Fonts", std::env::var("HOME").unwrap()));
    }

    #[test]
    fn browse_dir_hidden_toggle () {
        // $HOME 下普遍存在点文件（.zshrc 等）：开关控制其可见性
        let visible = fs_browse_dir_inner("~".into(), false).unwrap();
        let all = fs_browse_dir_inner("~".into(), true).unwrap();
        assert!(visible.iter().all(|e| !e.name.starts_with('.')));
        assert!(all.len() >= visible.len());
    }

    #[test]
    fn browse_dir_missing_path_propagates_error () {
        assert!(fs_browse_dir_inner("/nonexistent-scx-path-xyz".into(), false).is_err());
    }
}
