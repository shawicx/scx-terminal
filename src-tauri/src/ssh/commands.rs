//! @description SSH Tauri 命令：建连（含 PTY/shell/输出泵与 headless 断连 watcher）、
//!              读写/尺寸/断开、背压确认、指纹与凭据挑战应答。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use russh::{client, ChannelMsg};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

use crate::forward::ForwardManager;
use crate::pty::PtyDataQueue;
use crate::secrets::SecretsState;

use super::auth::authenticate;
use super::session::{ScxHandler, SshSession};
use super::{SshConnectOptions, SshManager};

/// 建立 SSH shell 会话：连接 → 指纹确认 → 认证 → PTY + shell → 启动输出泵。
/// 输出经 Tauri Channel 二进制流回传（复用 pty 的背压队列），前端按 `ssh_ack_data` 确认。
///
/// # Arguments
///
/// * `app` - AppHandle（事件发射）
/// * `manager` - 全局 SSH 会话管理器
/// * `data_channel` - 前端创建的二进制输出通道
/// * `options` - 连接选项（host/port/user/auth/初始尺寸）
///
/// # Returns
///
/// 会话 id（UUID）；连接/指纹拒绝/认证失败返回错误文本
///
/// # Examples
///
/// `invoke('ssh_connect', { options, channel })`
#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    manager: State<'_, SshManager>,
    forward_manager: State<'_, ForwardManager>,
    secrets: State<'_, SecretsState>,
    data_channel: Channel<InvokeResponseBody>,
    options: SshConnectOptions,
) -> Result<String, String> {
    let id = options.id.clone();
    let (reply_tx, reply_rx) = oneshot::channel();
    manager
        .hostkey_waiters
        .lock()
        .unwrap()
        .insert(id.clone(), reply_tx);

    let config = Arc::new(client::Config {
        keepalive_interval: Some(Duration::from_secs(5)),
        keepalive_max: 10,
        nodelay: true,
        ..Default::default()
    });
    let handler = ScxHandler {
        app: app.clone(),
        id: id.clone(),
        host: options.host.clone(),
        port: options.port,
        hostkey_reply: Some(reply_rx),
        forward_registry: forward_manager.registry(),
    };
    let address = (options.host.as_str(), options.port);
    let kbd_waiters = manager.kbd_waiters.clone();

    let connected = async {
        let mut handle = client::connect(config, address, handler)
            .await
            .map_err(|e| format!("could not connect to {}:{}: {e}", options.host, options.port))?;
        authenticate(&mut handle, &secrets, &options, &app, &kbd_waiters).await?;

        // headless：认证即完成（无 PTY/shell/数据通道），连接句柄交断连 watcher 看护
        if options.headless.unwrap_or(false) {
            return Ok::<_, String>((handle, None));
        }

        let channel: russh::Channel<client::Msg> = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("failed to open session: {e}"))?;
        channel
            .request_pty(false, "xterm-256color", options.cols, options.rows, 0, 0, &[])
            .await
            .map_err(|e| format!("failed to request pty: {e}"))?;
        channel
            .request_shell(true)
            .await
            .map_err(|e| format!("failed to request shell: {e}"))?;
        Ok((handle, Some(channel)))
    }
    .await;

    manager.hostkey_waiters.lock().unwrap().remove(&id);
    manager.kbd_waiters.lock().unwrap().remove(&id);

    let (connection, channel) = connected?;
    let queue = Arc::new(PtyDataQueue::new(data_channel));
    let (mut read_half, write_half) = match channel {
        Some(channel) => {
            let (read, write) = channel.split();
            (Some(read), Some(write))
        }
        None => (None, None),
    };

    let session = Arc::new(SshSession {
        id: id.clone(),
        write: tokio::sync::Mutex::new(write_half),
        connection: tokio::sync::Mutex::new(Some(connection)),
        exited: Arc::new(AtomicBool::new(false)),
        queue: queue.clone(),
    });
    manager
        .sessions
        .lock()
        .unwrap()
        .insert(id.clone(), session.clone());

    // headless 断连 watcher：russh Handle 无异步 wait，轮询 is_closed（3s）；
    // 语义对齐输出泵的清理路径——exit 事件 + 会话移除 + 级联停该连接全部转发
    if options.headless.unwrap_or(false) {
        let app = app.clone();
        let id_for_event = id.clone();
        let sessions = manager.sessions.clone();
        let watcher_session = session.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(3)).await;
                let closed = {
                    let connection = watcher_session.connection.lock().await;
                    connection.as_ref().map(|handle| handle.is_closed()).unwrap_or(true)
                };
                if closed {
                    break;
                }
            }
            watcher_session.exited.store(true, Ordering::Release);
            let _ = app.emit(&format!("ssh:{id_for_event}:exit"), serde_json::Value::Null);
            sessions.lock().unwrap().remove(&id_for_event);
            app.state::<ForwardManager>()
                .stop_all_for_ssh(&app, &id_for_event);
        });
        return Ok(id);
    }

    // 输出泵：channel 消息 → 背压队列 → 前端；EOF/Close 后发 exit 事件并自清理
    {
        let app = app.clone();
        let id_for_event = id.clone();
        let sessions = manager.sessions.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let message = match read_half.as_mut() {
                    Some(half) => half.wait().await,
                    None => break,
                };
                match message {
                    Some(ChannelMsg::Data { data }) => session.queue.push(data.to_vec()),
                    Some(ChannelMsg::ExtendedData { data, .. }) => session.queue.push(data.to_vec()),
                    Some(ChannelMsg::ExitStatus { .. }) => continue,
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    Some(_) => {}
                }
            }
            // EOF：最后一段残缺序列在这里放行（存活期间绝不中途冲刷，见 pty.rs flush_partial）
            session.queue.flush_partial();
            session.exited.store(true, Ordering::Release);
            let _ = app.emit(&format!("ssh:{id_for_event}:exit"), serde_json::Value::Null);
            sessions.lock().unwrap().remove(&id_for_event);
            // 会话断开：级联停止该连接全部转发（-R 路由注销、监听/数据泵 abort、端口释放）
            app.state::<ForwardManager>()
                .stop_all_for_ssh(&app, &id_for_event);
        });
    }

    Ok(id)
}

