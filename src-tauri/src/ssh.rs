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
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

use crate::forward::{ForwardManager, ForwardRegistry, RemoteChannel};
use crate::pty::PtyDataQueue;
use crate::secrets::{self, SecretsState};

/// hostkey 指纹确认弹窗等待上限：超时视为拒绝，防止认证阶段永久挂起
const HOSTKEY_CONFIRM_TIMEOUT: Duration = Duration::from_secs(120);
/// kbd-interactive 挑战弹窗等待上限：留足 MFA（短信/验证器）取证时间
const KBD_CHALLENGE_TIMEOUT: Duration = Duration::from_secs(300);

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
    /// 无终端会话的后台连接（SFTP 标签 / 独立隧道用）：跳过 PTY/shell/输出泵，
    /// 由断连 watcher 轮询连接状态做清理；cols/rows 与 data_channel 被忽略
    pub headless: Option<bool>,
}

/// 连接阶段的客户端 Handler：覆写 check_server_key 实现 TOFU 指纹确认；
/// 覆写 server_channel_open_forwarded_tcpip 把 -R 入站 channel 路由到转发任务
struct ScxHandler {
    app: AppHandle,
    id: String,
    host: String,
    port: u16,
    /// 前端 hostkey 确认应答（ssh_confirm_host_key 发送）；None = 已消费（回调仅一次，防御性 Option）
    hostkey_reply: Option<oneshot::Receiver<bool>>,
    /// -R 入站 channel 路由表（ForwardManager 注入，跨连接共享）
    forward_registry: Arc<ForwardRegistry>,
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
            Some(reply) => match tokio::time::timeout(HOSTKEY_CONFIRM_TIMEOUT, reply).await {
                Ok(Ok(accepted)) => accepted,
                // 应答通道关闭（连接断开）或确认超时：视为拒绝
                _ => false,
            },
            None => false,
        };
        if accepted && !changed {
            let _ = keys::known_hosts::learn_known_hosts(&self.host, self.port, &key);
        }
        Ok(accepted)
    }

    /// -R 入站 forwarded-tcpip channel：按 (会话 id, server 监听端口) 路由到转发任务；
    /// 无路由时 RemoteChannel 随之 drop，reply 自动以 AdministrativelyProhibited 拒绝
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<client::Msg>,
        _connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        self.forward_registry
            .dispatch(&self.id, connected_port, RemoteChannel { channel, reply });
        Ok(())
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

    /// 在本连接上开一次性 exec channel 执行命令并收集 stdout（监控采集用）。
    /// 锁内只开 channel（同 open_sftp_channel 先例），exec 循环在锁外进行，
    /// 避免慢命令阻塞 disconnect / 其他 channel 打开
    ///
    /// # Arguments
    ///
    /// * `command` - 待执行的 POSIX shell 命令串
    /// * `timeout` - 单次执行超时
    ///
    /// # Returns
    ///
    /// String stdout 输出；连接已关闭 / 执行失败 / 超时 / 空输出附 stderr 返回错误文本
    ///
    /// # Examples
    ///
    /// `let out = session.exec_command("uname -a", Duration::from_secs(10)).await?;`
    pub(crate) async fn exec_command(
        &self,
        command: &str,
        timeout: Duration,
    ) -> Result<String, String> {
        let channel = {
            let connection = self.connection.lock().await;
            let handle = connection
                .as_ref()
                .ok_or_else(|| "ssh session is closed".to_string())?;
            handle
                .channel_open_session()
                .await
                .map_err(|e| format!("failed to open exec channel: {e}"))?
        };
        channel
            .exec(true, command)
            .await
            .map_err(|e| format!("failed to exec command: {e}"))?;
        let mut stdout = Vec::new();
        let mut stderr = String::new();
        let exec = async {
            let mut channel = channel;
            while let Some(msg) = channel.wait().await {
                match msg {
                    russh::ChannelMsg::Data { ref data } => stdout.extend_from_slice(data),
                    russh::ChannelMsg::ExtendedData { ref data, ext: 1 } => {
                        stderr.push_str(&String::from_utf8_lossy(data))
                    }
                    russh::ChannelMsg::Eof | russh::ChannelMsg::Close => break,
                    _ => {}
                }
            }
            Ok::<(), String>(())
        };
        match tokio::time::timeout(timeout, exec).await {
            Ok(Ok(())) => {
                let text = String::from_utf8_lossy(&stdout).into_owned();
                if text.trim().is_empty() && !stderr.trim().is_empty() {
                    let snippet: String = stderr.chars().take(200).collect();
                    Err(format!("command produced no output: {snippet}"))
                } else {
                    Ok(text)
                }
            }
            Ok(Err(e)) => Err(e),
            Err(_) => Err("exec command timed out".to_string()),
        }
    }

    /// 在本连接上开 direct-tcpip channel（-L/-D 转发的目标连接）
    ///
    /// # Arguments
    ///
    /// * `host` - 目标主机（远端侧解析）
    /// * `port` - 目标端口
    /// * `originator` / `originator_port` - 发起方地址（本地侧信息，仅透传给 server 记录）
    ///
    /// # Returns
    ///
    /// direct-tcpip channel；连接已关闭返回错误
    ///
    /// # Examples
    ///
    /// `let channel = session.open_direct_tcpip("db", 5432, "127.0.0.1", 0).await?;`
    pub(crate) async fn open_direct_tcpip(
        &self,
        host: &str,
        port: u16,
        originator: &str,
        originator_port: u16,
    ) -> Result<russh::Channel<client::Msg>, String> {
        let connection = self.connection.lock().await;
        let handle = connection.as_ref().ok_or_else(|| "ssh session is closed".to_string())?;
        handle
            .channel_open_direct_tcpip(
                host.to_string(),
                u32::from(port),
                originator.to_string(),
                u32::from(originator_port),
            )
            .await
            .map_err(|e| format!("failed to open direct-tcpip channel: {e}"))
    }

    /// 请求 server 监听端口（-R 注册）；port=0 时返回 server 实际分配端口，显式端口时返回 0
    ///
    /// # Returns
    ///
    /// u32 server 分配端口（port=0 时有意义）；连接已关闭或 server 拒绝返回错误
    ///
    /// # Examples
    ///
    /// `let granted = session.tcpip_forward("127.0.0.1", 0).await?;`
    pub(crate) async fn tcpip_forward(&self, address: &str, port: u16) -> Result<u32, String> {
        let connection = self.connection.lock().await;
        let handle = connection.as_ref().ok_or_else(|| "ssh session is closed".to_string())?;
        handle
            .tcpip_forward(address.to_string(), u32::from(port))
            .await
            .map_err(|e| format!("tcpip-forward request failed: {e}"))
    }

    /// 取消 server 侧监听（停止 -R 转发时）
    ///
    /// # Examples
    ///
    /// `session.cancel_tcpip_forward("127.0.0.1", 8080).await?;`
    pub(crate) async fn cancel_tcpip_forward(&self, address: &str, port: u16) -> Result<(), String> {
        let connection = self.connection.lock().await;
        let handle = connection.as_ref().ok_or_else(|| "ssh session is closed".to_string())?;
        handle
            .cancel_tcpip_forward(address.to_string(), u32::from(port))
            .await
            .map_err(|e| format!("cancel tcpip-forward failed: {e}"))
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
    /// 认证进行中等待前端 kbd-interactive 应答的通道：每轮挑战 insert 一个条目，
    /// `ssh_respond_kbd` 应答时移除。Sender 发送 `None` = 用户取消
    kbd_waiters: Arc<Mutex<HashMap<String, oneshot::Sender<Option<Vec<String>>>>>>,
}

