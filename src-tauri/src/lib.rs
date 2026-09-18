mod config;
mod fonts;
mod forward;
mod fsutil;
mod history;
pub mod proc_cwd;
mod pty;
mod secrets;
mod sftp;
mod shells;
mod ssh;
mod transfers;

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
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyManager::new())
        .manage(ssh::SshManager::new())
        .manage(sftp::SftpManager::new())
        .manage(forward::ForwardManager::new())
        .manage(transfers::TransferManager::new())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_ack_data,
            pty::pty_exists,
            pty::pty_get_cwd,
            shells::list_shells,
            fonts::list_fonts,
            forward::forward_start,
            forward::forward_stop,
            forward::forward_list,
            forward::forward_list_all,
            fsutil::fs_list_dir,
            fsutil::fs_read_text_file,
            fsutil::fs_browse_dir,
            fsutil::fs_home_dir,
            history::history_record,
            history::history_list,
            history::history_import,
            history::history_clear,
            config::config_load,
            config::config_load_legacy_yaml,
            config::config_archive_legacy_yaml,
            config::config_dir_path,
            config::settings_set_section,
            config::hotkey_set,
            config::profile_create,
            config::profile_update,
            config::profile_delete,
            config::quick_command_create,
            config::quick_command_update,
            config::quick_command_delete,
            config::quick_command_group_create,
            config::quick_command_group_update,
            config::quick_command_group_delete,
            config::ssh_group_create,
            config::ssh_group_update,
            config::ssh_group_delete,
            config::color_scheme_save,
            config::color_scheme_delete,
            secrets::key_generate,
            secrets::key_import,
            secrets::key_inspect,
            secrets::key_list,
            secrets::key_update,
            secrets::key_delete,
            secrets::cred_set_password,
            secrets::cred_remove,
            secrets::cred_has_password,
            sftp::sftp_open,
            sftp::sftp_read_dir,
            sftp::sftp_mkdir,
            sftp::sftp_rename,
            sftp::sftp_remove_file,
            sftp::sftp_remove_dir,
            sftp::sftp_download,
            sftp::sftp_upload,
            sftp::sftp_close,
            transfers::sftp_transfers,
            transfers::sftp_transfer_cancel,
            transfers::sftp_transfers_clear,
            ssh::ssh_connect,
            ssh::ssh_write,
            ssh::ssh_resize,
            ssh::ssh_kill,
            ssh::ssh_ack_data,
            ssh::ssh_confirm_host_key,
            ssh::ssh_respond_kbd,
            dev_log,
        ])
        .setup(|app| {
            // 敏感数据加密库（SSH 密钥链/档案密码）：初始化失败直接终止——
            // 无加密库时 SSH 凭据功能全不可用，宁可 fast-fail 也不静默降级
            let data_dir = app.path().app_data_dir().expect("app data dir unavailable");
            app.manage(secrets::SecretsState::new(&data_dir));
            // 应用配置库（config.db）：与 secrets.db 同目录，初始化失败同样 fast-fail
            app.manage(config::ConfigState::new(&data_dir));
            // 命令历史库（history.db）：初始化失败同样 fast-fail
            app.manage(history::HistoryState::new(&data_dir));
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
