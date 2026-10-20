//! @description 文件系统工具命令：路径补全的列目录与 shell history 文件读取、
//!              SFTP 本地栏的目录浏览（含大小/修改时间、隐藏文件开关、错误显式传播），
//!              以及 macOS 应用更新后清除 .app 扩展属性（移除隔离标记，避免「已损坏」提示）。
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

/// 列目录（内部实现，命令函数转发）：错误返回空数组；点文件全量返回，
/// 可见性由前端补全引擎按补全前缀统一决定（本地/SSH 同一规则）
fn fs_list_dir_inner (path: String) -> std::io::Result<Vec<FsDirEntry>> {
    let mut entries = Vec::new();
    // read_dir 失败（不存在/无权限）静默为 Ok(空)——与函数注释和测试契约一致
    let Ok(dir) = std::fs::read_dir(expand_tilde_std(&path)) else {
        return Ok(entries);
    };
    for entry in dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
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

/// 写入文本文件（工作流 YAML 导出用；create/truncate，父目录须存在）
///
/// # Arguments
///
/// * `path` - 目标文件绝对路径（保存对话框选定）
/// * `contents` - UTF-8 文本内容
///
/// # Returns
///
/// Result<(), String>（IO 失败返回错误信息）
///
/// # Examples
///
/// `invoke('fs_write_text_file', { path: '/tmp/wf.yml', contents: '...' })`
#[tauri::command]
pub fn fs_write_text_file (path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("failed to write {path}: {e}"))
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

/// 从可执行文件路径向上找最近的 .app bundle 根（仅 macOS；找不到返回 None，
/// dev / 裸二进制运行时不存在 bundle）
///
/// # Arguments
///
/// * `exe` - 当前可执行文件绝对路径（…/Foo.app/Contents/MacOS/Foo）
#[cfg(target_os = "macos")]
fn nearest_app_bundle (exe: &std::path::Path) -> Option<&std::path::Path> {
    let mut dir = exe.parent();
    while let Some(current) = dir {
        if current.extension().map_or(false, |ext| ext == "app") {
            return Some(current);
        }
        dir = current.parent();
    }
    None
}

/// 递归清除路径的全部扩展属性（/usr/bin/xattr -cr；绝对路径调用，不依赖 GUI 进程的 PATH）
///
/// # Arguments
///
/// * `path` - 目标文件或目录（.app bundle 根）
///
/// # Returns
///
/// Result<(), String>（xattr 不存在/执行失败返回错误信息）
#[cfg(target_os = "macos")]
fn clear_xattr_recursive (path: &std::path::Path) -> Result<(), String> {
    let output = std::process::Command::new("/usr/bin/xattr")
        .arg("-cr")
        .arg(path)
        .output()
        .map_err(|e| format!("spawn xattr failed: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "xattr -cr {} failed: {}",
            path.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

/// 清除当前应用扩展属性（内部实现，命令函数转发）：bundle 根不可得时回退对
/// 可执行文件自身清除；非 macOS 平台为 no-op
#[cfg(target_os = "macos")]
fn clear_app_xattr_inner () -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("resolve current exe failed: {e}"))?;
    clear_xattr_recursive(nearest_app_bundle(&exe).unwrap_or(&exe))
}

/// 清除当前应用扩展属性（内部实现，命令函数转发）：非 macOS 无扩展属性语义，恒 Ok
#[cfg(not(target_os = "macos"))]
fn clear_app_xattr_inner () -> Result<(), String> {
    Ok(())
}

/// 清除当前应用扩展属性：更新安装后、relaunch 前由前端调用，移除 bundle 上
/// com.apple.quarantine 等隔离标记，避免未公证应用被 Gatekeeper 判定「已损坏」；
/// 非 macOS 平台为 no-op
///
/// # Returns
///
/// Result<(), String>（可执行文件路径不可得或 xattr 失败返回错误信息；调用方
/// 收到错误时只记日志、不阻断重启）
///
/// # Examples
///
/// `invoke('clear_app_xattr')`
#[tauri::command]
pub fn clear_app_xattr () -> Result<(), String> {
    clear_app_xattr_inner()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::{Mutex, OnceLock};

    /// HOME 是进程级环境变量，改写它的测试必须持此锁串行（Rust 测试默认并行）
    fn home_lock () -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    /// 临时 HOME 夹具（跨平台）：`.dotfile` + `a.txt` + 空子目录 `dir`
    fn temp_home () -> PathBuf {
        let dir = std::env::temp_dir().join(format!("scx-fsutil-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("dir")).unwrap();
        std::fs::write(dir.join(".dotfile"), "x").unwrap();
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        dir
    }

    /// 持锁把 HOME 切到夹具执行闭包，结束后还原原值
    fn with_fixture_home<T> (f: impl FnOnce(&Path) -> T) -> T {
        let _guard = home_lock().lock().unwrap();
        let original = std::env::var("HOME").ok();
        let home = temp_home();
        std::env::set_var("HOME", &home);
        let result = f(&home);
        if let Some(value) = original {
            std::env::set_var("HOME", value);
        } else {
            std::env::remove_var("HOME");
        }
        result
    }

    #[test]
    fn list_dir_returns_entries_and_tilde_expands () {
        with_fixture_home(|_| {
            let entries = fs_list_dir_inner("~".into()).unwrap();
            assert!(entries.iter().any(|e| e.name == "a.txt" && !e.is_dir));
            assert!(entries.iter().any(|e| e.name == "dir" && e.is_dir));
            // `~/dir` 经 ~ 展开后可列（夹具中为空目录）
            assert!(fs_list_dir_inner("~/dir".into()).unwrap().is_empty());
        });
    }

    #[test]
    fn list_dir_missing_path_returns_empty () {
        let entries = fs_list_dir_inner("/nonexistent-scx-path-xyz".into()).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn list_dir_includes_hidden_entries () {
        // Rust 侧全量返回，可见性由前端补全引擎按前缀决定
        with_fixture_home(|_| {
            let entries = fs_list_dir_inner("~".into()).unwrap();
            assert!(entries.iter().any(|e| e.name == ".dotfile"));
        });
    }

    #[test]
    fn read_text_file_returns_none_for_missing () {
        with_fixture_home(|_| {
            assert!(fs_read_text_file_inner("~/no-such-file-scx.txt".into()).unwrap().is_none());
        });
    }

    #[test]
    fn browse_dir_lists_entries_with_metadata () {
        with_fixture_home(|home| {
            let entries = fs_browse_dir_inner("~".into(), false).unwrap();
            let txt = entries.iter().find(|e| e.name == "a.txt").expect("a.txt entry");
            assert!(!txt.is_dir);
            assert_eq!(txt.path, home.join("a.txt").to_string_lossy().to_string());
            assert_eq!(txt.size, 1);
        });
    }

    #[test]
    fn browse_dir_hidden_toggle () {
        // 开关控制点文件可见性；显隐集只差夹具里的那一个点文件
        with_fixture_home(|_| {
            let visible = fs_browse_dir_inner("~".into(), false).unwrap();
            let all = fs_browse_dir_inner("~".into(), true).unwrap();
            assert!(visible.iter().all(|e| !e.name.starts_with('.')));
            assert!(all.iter().any(|e| e.name == ".dotfile"));
            assert_eq!(all.len(), visible.len() + 1);
        });
    }

    #[test]
    fn browse_dir_missing_path_propagates_error () {
        assert!(fs_browse_dir_inner("/nonexistent-scx-path-xyz".into(), false).is_err());
    }

    /// macOS：可执行文件路径向上定位最近的 .app bundle 根；裸二进制返回 None
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_nearest_app_bundle_resolves_bundle_root () {
        let exe = Path::new("/Applications/scx-terminal.app/Contents/MacOS/scx-terminal");
        assert_eq!(nearest_app_bundle(exe), Some(Path::new("/Applications/scx-terminal.app")));
        // 嵌套场景取最内层 bundle
        let nested = Path::new("/opt/Foo.app/Contents/Bars/Bar.app/Contents/MacOS/Bar");
        assert_eq!(nearest_app_bundle(nested), Some(Path::new("/opt/Foo.app/Contents/Bars/Bar.app")));
        assert_eq!(nearest_app_bundle(Path::new("/usr/local/bin/tool")), None);
    }

    /// macOS：写入 quarantine 后递归清除，属性读取由成功转为失败（已不存在）
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_clear_xattr_removes_quarantine () {
        let file = std::env::temp_dir().join(format!("scx-xattr-test-{}", std::process::id()));
        std::fs::write(&file, "x").unwrap();
        let write = std::process::Command::new("/usr/bin/xattr")
            .args(["-w", "com.apple.quarantine", "0081;60000000;updater;"])
            .arg(&file)
            .output()
            .unwrap();
        assert!(write.status.success(), "fixture xattr write failed");
        clear_xattr_recursive(&file).unwrap();
        let probe = std::process::Command::new("/usr/bin/xattr")
            .args(["-p", "com.apple.quarantine"])
            .arg(&file)
            .output()
            .unwrap();
        assert!(!probe.status.success(), "quarantine should be removed");
        let _ = std::fs::remove_file(&file);
    }
}
