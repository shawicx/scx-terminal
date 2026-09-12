//! YAML config persistence: load/save with atomic writes and a rolling backup.
//! The frontend owns the config shape (types + defaults + merging); Rust only
//! provides durable storage, mirroring Tabby's split of responsibilities.

use std::fs;
use std::path::PathBuf;

use tauri::Manager;

fn config_dir(app: &tauri::AppHandle) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let base = app
            .path()
            .home_dir()
            .expect("home directory should be resolvable");
        base.join("Library/Application Support/scx-terminal")
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
        base.join("scx-terminal")
    }
    #[cfg(target_os = "windows")]
    {
        let base = app
            .path()
            .app_config_dir()
            .expect("app config dir should be resolvable");
        base.join("scx-terminal")
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        app.path().app_config_dir().expect("app config dir").join("scx-terminal")
    }
}

fn config_path(app: &tauri::AppHandle) -> PathBuf {
    config_dir(app).join("config.yaml")
}

/// Returns the raw YAML contents, or an empty string when no config exists yet.
#[tauri::command]
pub fn config_load(app: tauri::AppHandle) -> Result<String, String> {
    let path = config_path(&app);
    match fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("could not read {}: {e}", path.display())),
    }
}

/// Atomically persists the config: write a temp file, keep the previous
/// version as `config.yaml.backup`, then rename over the target.
#[tauri::command]
pub fn config_save(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let path = config_path(&app);
    let dir = config_dir(&app);

    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;

    if path.exists() {
        let backup = dir.join("config.yaml.backup");
        fs::copy(&path, &backup).map_err(|e| format!("could not back up config: {e}"))?;
    }

    let tmp = dir.join("config.yaml.tmp");
    fs::write(&tmp, content).map_err(|e| format!("could not write config: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("could not replace config: {e}"))?;
    Ok(())
}

/// Exposes the config directory (shown in the settings UI).
#[tauri::command]
pub fn config_dir_path(app: tauri::AppHandle) -> String {
    config_dir(&app).to_string_lossy().into_owned()
}