impl SshManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub(crate) fn session (&self, id: &str) -> Option<Arc<SshSession>> {
        self.sessions.lock().unwrap().get(id).cloned()
    }

    /// sessions map 的 Arc 克隆（monitor 采样任务在 spawn 内按 ssh_id 查会话）
    ///
    /// # Returns
    ///
    /// Arc<Mutex<HashMap<String, Arc<SshSession>>>>
    ///
    /// # Examples
    ///
    /// `let sessions = manager.sessions_arc();`
    pub(crate) fn sessions_arc(
        &self,
    ) -> Arc<Mutex<HashMap<String, Arc<SshSession>>>> {
        self.sessions.clone()
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

/// agent 认证：逐个 identity 尝试（失败时携带最后一次服务器剩余可用方法）
async fn try_agent(handle: &mut client::Handle<ScxHandler>, user: &str) -> Result<TryAuth, String> {
    // connect_env 仅在 Unix 存在（依赖 SSH_AUTH_SOCK）；Windows 走系统 OpenSSH Agent 服务的命名管道
    #[cfg(unix)]
    let mut agent = AgentClient::connect_env()
        .await
        .map_err(|e| format!("SSH agent unavailable: {e}"))?;
    #[cfg(windows)]
    let mut agent = AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent")
        .await
        .map_err(|e| format!("SSH agent unavailable: {e}"))?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| format!("SSH agent identities failed: {e}"))?;
    let mut remaining: Option<russh::MethodSet> = None;
    for identity in identities {
        let public_key = identity.public_key().into_owned();
        let hash = rsa_hash_for(handle, public_key.algorithm()).await;
        match handle
            .authenticate_publickey_with(user.to_string(), public_key, hash, &mut agent)
            .await
        {
            Ok(russh::client::AuthResult::Success) => return Ok(TryAuth::Success),
            Ok(russh::client::AuthResult::Failure { remaining_methods, .. }) => {
                remaining = Some(remaining_methods);
            }
            Err(_) => continue,
        }
    }
    Ok(TryAuth::Failure(remaining))
}