/// 向远端 shell 写入（键盘输入/粘贴）
///
/// # Arguments
///
/// * `manager` - 全局 SSH 会话管理器
/// * `id` - 会话 id
/// * `data` - 字节
///
/// # Returns
///
/// `()`；会话不存在或已退出时错误（前端对已退出会话吞掉）
///
/// # Examples
///
/// `invoke('ssh_write', { id, data: [104, 105] })`
#[tauri::command]
pub async fn ssh_write(manager: State<'_, SshManager>, id: String, data: Vec<u8>) -> Result<(), String> {
    let Some(session) = manager.session(&id) else {
        return Err(format!("ssh {id} not found"));
    };
    let write = session.write.lock().await;
    if let Some(write) = write.as_ref() {
        write
            .data_bytes(data)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 通知远端终端尺寸变化（window-change 请求）
///
/// # Arguments
///
/// * `manager` - 全局 SSH 会话管理器
/// * `id` - 会话 id
/// * `cols` - 列数
/// * `rows` - 行数
///
/// # Returns
///
/// `()` 或错误
///
/// # Examples
///
/// `invoke('ssh_resize', { id, cols: 120, rows: 40 })`
#[tauri::command]
pub async fn ssh_resize(manager: State<'_, SshManager>, id: String, cols: u32, rows: u32) -> Result<(), String> {
    let Some(session) = manager.session(&id) else {
        return Err(format!("ssh {id} not found"));
    };
    let write = session.write.lock().await;
    if let Some(write) = write.as_ref() {
        write
            .window_change(cols, rows, 0, 0)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 主动断开会话（关 channel + 断连接 + 停队列；exit 事件由输出泵补发）
///
/// # Arguments
///
/// * `manager` - 全局 SSH 会话管理器
/// * `id` - 会话 id
///
/// # Returns
///
/// `()` 或错误
///
/// # Examples
///
/// `invoke('ssh_kill', { id })`
#[tauri::command]
pub async fn ssh_kill(manager: State<'_, SshManager>, id: String) -> Result<(), String> {
    if let Some(session) = manager.session(&id) {
        session.disconnect().await;
    }
    Ok(())
}

/// 输出流确认（驱动背压，语义同 pty_ack_data）
///
/// # Arguments
///
/// * `manager` - 全局 SSH 会话管理器
/// * `id` - 会话 id
/// * `length` - 已消费字节数
///
/// # Examples
///
/// `invoke('ssh_ack_data', { id, length })`
#[tauri::command]
pub fn ssh_ack_data(manager: State<'_, SshManager>, id: String, length: usize) {
    if let Some(session) = manager.session(&id) {
        session.queue.ack(length);
    }
}

/// 前端应答主机指纹确认（connect 阶段）
///
/// # Arguments
///
/// * `manager` - 全局 SSH 会话管理器
/// * `id` - 连接尝试 id（与事件 `ssh:{id}:hostkey` 一致）
/// * `accepted` - 是否接受该主机密钥
///
/// # Examples
///
/// `invoke('ssh_confirm_host_key', { id, accepted: true })`
#[tauri::command]
pub fn ssh_confirm_host_key(manager: State<'_, SshManager>, id: String, accepted: bool) {
    if let Some(reply) = manager.hostkey_waiters.lock().unwrap().remove(&id) {
        let _ = reply.send(accepted);
    }
}

/// 前端应答 kbd-interactive 凭据挑战（认证阶段，每轮 `ssh:{id}:kbdchallenge` 事件后调用）
///
/// # Arguments
///
/// * `manager` - 全局 SSH 会话管理器
/// * `id` - 连接尝试 id（与事件 `ssh:{id}:kbdchallenge` 一致）
/// * `responses` - 对位每个 prompt 的应答；`None` = 用户取消
///
/// # Examples
///
/// `invoke('ssh_respond_kbd', { id, responses: ['hunter2'] })`
#[tauri::command]
pub fn ssh_respond_kbd(manager: State<'_, SshManager>, id: String, responses: Option<Vec<String>>) {
    if let Some(reply) = manager.kbd_waiters.lock().unwrap().remove(&id) {
        let _ = reply.send(responses);
    }
}
