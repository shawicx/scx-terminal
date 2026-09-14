//! @description SSH 会话（russh 客户端）：连接 / 认证（agent、私钥、密码）/ TOFU 主机指纹
//!              确认（读写系统 ~/.ssh/known_hosts）/ PTY + shell / 双向数据转发 / keepalive。
//!              数据面复用 pty 的 PtyDataQueue 背压队列，事件约定 `ssh:{id}:exit|close|hostkey`。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::keys::agent::client::AgentClient;
use russh::keys::{self, ssh_key, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{client, ChannelMsg, Disconnect};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

use crate::pty::PtyDataQueue;
use crate::secrets::{self, SecretsState};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectOptions {
    /// 会话 id（前端生成：使 hostkey 等事件可在 connect 返回前被前端监听）
    pub id: String,
    /// 档案 id：Rust 据此从加密库解密已存密码（敏感数据不经前端）
    pub profile_id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    /// auto | agent | publicKey | password
    pub auth: String,
    /// 密钥链条目 id（Rust 据此解密私钥与口令）；null = 不用密钥链
    pub key_id: Option<String>,
    pub cols: u32,
    pub rows: u32,
}

/// 连接阶段的客户端 Handler：覆写 check_server_key 实现 TOFU 指纹确认
struct ScxHandler {
    app: AppHandle,
    id: String,
    host: String,
    port: u16,
    /// 前端 hostkey 确认应答（ssh_confirm_host_key 发送）；None = 已消费（回调仅一次，防御性 Option）
    hostkey_reply: Option<oneshot::Receiver<bool>>,
}

impl client::Handler for ScxHandler {
    type Error = russh::Error;

    /// 校验服务器公钥：known_hosts 已知匹配直接通过；未知/失配发事件给前端确认，
    /// 仅首次（未知）接受后写回 known_hosts，失配提示下永不写回
    async fn check_server_key(&mut self, server_public_key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let key = server_public_key.public_key();
        let fingerprint = key.fingerprint(ssh_key::HashAlg::Sha256).to_string();
        let key_type = key.algorithm().as_str().to_string();

        let changed = match keys::check_known_hosts(&self.host, self.port, &key) {
            Ok(true) => return Ok(true),
            Ok(false) => false,
            Err(_) => true,
        };

        let _ = self.app.emit(
            &format!("ssh:{}:hostkey", self.id),
            serde_json::json!({ "fingerprint": fingerprint, "keyType": key_type, "changed": changed }),
        );
        let accepted = match self.hostkey_reply.take() {
            Some(reply) => reply.await.unwrap_or(false),
            None => false,
        };
        if accepted && !changed {
            let _ = keys::known_hosts::learn_known_hosts(&self.host, self.port, &key);
        }
        Ok(accepted)
    }
}

/// 一条已建立的 SSH shell 会话：channel 写半（写/resize）、连接句柄（断开）、输出队列。
/// write/connection 用 tokio Mutex：命令内跨 await 持锁（std MutexGuard 非 Send 编译不过）
pub struct SshSession {
    #[allow(dead_code)]
    pub id: String,
    write: tokio::sync::Mutex<Option<russh::ChannelWriteHalf<client::Msg>>>,
    /// 连接句柄：open_sftp_channel 复用它开第二 channel（SFTP 文件面板）
    connection: tokio::sync::Mutex<Option<client::Handle<ScxHandler>>>,
    exited: Arc<AtomicBool>,
    queue: Arc<PtyDataQueue>,
}

impl SshSession {
    /// 在本连接上开第二 channel 并请求 `sftp` subsystem，返回可直接交给
    /// russh-sftp 的 `SftpSession::new` 的流；连接已关闭返回 `None`
    ///
    /// # Returns
    ///
    /// SFTP subsystem 通道流
    ///
    /// # Examples
    ///
    /// `let stream = session.open_sftp_channel().await.ok_or("closed")?;`
    pub(crate) async fn open_sftp_channel(
        &self,
    ) -> Result<russh::ChannelStream<client::Msg>, String> {
        let connection = self.connection.lock().await;
        let handle = connection.as_ref().ok_or_else(|| "ssh session is closed".to_string())?;
        let channel = handle.channel_open_session().await
            .map_err(|e| format!("failed to open sftp channel: {e}"))?;
        channel.request_subsystem(true, "sftp").await
            .map_err(|e| format!("failed to request sftp subsystem: {e}"))?;
        Ok(channel.into_stream())
    }

    /// 主动断开：关 channel → 断连接 → 停队列（泵任务随后收到 EOF 并发出 exit 事件）
    async fn disconnect(&self) {
        if let Some(write) = self.write.lock().await.take() {
            let _ = write.close().await;
        }
        if let Some(connection) = self.connection.lock().await.take() {
            let _ = connection
                .disconnect(Disconnect::ByApplication, "Session closed", "English")
                .await;
        }
        self.queue.close();
    }
}

#[derive(Default)]
pub struct SshManager {
    sessions: Arc<Mutex<HashMap<String, Arc<SshSession>>>>,
    /// connect 进行中等待前端指纹确认的应答通道（连接成功后移除）
    hostkey_waiters: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
}

impl SshManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub(crate) fn session (&self, id: &str) -> Option<Arc<SshSession>> {
        self.sessions.lock().unwrap().get(id).cloned()
    }
}

