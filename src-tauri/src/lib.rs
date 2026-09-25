mod background;
mod config;
mod debug_log;
mod fonts;
mod forward;
mod fsutil;
mod history;
pub mod proc_cwd;
mod pty;
mod secrets;
mod sftp;
mod snapshot;
mod s3sync;
mod shells;
mod monitor;
mod ssh;
mod transfers;

use tauri::{AppHandle, Manager, State};

///
/// @description 前端 → 后端日志通道（main.ts 错误转发与业务 console 转发共用）：
///              始终 println 到 stdout（tauri dev 可见）；调试模式开启时追加写入日志文件
/// @param state 调试日志状态
/// @param message 单行日志内容
/// @returns void
///
#[tauri::command]
fn dev_log(state: State<debug_log::DebugLogState>, message: String) {
    println!("[scx:js] {message}");
    state.append(&message);
}

///
/// @description 开关调试日志（前端配置加载后同步一次；设置页切换时实时调用）
/// @param state 调试日志状态
/// @param enabled 是否开启
/// @returns void
///
#[tauri::command]
fn debug_set_enabled(state: State<debug_log::DebugLogState>, enabled: bool) {
    state.set_enabled(enabled);
}

///
/// @description 打开主窗口 webview DevTools（release 构建依赖 Cargo devtools feature，
///              用于诊断黑屏等渲染类问题）
/// @param app 应用句柄
/// @returns void
///
#[tauri::command]
fn debug_open_devtools(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
    }
}

///
/// @description 返回调试日志目录路径（设置页「打开日志目录」按钮用）
/// @param state 调试日志状态
/// @returns String 日志目录绝对路径
///
#[tauri::command]
fn debug_log_dir(state: State<debug_log::DebugLogState>) -> String {
    let dir = state.log_path().parent().unwrap_or_else(|| std::path::Path::new(""));
    dir.to_string_lossy().into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(pty::PtyManager::new())
        .manage(ssh::SshManager::new())
        .manage(sftp::SftpManager::new())
        .manage(forward::ForwardManager::new())
        .manage(transfers::TransferManager::new())
        .manage(monitor::MonitorManager::new())
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
            background::background_image_set,
            background::background_image_load,
            history::history_record,
            history::history_list,
            history::history_import,
            history::history_clear,
            config::load::config_load,
            config::legacy::config_load_legacy_yaml,
            config::legacy::config_archive_legacy_yaml,
            config::config_dir_path,
            config::settings::settings_set_section,
            config::settings::hotkey_set,
            config::profiles::profile_create,
            config::profiles::profile_update,
            config::profiles::profile_delete,
            config::quick_commands::quick_command_create,
            config::quick_commands::quick_command_update,
            config::quick_commands::quick_command_delete,
            config::quick_commands::quick_command_group_create,
            config::quick_commands::quick_command_group_update,
            config::quick_commands::quick_command_group_delete,
            config::groups::local_group_create,
            config::groups::local_group_update,
            config::groups::local_group_delete,
            config::groups::ssh_group_create,
            config::groups::ssh_group_update,
            config::groups::ssh_group_delete,
            config::groups::tab_group_create,
            config::groups::tab_group_update,
            config::groups::tab_group_delete,
            config::settings::tab_session_get,
            config::settings::tab_session_set,
            config::settings::color_scheme_save,
            config::settings::color_scheme_delete,
            snapshot::config_export,
            snapshot::config_import,
            s3sync::s3_sync_get,
            s3sync::s3_sync_set,
            s3sync::s3_sync_clear,
            s3sync::s3_sync_test,
            s3sync::s3_sync_status,
            s3sync::s3_sync_push,
            s3sync::s3_sync_list_remote,
            s3sync::s3_sync_pull,
            secrets::keys::key_generate,
            secrets::keys::key_import,
            secrets::keys::key_inspect,
            secrets::keys::key_list,
            secrets::keys::key_update,
            secrets::keys::key_delete,
            secrets::creds::cred_set_password,
            secrets::creds::cred_remove,
            secrets::creds::cred_has_password,
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
            ssh::commands::ssh_connect,
            ssh::commands::ssh_write,
            ssh::commands::ssh_resize,
            ssh::commands::ssh_kill,
            ssh::commands::ssh_ack_data,
            ssh::commands::ssh_confirm_host_key,
            ssh::commands::ssh_respond_kbd,
            monitor::monitor_start,
            monitor::monitor_stop,
            debug_set_enabled,
            debug_open_devtools,
            debug_log_dir,
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
            // 调试日志（advanced.debugEnabled 驱动；开关由前端配置加载后同步）
            app.manage(debug_log::DebugLogState::new(&data_dir));
            // the webview owns keyboard shortcuts (⌘T/⌘W/⌘C/⌘V are handled in-app),
            // so the macOS menu deliberately omits every item carrying those
            // accelerators; it still needs the app submenu for ⌘H/⌘Q to work
            // (menu-less apps get no ⌘Q quit accelerator from the system)
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, PredefinedMenuItem, Submenu};
                let hide = PredefinedMenuItem::hide(app, None)?;
                let hide_others = PredefinedMenuItem::hide_others(app, None)?;
                let separator = PredefinedMenuItem::separator(app)?;
                let quit = PredefinedMenuItem::quit(app, None)?;
                let app_submenu = Submenu::with_items(
                    app,
                    "scx-terminal",
                    true,
                    &[&hide, &hide_others, &separator, &quit],
                )?;
                let menu = MenuBuilder::new(app).items(&[&app_submenu]).build()?;
                app.set_menu(menu)?;
            }
            #[cfg(not(target_os = "macos"))]
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
            // release 构建同样支持 SCX_DEVTOOLS=1（配合 devtools feature），
            // 用于诊断连设置页都无法进入的启动期问题
            if std::env::var("SCX_DEVTOOLS").is_ok() {
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running scx-terminal");
}
