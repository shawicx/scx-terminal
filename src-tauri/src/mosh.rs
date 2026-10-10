//! @description Mosh 客户端探测：在 PATH 上查找 mosh 可执行文件（Mosh 会话启动前的
//!              可用性预检；Windows 无原生 mosh 客户端，直接返回 None）。

/// 在 PATH 上探测 mosh 可执行文件（which 语义：遍历 PATH + 可执行文件检查）
///
/// # Returns
///
/// mosh 可执行文件绝对路径；未安装 / Windows 返回 None
///
/// # Examples
///
/// `let path = mosh_detect();`
#[tauri::command]
pub fn mosh_detect() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        let path_env = std::env::var("PATH").ok()?;
        for dir in path_env.split(':') {
            if dir.is_empty() {
                continue;
            }
            let candidate = std::path::Path::new(dir).join("mosh");
            let Ok(meta) = std::fs::metadata(&candidate) else {
                continue;
            };
            if meta.is_file() {
                // unix 可执行位检查（mode & 0o111）；无扩展名后缀即 mosh 本体
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if meta.permissions().mode() & 0o111 == 0 {
                        continue;
                    }
                }
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
        None
    }
}
