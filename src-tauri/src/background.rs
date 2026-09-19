//! @description 终端背景图片管理：设置（校验后复制进 app_data_dir/backgrounds/，
//!              覆盖式单张）与读取（bytes 回传前端转 blob URL）。无状态——每次从
//!              AppHandle 解析路径；文件缺失/未设置静默返回 None（前端降级为无图）。

use std::path::{Path, PathBuf};

use tauri::Manager;

/// 允许的图片扩展（小写）
const ALLOWED_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];
/// 图片大小上限（20MB，防止巨型文件拖慢启动加载）
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

/// backgrounds 目录（app_data_dir 之下）
fn backgrounds_dir (app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|base| base.join("backgrounds"))
}

/// 删除目录内全部文件（保留目录本身）；目录不存在静默
///
/// # Arguments
///
/// * `dir` - backgrounds 目录路径
fn clear_dir_files (dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// 设置背景图片（内部实现，接目录路径便于测试）：校验扩展与大小 → 清旧 → 复制为
/// background.{ext}；path 为 None 时仅清空
///
/// # Arguments
///
/// * `dir` - backgrounds 目录路径（不存在则创建）
/// * `path` - 用户选择的图片绝对路径；None = 清除
///
/// # Returns
///
/// `Ok(Some(文件名))` 已复制；`Ok(None)` 已清除；`Err` 校验/复制失败文本
///
/// # Examples
///
/// `background_image_set_inner(&dir, Some("/Users/x/pic.png".into())) // Ok(Some("background.png"))`
fn background_image_set_inner (dir: &Path, path: Option<String>) -> Result<Option<String>, String> {
    clear_dir_files(dir);
    let Some(path) = path else {
        return Ok(None);
    };
    let source = PathBuf::from(&path);
    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!(
            "unsupported image type .{extension} (allowed: {})",
            ALLOWED_EXTENSIONS.join("/")
        ));
    }
    let metadata = std::fs::metadata(&source)
        .map_err(|e| format!("could not read image file: {e}"))?;
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err(format!("image too large ({} bytes, max {MAX_IMAGE_BYTES})", metadata.len()));
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create backgrounds dir: {e}"))?;
    let name = format!("background.{extension}");
    std::fs::copy(&source, dir.join(&name))
        .map_err(|e| format!("could not copy background image: {e}"))?;
    Ok(Some(name))
}

/// 读取当前背景图片（内部实现）：目录内恰好一个 background.* 文件；缺失/读失败 None
///
/// # Arguments
///
/// * `dir` - backgrounds 目录路径
///
/// # Returns
///
/// `Some(Vec<u8>)` 图片内容；`None` 未设置或不可读
fn background_image_load_inner (dir: &Path) -> Option<Vec<u8>> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ALLOWED_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        {
            return std::fs::read(path).ok();
        }
    }
    None
}

/// 设置/清除终端背景图片：复制进应用数据目录（覆盖式，全局单张）
///
/// # Arguments
///
/// * `app` - AppHandle（解析 app_data_dir）
/// * `path` - 用户选择的图片绝对路径；`None` = 清除
///
/// # Returns
///
/// `Ok(Some(文件名))` 已复制（前端写入配置）；`Ok(None)` 已清除；`Err` 校验/IO 失败
///
/// # Examples
///
/// `invoke('background_image_set', { path: '/Users/x/pic.png' })`
#[tauri::command]
pub fn background_image_set (
    app: tauri::AppHandle,
    path: Option<String>,
) -> Result<Option<String>, String> {
    let Some(dir) = backgrounds_dir(&app) else {
        return Err("could not resolve app data dir".to_string());
    };
    background_image_set_inner(&dir, path)
}

