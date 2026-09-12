//! Shell discovery: enumerates installed login shells.
//! macOS MVP: parses /etc/shells and marks the user's default shell.

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

fn shell_display_name(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

#[tauri::command]
pub fn list_shells() -> Vec<ShellInfo> {
    let mut shells: Vec<ShellInfo> = Vec::new();

    let default_shell = std::env::var("SHELL").ok();

    #[cfg(target_os = "macos")]
    let shells_file = "/etc/shells";
    #[cfg(not(target_os = "macos"))]
    let shells_file = "/etc/shells";

    if let Ok(contents) = std::fs::read_to_string(shells_file) {
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