/// RSA 私钥需与服务器协商签名哈希，其余算法忽略
async fn rsa_hash_for(handle: &client::Handle<ScxHandler>, algorithm: ssh_key::Algorithm) -> Option<keys::HashAlg> {
    if !algorithm.is_rsa() {
        return None;
    }
    handle
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten()
}

/// agent 认证：逐个 identity 尝试（返回是否成功）
async fn try_agent(handle: &mut client::Handle<ScxHandler>, user: &str) -> Result<bool, String> {
    let mut agent = AgentClient::connect_env()
        .await
        .map_err(|e| format!("SSH agent unavailable: {e}"))?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| format!("SSH agent identities failed: {e}"))?;
    for identity in identities {
        let public_key = identity.public_key().into_owned();
        let hash = rsa_hash_for(handle, public_key.algorithm()).await;
        match handle
            .authenticate_publickey_with(user.to_string(), public_key, hash, &mut agent)
            .await
        {
            Ok(result) if result.success() => return Ok(true),
            _ => continue,
        }
    }
    Ok(false)
}

/// 私钥认证：pem 已解密（密钥链解密或默认路径直读），passphrase 为加密私钥口令
async fn try_private_key_pem(
    handle: &mut client::Handle<ScxHandler>,
    user: &str,
    pem: &str,
    passphrase: Option<&str>,
) -> Result<bool, String> {
    let key = keys::decode_secret_key(pem, passphrase)
        .map_err(|e| format!("failed to decode private key (wrong passphrase?): {e}"))?;
    let hash = rsa_hash_for(handle, key.algorithm()).await;
    let key = PrivateKeyWithHashAlg::new(Arc::new(key), hash);
    match handle.authenticate_publickey(user.to_string(), key).await {
        Ok(result) => Ok(result.success()),
        Err(e) => Err(format!("publickey auth failed: {e}")),
    }
}

