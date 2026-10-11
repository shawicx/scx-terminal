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
use super::{SshConnectOptions, SshHop, SshManager};

/// 跳板连接参数 → 完整连接选项（authenticate 按此读取密钥链/密码；中间跳不开 PTY）
///
/// # Arguments
///
/// * `hop` - 单个跳板连接参数
///
/// # Returns
///
/// SshConnectOptions（headless 语义；jump_hops 置空——链已由前端展开为扁平列表）
///
/// # Examples
///
/// `let options = hop_connect_options(&hop);`
fn hop_connect_options(hop: &SshHop) -> SshConnectOptions {
    SshConnectOptions {
        id: hop.id.clone(),
        profile_id: hop.profile_id.clone(),
        host: hop.host.clone(),
        port: hop.port,
        user: hop.user.clone(),
        auth: hop.auth.clone(),
        key_id: hop.key_id.clone(),
        cols: 0,
        rows: 0,
        headless: Some(true),
        jump_hops: None,
    }
}

/// 经传输层（直连 TCP 或上一跳 direct-tcpip 隧道流）建立一跳 SSH 连接
///
/// # Arguments
///
/// * `config` - 客户端配置（keepalive 等）
/// * `app` - AppHandle（事件发射）
/// * `forward_registry` - -R 入站路由表（注入 Handler）
/// * `id` - 本跳连接 id（指纹/kbd 事件按它路由）
/// * `host` / `port` - 本跳目标地址
/// * `hostkey_reply` - 前端指纹确认应答通道
/// * `via` - 上一跳隧道流；None = 直连 TCP
///
/// # Returns
///
/// 已建立（未认证）连接句柄；连接失败返回错误文本
///
/// # Examples
///
/// `let handle = connect_hop(config, &app, &registry, &id, "bastion", 22, reply_rx, None).await?;`
async fn connect_hop(
    config: Arc<client::Config>,
    app: &AppHandle,
    forward_registry: &std::sync::Arc<crate::forward::ForwardRegistry>,
    id: &str,
    host: &str,
    port: u16,
    hostkey_reply: oneshot::Receiver<bool>,
    via: Option<russh::ChannelStream<client::Msg>>,
) -> Result<client::Handle<ScxHandler>, String> {
    let handler = ScxHandler {
        app: app.clone(),
        id: id.to_string(),
        host: host.to_string(),
        port,
        hostkey_reply: Some(hostkey_reply),
        forward_registry: forward_registry.clone(),
    };
    let connected = match via {
        Some(stream) => client::connect_stream(config, stream, handler).await,
        None => client::connect(config, (host, port), handler).await,
    };
    connected.map_err(|e| format!("could not connect to {host}:{port}: {e}"))
}

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
    let kbd_waiters = manager.kbd_waiters.clone();
    let forward_registry = forward_manager.registry();
    let hops = options.jump_hops.clone().unwrap_or_default();

    // 跳板句柄外置持有：async 块借用累积，失败时外层仍可级联回收
    let mut jump_handles: Vec<client::Handle<ScxHandler>> = Vec::new();

    let connected = async {
        // 逐跳建连：首跳直连 TCP，后续经上一跳 direct-tcpip 隧道流 connect_stream；
        // 中间跳认证即可（不开 PTY），错误文本带跳序号与地址便于定位
        for (index, hop) in hops.iter().enumerate() {
            let hop_no = index + 1;
            let via = match jump_handles.last() {
                Some(handle) => Some(
                    handle
                        .channel_open_direct_tcpip(
                            hop.host.clone(),
                            u32::from(hop.port),
                            "127.0.0.1".to_string(),
                            0,
                        )
                        .await
                        .map_err(|e| {
                            format!("jump {hop_no} ({}:{}): tunnel open failed: {e}", hop.host, hop.port)
                        })?
                        .into_stream(),
                ),
                None => None,
            };
            let (reply_tx, reply_rx) = oneshot::channel();
            manager
                .hostkey_waiters
                .lock()
                .unwrap()
                .insert(hop.id.clone(), reply_tx);
            let mut handle = connect_hop(
                config.clone(),
                &app,
                &forward_registry,
                &hop.id,
                &hop.host,
                hop.port,
                reply_rx,
                via,
            )
            .await
            .map_err(|e| format!("jump {hop_no} ({}:{}): {e}", hop.host, hop.port))?;
            let hop_options = hop_connect_options(hop);
            let authed = authenticate(&mut handle, &secrets, &hop_options, &app, &kbd_waiters).await;
            manager.hostkey_waiters.lock().unwrap().remove(&hop.id);
            manager.kbd_waiters.lock().unwrap().remove(&hop.id);
            authed.map_err(|e| format!("jump {hop_no} ({}:{}): {e}", hop.host, hop.port))?;
            jump_handles.push(handle);
        }

        // 目标主机：有跳板时经最后一跳隧道，否则直连（与原有路径一致）
        let via = match jump_handles.last() {
            Some(handle) => Some(
                handle
                    .channel_open_direct_tcpip(
                        options.host.clone(),
                        u32::from(options.port),
                        "127.0.0.1".to_string(),
                        0,
                    )
                    .await
                    .map_err(|e| format!("tunnel to {}:{} failed: {e}", options.host, options.port))?
                    .into_stream(),
            ),
            None => None,
        };
        let mut handle = connect_hop(
            config.clone(),
            &app,
            &forward_registry,
            &id,
            options.host.as_str(),
            options.port,
            reply_rx,
            via,
        )
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

    let (connection, channel) = match connected {
        Ok((connection, channel)) => (connection, channel),
        Err(error) => {
            // 链上任一环失败：级联断开已建立的跳板连接后同步返回错误
            for handle in &jump_handles {
                let _ = handle
                    .disconnect(russh::Disconnect::ByApplication, "Session closed", "English")
                    .await;
            }
            return Err(error);
        }
    };
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
        jumps: tokio::sync::Mutex::new(jump_handles),
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
            watcher_session.disconnect_jumps().await;
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
            // 会话断开：级联停止该连接全部转发（-R 路由注销、监听/数据泵 abort、端口释放），
            // 并级联断开跳板链（主连接已 EOF，跳板需显式断开）
            app.state::<ForwardManager>()
                .stop_all_for_ssh(&app, &id_for_event);
            session.disconnect_jumps().await;
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