/// 私钥认证：pem 已解密（密钥链解密或默认路径直读），passphrase 为加密私钥口令
async fn try_private_key_pem(
    handle: &mut client::Handle<ScxHandler>,
    user: &str,
    pem: &str,
    passphrase: Option<&str>,
) -> Result<TryAuth, String> {
    let key = keys::decode_secret_key(pem, passphrase)
        .map_err(|e| format!("failed to decode private key (wrong passphrase?): {e}"))?;
    let hash = rsa_hash_for(handle, key.algorithm()).await;
    let key = PrivateKeyWithHashAlg::new(Arc::new(key), hash);
    match handle.authenticate_publickey(user.to_string(), key).await {
        Ok(russh::client::AuthResult::Success) => Ok(TryAuth::Success),
        Ok(russh::client::AuthResult::Failure { remaining_methods, .. }) => {
            Ok(TryAuth::Failure(Some(remaining_methods)))
        }
        Err(e) => Err(format!("publickey auth failed: {e}")),
    }
}

/// 无口令默认私钥（~/.ssh/id_ed25519 等）尝试
async fn try_default_private_keys(handle: &mut client::Handle<ScxHandler>, user: &str) -> Result<TryAuth, String> {
    let mut remaining: Option<russh::MethodSet> = None;
    for name in ["id_ed25519", "id_rsa", "id_ecdsa"] {
        if let Some(home) = std::env::var("HOME").ok() {
            let path = format!("{home}/.ssh/{name}");
            if std::path::Path::new(&path).is_file() {
                let pem = std::fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
                match try_private_key_pem(handle, user, &pem, None).await? {
                    TryAuth::Success => return Ok(TryAuth::Success),
                    TryAuth::Failure(methods) => remaining = methods.or(remaining),
                }
            }
        }
    }
    Ok(TryAuth::Failure(remaining))
}

/// 判定挑战是否为「单一密码型 prompt」（恰好一个 echo=false）。
/// Rust 侧用于库存密码静默自动应答条件；前端「记住密码」勾选框显示用同规则（TS 各自实现）。
///
/// # Arguments
///
/// * `prompts` - 服务器挑战的 prompt 列表
///
/// # Returns
///
/// true = 单一不回显 prompt
///
/// # Examples
///
/// `is_single_secret_prompt(&[Prompt { prompt: "Password:".into(), echo: false }]) // true`
fn is_single_secret_prompt(prompts: &[russh::client::Prompt]) -> bool {
    prompts.len() == 1 && !prompts[0].echo
}

/// 认证失败文案：附加服务器建议的剩余可用方法（如有），如
/// `authentication failed (password); server allows: publickey, gssapi-with-mic`
///
/// # Arguments
///
/// * `method` - 我方尝试的认证方式名（agent / publicKey / password / keyboard-interactive）
/// * `remaining_methods` - 服务器 `AuthResult::Failure` 的剩余方法集；None = 无该信息
///
/// # Returns
///
/// 错误文本
///
/// # Examples
///
/// `format_auth_failure("agent", None) // "authentication failed (agent)"`
fn format_auth_failure(method: &str, remaining_methods: Option<&russh::MethodSet>) -> String {
    let mut text = format!("authentication failed ({method})");
    if let Some(methods) = remaining_methods {
        let allowed: Vec<&str> = methods.iter().map(<&str>::from).collect();
        if !allowed.is_empty() {
            text.push_str(&format!("; server allows: {}", allowed.join(", ")));
        }
    }
    text
}

