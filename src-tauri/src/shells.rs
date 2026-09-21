//! Shell discovery: enumerates installed shells.
//! macOS/Linux: parses /etc/shells and marks the user's default shell.
//! Windows: probes PowerShell 7 → Windows PowerShell → cmd by absolute path
//! (/etc/shells doesn't exist there and /bin/* fallbacks can never spawn).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub default: bool,
}

/// 从路径取展示名（unix 按 / 分隔；Windows 分支直接给展示名，不走这里）
#[cfg(not(target_os = "windows"))]
fn shell_display_name(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

#[tauri::command]
pub fn list_shells() -> Vec<ShellInfo> {
    #[cfg(target_os = "windows")]
    {
        enumerate_windows_shells()
    }
    #[cfg(not(target_os = "windows"))]
    {
        enumerate_unix_shells()
    }
}

///
/// # Description
///
/// macOS/Linux shell 枚举：解析 /etc/shells，标注默认 shell（$SHELL），
/// homebrew 安装的默认 shell 不在列表时补插首位，全空时兜底 /bin/sh。
///
/// # Returns
///
/// 存在的 shell 列表（至少一条兜底项，保证档案生成永远有东西可建）。
///
#[cfg(not(target_os = "windows"))]
fn enumerate_unix_shells() -> Vec<ShellInfo> {
    let mut shells: Vec<ShellInfo> = Vec::new();

    let default_shell = std::env::var("SHELL").ok();

    if let Ok(contents) = std::fs::read_to_string("/etc/shells") {
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if !std::path::Path::new(line).is_file() {
                continue;
            }
            shells.push(ShellInfo {
                id: line.to_string(),
                name: shell_display_name(line),
                command: line.to_string(),
                args: Vec::new(),
                default: default_shell.as_deref() == Some(line),
            });
        }
    }

    // /etc/shells may not list the default shell (e.g. homebrew-installed)
    if let Some(default) = &default_shell {
        if !shells.iter().any(|s| &s.command == default) && std::path::Path::new(default).is_file() {
            shells.insert(
                0,
                ShellInfo {
                    id: default.clone(),
                    name: shell_display_name(default),
                    command: default.clone(),
                    args: Vec::new(),
                    default: true,
                },
            );
        }
    }

    if shells.is_empty() {
        // last-resort fallback so the terminal always has something to spawn
        let fallback = "/bin/sh".to_string();
        shells.push(ShellInfo {
            id: fallback.clone(),
            name: "sh".to_string(),
            command: fallback,
            args: Vec::new(),
            default: true,
        });
    }

    shells
}

///
/// # Description
///
/// Windows shell 探测：按 PowerShell 7 → Windows PowerShell → cmd 的优先级
/// 用绝对路径做存在性检查（CreateProcessW 不解析 /etc、/bin/* 路径必败），
/// 首个存在者标为默认；cmd 几乎必在，作为最终兜底。
///
/// # Returns
///
/// 存在的 shell 列表（可为空，由前端 fallbackProfile 兜底 PowerShell）。
///
#[cfg(target_os = "windows")]
fn enumerate_windows_shells() -> Vec<ShellInfo> {
    let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());
    let candidates: [(String, &str); 3] = [
        (format!(r"{program_files}\PowerShell\7\pwsh.exe"), "PowerShell 7"),
        (format!(r"{system_root}\System32\WindowsPowerShell\v1.0\powershell.exe"), "PowerShell"),
        (format!(r"{system_root}\System32\cmd.exe"), "cmd"),
    ];
    let mut shells: Vec<ShellInfo> = candidates
        .iter()
        .filter(|(path, _)| std::path::Path::new(path).is_file())
        .map(|(path, name)| ShellInfo {
            id: path.clone(),
            name: name.to_string(),
            command: path.clone(),
            args: Vec::new(),
            default: false,
        })
        .collect();
    if let Some(first) = shells.first_mut() {
        first.default = true;
    }
    shells
}
