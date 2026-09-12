mod config;
mod pty;
mod shells;

use tauri::Manager;

/// Frontend → Rust console logging, used by main.ts error forwarding.
/// Handy when debugging webview-only issues during `tauri dev`.
#[tauri::command]
fn dev_log(message: String) {
    println!("[scx:js] {message}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(pty::PtyManager::new())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_ack_data,
            pty::pty_exists,
            shells::list_shells,
            config::config_load,
            config::config_save,
            config::config_dir_path,
            dev_log,
        ])
        .setup(|app| {
            // the webview owns keyboard shortcuts (⌘T/⌘W are handled in-app),
            // and removing the menu keeps ⌘W from closing the window
            app.remove_menu()?;
            #[allow(unused_variables)]
            let window = app
                .get_webview_window("main")
                .expect("main window should exist");
            // vibrancy + transparent window currently renders blank in this
            // WKWebView combo — revisit in the theming phase
            #[cfg(any())]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::UnderWindowBackground,
                    None,
                    None,
                )
                .expect("failed to apply vibrancy");
            }
            #[cfg(debug_assertions)]
            if std::env::var("SCX_DEVTOOLS").is_ok() {
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running scx-terminal");
}