/// 单一认证手段（agent / 私钥）的尝试结果：成功，或失败并尽量携带服务器剩余可用方法
enum TryAuth {
    Success,
    Failure(Option<russh::MethodSet>),
}

/// 前端凭据挑战的应答结果（ask_frontend 返回值）
enum KbdFrontendReply {
    /// 用户提交了应答（对位每个 prompt）
    Responses(Vec<String>),
    /// 用户取消（发送 None）或连接断开（通道关闭）
    Cancelled,
    /// 等待超时
    TimedOut,
}

/// 发一轮 kbd-interactive 挑战给前端并等待应答：注册 oneshot → emit 事件 → await（带超时）。
///
/// # Arguments
///
/// * `app` - AppHandle（事件发射）
/// * `kbd_waiters` - SshManager 的挑战应答表（每轮 insert，应答时由命令移除）
/// * `id` - 连接尝试 id
/// * `name` / `instructions` - 服务器原文（可为空）
/// * `prompts` - 服务器 prompt 列表
///
/// # Returns
///
/// `Responses` 用户应答；`Cancelled` 取消或通道关闭（连接断开）；`TimedOut` 超过等待上限
async fn ask_frontend(
    app: &AppHandle,
    kbd_waiters: &Arc<Mutex<HashMap<String, oneshot::Sender<Option<Vec<String>>>>>>,
    id: &str,
    name: &str,
    instructions: &str,
    prompts: &[russh::client::Prompt],
) -> KbdFrontendReply {
    let (reply_tx, reply_rx) = oneshot::channel();
    kbd_waiters.lock().unwrap().insert(id.to_string(), reply_tx);
    let payload_prompts: Vec<serde_json::Value> = prompts
        .iter()
        .map(|p| serde_json::json!({ "prompt": p.prompt, "echo": p.echo }))
        .collect();
    let _ = app.emit(
        &format!("ssh:{id}:kbdchallenge"),
        serde_json::json!({ "name": name, "instructions": instructions, "prompts": payload_prompts }),
    );
    match tokio::time::timeout(KBD_CHALLENGE_TIMEOUT, reply_rx).await {
        Ok(Ok(Some(responses))) => KbdFrontendReply::Responses(responses),
        // 用户显式取消（发送 None）或通道关闭（连接断开）
        Ok(Ok(None)) | Ok(Err(_)) => KbdFrontendReply::Cancelled,
        Err(_) => KbdFrontendReply::TimedOut,
    }
}

/// 纯 password 兜底：库存密码直接认证；无库存则合成单一密码挑战弹窗后认证（单次机会）。
/// 仅当服务器不支持 kbd-interactive 时被调用。
///
/// # Arguments
///
/// * `handle` - 已建立的连接句柄
/// * `stored` - 密钥库已存密码（可能 None）
/// * `options` - 连接选项
/// * `app` / `kbd_waiters` - 挑战应答通道（见 ask_frontend）
///
/// # Returns
///
/// `Ok(())` 认证成功；`Err` 取消/失败文本
async fn password_fallback(
    handle: &mut client::Handle<ScxHandler>,
    stored: Option<String>,
    options: &SshConnectOptions,
    app: &AppHandle,
    kbd_waiters: &Arc<Mutex<HashMap<String, oneshot::Sender<Option<Vec<String>>>>>>,
) -> Result<(), String> {
    let password = match stored {
        Some(password) => password,
        None => {
            let prompts = vec![russh::client::Prompt { prompt: "Password:".to_string(), echo: false }];
            let responses = match ask_frontend(app, kbd_waiters, &options.id, "", "", &prompts).await {
                KbdFrontendReply::Responses(responses) => responses,
                KbdFrontendReply::Cancelled => return Err("authentication cancelled".to_string()),
                KbdFrontendReply::TimedOut => {
                    return Err("authentication timed out waiting for password".to_string());
                }
            };
            responses.into_iter().next().unwrap_or_default()
        }
    };
    match handle.authenticate_password(options.user.clone(), password).await {
        Ok(russh::client::AuthResult::Success) => Ok(()),
        Ok(russh::client::AuthResult::Failure { remaining_methods, .. }) => {
            Err(format_auth_failure("password", Some(&remaining_methods)))
        }
        Err(e) => Err(format!("password auth failed: {e}")),
    }
}