/// 无口令默认私钥（~/.ssh/id_ed25519 等）尝试
async fn try_default_private_keys(handle: &mut client::Handle<ScxHandler>, user: &str) -> Result<bool, String> {
    for name in ["id_ed25519", "id_rsa", "id_ecdsa"] {
        if let Some(home) = std::env::var("HOME").ok() {
            let path = format!("{home}/.ssh/{name}");
            if std::path::Path::new(&path).is_file() {
                let pem = std::fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
                if try_private_key_pem(handle, user, &pem, None).await? {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}

/// 按档案 auth 策略认证；auto = agent → 密钥链条目 → 默认私钥 → 库中密码（若有）
async fn authenticate(
    handle: &mut client::Handle<ScxHandler>,
    secrets: &SecretsState,
    options: &SshConnectOptions,
) -> Result<(), String> {
    match options.auth.as_str() {
        "agent" => {
            if try_agent(handle, &options.user).await? {
                return Ok(());
            }
            Err("authentication failed (agent)".to_string())
        }
        "publicKey" => {
            let key_id = options.key_id.as_deref().ok_or("no keychain key selected")?;
            let loaded = secrets::load_private_key(secrets, key_id)?;
            if try_private_key_pem(handle, &options.user, &loaded.private_key_pem, loaded.passphrase.as_deref()).await? {
                return Ok(());
            }
            Err("authentication failed (publicKey)".to_string())
        }
        "password" => {
            let password = secrets::load_password(secrets, &options.profile_id)?
                .ok_or("no password configured")?;
            match handle.authenticate_password(options.user.clone(), password).await {
                Ok(result) if result.success() => Ok(()),
                Ok(_) => Err("authentication failed (password)".to_string()),
                Err(e) => Err(format!("password auth failed: {e}")),
            }
        }
        _ => {
            if try_agent(handle, &options.user).await.unwrap_or(false) {
                return Ok(());
            }
            if let Some(key_id) = options.key_id.as_deref() {
                let loaded = secrets::load_private_key(secrets, key_id)?;
                if try_private_key_pem(handle, &options.user, &loaded.private_key_pem, loaded.passphrase.as_deref()).await? {
                    return Ok(());
                }
            } else if try_default_private_keys(handle, &options.user).await.unwrap_or(false) {
                return Ok(());
            }
            if let Ok(Some(password)) = secrets::load_password(secrets, &options.profile_id) {
                if let Ok(result) = handle.authenticate_password(options.user.clone(), password).await {
                    if result.success() {
                        return Ok(());
                    }
                }
            }
            Err("authentication failed (tried agent, private keys, password)".to_string())
        }
    }
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
    };
    let address = (options.host.as_str(), options.port);

    let connected = async {
        let mut handle = client::connect(config, address, handler)
            .await
            .map_err(|e| format!("could not connect to {}:{}: {e}", options.host, options.port))?;
        authenticate(&mut handle, &secrets, &options).await?;

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
        Ok::<_, String>((handle, channel))
    }
    .await;

    manager.hostkey_waiters.lock().unwrap().remove(&id);

    let (connection, channel) = connected?;
    let queue = Arc::new(PtyDataQueue::new(data_channel));
    let (mut read_half, write_half) = channel.split();

    let session = Arc::new(SshSession {
        id: id.clone(),
        write: tokio::sync::Mutex::new(Some(write_half)),
        connection: tokio::sync::Mutex::new(Some(connection)),
        exited: Arc::new(AtomicBool::new(false)),
        queue: queue.clone(),
    });
    manager
        .sessions
        .lock()
        .unwrap()
        .insert(id.clone(), session.clone());

    // 输出泵：channel 消息 → 背压队列 → 前端；EOF/Close 后发 exit 事件并自清理
    let exited_flag = session.exited.clone();
    {
        let app = app.clone();
        let id_for_event = id.clone();
        let sessions = manager.sessions.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                match read_half.wait().await {
                    Some(ChannelMsg::Data { data }) => session.queue.push(data.to_vec()),
                    Some(ChannelMsg::ExtendedData { data, .. }) => session.queue.push(data.to_vec()),
                    Some(ChannelMsg::ExitStatus { .. }) => continue,
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    Some(_) => {}
                }
            }
            session.exited.store(true, Ordering::Release);
            let _ = app.emit(&format!("ssh:{id_for_event}:exit"), serde_json::Value::Null);
            sessions.lock().unwrap().remove(&id_for_event);
        });
    }

    // 跨块 UTF-8 残尾的定期冲刷（会话退出后线程结束）
    {
        let queue = queue.clone();
        let exited = exited_flag;
        std::thread::spawn(move || while !exited.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_millis(250));
            queue.flush_stale_partial();
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