/// 读取当前背景图片内容（未设置/文件缺失返回 None，前端降级为无图）
///
/// # Arguments
///
/// * `app` - AppHandle（解析 app_data_dir）
///
/// # Returns
///
/// `Option<Vec<u8>>` 图片 bytes
///
/// # Examples
///
/// `invoke('background_image_load')`
#[tauri::command]
pub fn background_image_load (app: tauri::AppHandle) -> Option<Vec<u8>> {
    backgrounds_dir(&app).and_then(|dir| background_image_load_inner(&dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 建临时目录（测试自清理走 std::env::temp_dir + 唯一后缀）
    fn temp_dir (name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("scx-bg-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// 写一个假图片文件并返回路径
    fn write_source (dir: &Path, name: &str, bytes: &[u8]) -> String {
        let path = dir.join(name);
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(&path, bytes).unwrap();
        path.to_string_lossy().to_string()
    }

    #[test]
    fn set_copies_with_extension_and_load_reads_back () {
        let source_dir = temp_dir("src-copy");
        let bg_dir = temp_dir("bg-copy");
        let source = write_source(&source_dir, "pic.PNG", b"fake-png-bytes");
        // 扩展大小写不敏感（归一化为小写）
        let name = background_image_set_inner(&bg_dir, Some(source)).unwrap().unwrap();
        assert_eq!(name, "background.png");
        assert_eq!(background_image_load_inner(&bg_dir), Some(b"fake-png-bytes".to_vec()));
        let _ = std::fs::remove_dir_all(&source_dir);
        let _ = std::fs::remove_dir_all(&bg_dir);
    }

    #[test]
    fn set_none_clears_existing () {
        let source_dir = temp_dir("src-clear");
        let bg_dir = temp_dir("bg-clear");
        let source = write_source(&source_dir, "pic.jpg", b"jpg");
        background_image_set_inner(&bg_dir, Some(source)).unwrap().unwrap();
        assert!(background_image_set_inner(&bg_dir, None).unwrap().is_none());
        assert_eq!(background_image_load_inner(&bg_dir), None);
        let _ = std::fs::remove_dir_all(&source_dir);
        let _ = std::fs::remove_dir_all(&bg_dir);
    }

    #[test]
    fn set_replaces_previous_image () {
        let source_dir = temp_dir("src-replace");
        let bg_dir = temp_dir("bg-replace");
        let first = write_source(&source_dir, "a.png", b"first");
        let second = write_source(&source_dir, "b.jpg", b"second");
        background_image_set_inner(&bg_dir, Some(first)).unwrap().unwrap();
        background_image_set_inner(&bg_dir, Some(second)).unwrap().unwrap();
        // 换扩展后旧 png 不残留，读到的是新 jpg
        assert_eq!(background_image_load_inner(&bg_dir), Some(b"second".to_vec()));
        let _ = std::fs::remove_dir_all(&source_dir);
        let _ = std::fs::remove_dir_all(&bg_dir);
    }

    #[test]
    fn set_rejects_disallowed_extension () {
        let source_dir = temp_dir("src-ext");
        let bg_dir = temp_dir("bg-ext");
        let source = write_source(&source_dir, "notes.txt", b"txt");
        assert!(background_image_set_inner(&bg_dir, Some(source)).is_err());
        let _ = std::fs::remove_dir_all(&source_dir);
        let _ = std::fs::remove_dir_all(&bg_dir);
    }

    #[test]
    fn set_rejects_oversized_file () {
        let source_dir = temp_dir("src-size");
        let bg_dir = temp_dir("bg-size");
        // 写 20MB + 1 字节（稀疏写：先 set_len 再补首字节）
        let path = source_dir.join("big.png");
        std::fs::create_dir_all(&source_dir).unwrap();
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_IMAGE_BYTES + 1).unwrap();
        drop(file);
        let err = background_image_set_inner(&bg_dir, Some(path.to_string_lossy().to_string()));
        assert!(err.is_err());
        let _ = std::fs::remove_dir_all(&source_dir);
        let _ = std::fs::remove_dir_all(&bg_dir);
    }

    #[test]
    fn load_missing_dir_returns_none () {
        assert_eq!(background_image_load_inner(Path::new("/nonexistent-scx-bg-dir")), None);
    }
}