/// 密码类认证统一入口（password 档案与 auto 链条末尾共用）：kbd-interactive 优先——
/// 库存密码对单一密码型挑战第一轮静默自动应答（只此一轮，失败重发后走弹窗），
/// 其余挑战发前端弹窗；弹窗轮数上限 5。仅当**首轮 start 即 Failure/Err**（服务器不支持
/// kbd-interactive）才回退纯 password 兜底；进入过 InfoRequest 轮次后的 Failure 即最终失败。
///
/// # Arguments
///
/// * `handle` - 已建立的连接句柄
/// * `secrets` - 加密库状态（读库存密码）
/// * `options` - 连接选项
/// * `app` / `kbd_waiters` - 挑战应答通道（见 ask_frontend）
///
/// # Returns
///
/// `Ok(())` 认证成功；`Err` 取消/超限/失败文本
///
/// # Examples
///
/// `try_password_like(&mut handle, &secrets, &options, &app, &kbd_waiters).await?;`
async fn try_password_like(
    handle: &mut client::Handle<ScxHandler>,
    secrets: &SecretsState,
    options: &SshConnectOptions,
    app: &AppHandle,
    kbd_waiters: &Arc<Mutex<HashMap<String, oneshot::Sender<Option<Vec<String>>>>>>,
) -> Result<(), String> {
    let stored = secrets::load_password(secrets, &options.profile_id).ok().flatten();
    let mut response = handle
        .authenticate_keyboard_interactive_start(options.user.clone(), None)
        .await;
    let mut auto_answered = false;
    let mut rounds: u32 = 0;
    loop {
        match response {
            Ok(russh::client::KeyboardInteractiveAuthResponse::Success) => return Ok(()),
            Ok(russh::client::KeyboardInteractiveAuthResponse::InfoRequest { name, instructions, prompts }) => {
                if !auto_answered && stored.is_some() && is_single_secret_prompt(&prompts) {
                    auto_answered = true;
                    let password = stored.clone().unwrap_or_default();
                    response = handle.authenticate_keyboard_interactive_respond(vec![password]).await;
                    continue;
                }
                rounds += 1;
                if rounds > 5 {
                    return Err("too many authentication prompts".to_string());
                }
                match ask_frontend(app, kbd_waiters, &options.id, &name, &instructions, &prompts).await {
                    KbdFrontendReply::Responses(responses) => {
                        response = handle.authenticate_keyboard_interactive_respond(responses).await;
                    }
                    KbdFrontendReply::Cancelled => return Err("authentication cancelled".to_string()),
                    KbdFrontendReply::TimedOut => {
                        return Err("authentication timed out waiting for response".to_string());
                    }
                }
            }
            // 首轮 start 即 Failure/Err = 服务器不支持 kbd-interactive → 纯 password 兜底；
            // 进入过轮次后到达这里（rounds > 0 或已自动应答）= 应答被拒 → 最终失败，不兜底
            _ if rounds == 0 && !auto_answered => {
                return password_fallback(handle, stored, options, app, kbd_waiters).await;
            }
            Ok(russh::client::KeyboardInteractiveAuthResponse::Failure { remaining_methods, .. }) => {
                return Err(format_auth_failure("keyboard-interactive", Some(&remaining_methods)));
            }
            _ => return Err("authentication failed".to_string()),
        }
    }
}

/// 按档案 auth 策略认证；auto = agent → 密钥链条目 → 默认私钥 → 密码类（kbd 优先 + password 兜底）
///
/// # Arguments
///
/// * `handle` - 已建立的连接句柄
/// * `secrets` - 加密库状态
/// * `options` - 连接选项
/// * `app` / `kbd_waiters` - kbd-interactive 挑战应答通道（见 ask_frontend）
///
/// # Returns
///
/// `Ok(())` 认证成功；`Err` 失败文本
async fn authenticate(
    handle: &mut client::Handle<ScxHandler>,
    secrets: &SecretsState,
    options: &SshConnectOptions,
    app: &AppHandle,
    kbd_waiters: &Arc<Mutex<HashMap<String, oneshot::Sender<Option<Vec<String>>>>>>,
) -> Result<(), String> {
    match options.auth.as_str() {
        "agent" => match try_agent(handle, &options.user).await? {
            TryAuth::Success => Ok(()),
            TryAuth::Failure(remaining) => Err(format_auth_failure("agent", remaining.as_ref())),
        },
        "publicKey" => {
            let key_id = options.key_id.as_deref().ok_or("no keychain key selected")?;
            let loaded = secrets::load_private_key(secrets, key_id)?;
            match try_private_key_pem(handle, &options.user, &loaded.private_key_pem, loaded.passphrase.as_deref()).await? {
                TryAuth::Success => Ok(()),
                TryAuth::Failure(remaining) => Err(format_auth_failure("publicKey", remaining.as_ref())),
            }
        }
        "password" => try_password_like(handle, secrets, options, app, kbd_waiters).await,
        _ => {
            if matches!(
                try_agent(handle, &options.user).await.unwrap_or(TryAuth::Failure(None)),
                TryAuth::Success
            ) {
                return Ok(());
            }
            if let Some(key_id) = options.key_id.as_deref() {
                let loaded = secrets::load_private_key(secrets, key_id)?;
                if matches!(
                    try_private_key_pem(handle, &options.user, &loaded.private_key_pem, loaded.passphrase.as_deref()).await?,
                    TryAuth::Success
                ) {
                    return Ok(());
                }
            } else if matches!(
                try_default_private_keys(handle, &options.user).await.unwrap_or(TryAuth::Failure(None)),
                TryAuth::Success
            ) {
                return Ok(());
            }
            try_password_like(handle, secrets, options, app, kbd_waiters)
                .await
                .map_err(|e| {
                    // 兜底文案带上了 server allows 后缀，用前缀匹配改写尝试链描述
                    if e.starts_with("authentication failed (password)") {
                        e.replacen(
                            "authentication failed (password)",
                            "authentication failed (tried agent, private keys, password)",
                            1,
                        )
                    } else {
                        e
                    }
                })
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

#[cfg(test)]
mod kbd_tests {
    use super::is_single_secret_prompt;
    use russh::client::Prompt;

    /// 构造单个 Prompt 的便捷函数
    fn prompt(echo: bool) -> Prompt {
        Prompt { prompt: "Password: ".to_string(), echo }
    }

    #[test]
    fn single_hidden_prompt_is_single_secret() {
        assert!(is_single_secret_prompt(&[prompt(false)]));
    }

    #[test]
    fn single_echoed_prompt_is_not_single_secret() {
        assert!(!is_single_secret_prompt(&[prompt(true)]));
    }

    #[test]
    fn multiple_prompts_are_not_single_secret() {
        assert!(!is_single_secret_prompt(&[prompt(false), prompt(false)]));
    }

    #[test]
    fn empty_prompts_are_not_single_secret() {
        assert!(!is_single_secret_prompt(&[]));
    }
}

#[cfg(test)]
mod auth_failure_tests {
    use super::format_auth_failure;
    use russh::{MethodKind, MethodSet};

    /// 构造方法集的便捷函数
    fn methods(kinds: &[MethodKind]) -> MethodSet {
        let mut set = MethodSet::empty();
        for kind in kinds {
            set.push(*kind);
        }
        set
    }

    #[test]
    fn no_remaining_methods_keeps_plain_text() {
        assert_eq!(format_auth_failure("agent", None), "authentication failed (agent)");
    }

    #[test]
    fn empty_remaining_methods_keeps_plain_text() {
        assert_eq!(
            format_auth_failure("password", Some(&methods(&[]))),
            "authentication failed (password)"
        );
    }

    #[test]
    fn remaining_methods_appended_after_semicolon() {
        let set = methods(&[MethodKind::PublicKey, MethodKind::GssapiWithMic]);
        assert_eq!(
            format_auth_failure("password", Some(&set)),
            "authentication failed (password); server allows: publickey, gssapi-with-mic"
        );
    }
}
