//! @description SSH 端口转发后端：本地转发（-L，本地 TcpListener → direct-tcpip channel）、
//!              远程转发（-R，tcpip_forward 请求 server 监听 → 入站 channel 回连本地目标）、
//!              动态转发（-D，fast-socks5 no-auth CONNECT → direct-tcpip channel）。
//!              生命周期与 SFTP 一致：转发绑定 ssh_id，SSH 会话断开后由 exit 路径级联停止。
//!              事件约定 `forward:{sshId}:changed`（负载为该连接完整状态快照）。

use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use fast_socks5::server::Socks5ServerProtocol;
use fast_socks5::util::target_addr::TargetAddr;
use fast_socks5::{ReplyError, Socks5Command};
use russh::client::{self, ChannelOpenHandle};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, watch};
use uuid::Uuid;

use crate::ssh::{SshManager, SshSession};

/// 转发类型（serde 小写：local | remote | dynamic）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ForwardKind {
    Local,
    Remote,
    Dynamic,
}

/// forward_start 参数（camelCase；listen_port=0 表示自动分配）
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardOptions {
    pub ssh_id: String,
    pub kind: ForwardKind,
    pub listen_host: String,
    pub listen_port: u16,
    /// local：远端侧目标；remote：本地侧目标；dynamic 必须为 None
    pub target_host: Option<String>,
    pub target_port: Option<u16>,
    /// 来源档案规则 id（面板匹配用；临时转发为 None）
    pub rule_id: Option<String>,
}

/// 转发运行态（forward_start 返回 / forward_list / changed 事件快照）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardState {
    pub id: String,
    pub ssh_id: String,
    pub kind: ForwardKind,
    pub rule_id: Option<String>,
    pub listen_host: String,
    /// 实际生效端口（请求 0 时回填 OS/server 分配值）
    pub listen_port: u16,
    pub target_host: Option<String>,
    pub target_port: Option<u16>,
    /// active | failed
    pub status: String,
    pub error: Option<String>,
}

/// -R 入站 forwarded-tcpip channel（channel 与 open 应答句柄成对投递）
pub struct RemoteChannel {
    pub channel: russh::Channel<client::Msg>,
    pub reply: ChannelOpenHandle,
}

/// -R 入站路由表：ScxHandler 回调按 (ssh_id, port) 匹配投递。按端口匹配——
/// 同一连接同远端端口不可能注册两条，且规避 server 回报地址串与请求不一致的问题。
#[derive(Default)]
pub struct ForwardRegistry {
    routes: Mutex<HashMap<String, HashMap<u32, mpsc::Sender<RemoteChannel>>>>,
}

impl ForwardRegistry {
    /**
     * @description 注册一条 -R 转发的入站 channel 接收端
     * @param ssh_id SSH 会话 id
     * @param port server 侧实际监听端口
     * @param sender 接收端（监督任务持有）
     * @returns void
     *
     * @example registry.register(&ssh_id, 8080, sender)
     *
     */
    pub fn register(&self, ssh_id: &str, port: u32, sender: mpsc::Sender<RemoteChannel>) {
        self.routes
            .lock()
            .unwrap()
            .entry(ssh_id.to_string())
            .or_default()
            .insert(port, sender);
    }

    /**
     * @description 注销一条 -R 转发路由（停止时调用；sender drop 后未投递 channel 自动拒绝）
     * @param ssh_id SSH 会话 id
     * @param port server 侧实际监听端口
     * @returns void
     *
     * @example registry.unregister(&ssh_id, 8080)
     *
     */
    pub fn unregister(&self, ssh_id: &str, port: u32) {
        let mut routes = self.routes.lock().unwrap();
        if let Entry::Occupied(mut entry) = routes.entry(ssh_id.to_string()) {
            entry.get_mut().remove(&port);
            if entry.get().is_empty() {
                entry.remove();
            }
        }
    }

    /**
     * @description 投递一条入站 channel；无路由时返回 false（RemoteChannel 随之 drop，
     *              reply 自动以 AdministrativelyProhibited 拒绝）
     * @param ssh_id SSH 会话 id
     * @param port server 回报的连接端口
     * @param incoming 入站 channel 与应答句柄
     * @returns bool 是否命中路由
     *
     * @example if (!registry.dispatch(&id, port, incoming)) { /* 已自动拒绝 */ }
     *
     */
    pub fn dispatch(&self, ssh_id: &str, port: u32, incoming: RemoteChannel) -> bool {
        let sender = {
            let routes = self.routes.lock().unwrap();
            routes
                .get(ssh_id)
                .and_then(|by_port| by_port.get(&port))
                .cloned()
        };
        let Some(sender) = sender else {
            return false;
        };
        // 有界 channel 满或接收端已停：try_send 失败即拒绝（回调内不等待，避免阻塞连接线程）
        sender.try_send(incoming).is_ok()
    }
}

/// 一条转发：运行态 + 关停信号 + 受管任务句柄（监督任务与数据泵，停止时统一 abort）
pub struct ForwardHandle {
    pub ssh_id: String,
    kind: ForwardKind,
    state: Mutex<ForwardState>,
    shutdown: watch::Sender<bool>,
    tasks: Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>,
}

impl ForwardHandle {
    /**
     * @description 读取当前运行态快照
     * @returns ForwardState
     *
     * @example let state = handle.snapshot()
     *
     */
    fn snapshot(&self) -> ForwardState {
        self.state.lock().unwrap().clone()
    }

    /// 更新运行态并广播 changed 事件（active 置位 / 端口回填 / 失败）
    fn update_state(&self, app: &AppHandle, mutate: impl FnOnce(&mut ForwardState)) {
        {
            let mut state = self.state.lock().unwrap();
            mutate(&mut state);
        }
        emit_changed(app, &self.ssh_id);
    }

    /**
     * @description 在受管任务集中启动一个任务（停止时会被统一 abort）
     * @param future 任务体
     * @returns void
     *
     * @example handle.spawn_tracked(async move { pump(...).await })
     *
     */
    fn spawn_tracked(&self, future: impl std::future::Future<Output = ()> + Send + 'static) {
        self.tasks.lock().unwrap().push(tauri::async_runtime::spawn(future));
    }
}

/// 全局转发管理器（对标 SftpManager 模式）
#[derive(Default)]
pub struct ForwardManager {
    forwards: Mutex<HashMap<String, Arc<ForwardHandle>>>,
    registry: Arc<ForwardRegistry>,
}

impl ForwardManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// ScxHandler 注入用的入站路由表（Arc 克隆，连接期持有）
    pub(crate) fn registry(&self) -> Arc<ForwardRegistry> {
        self.registry.clone()
    }

    fn remove(&self, id: &str) -> Option<Arc<ForwardHandle>> {
        self.forwards.lock().unwrap().remove(id)
    }

    /// 停止一条转发：remote 先取消 server 监听与路由（session 可用时），再统一 abort 任务
    async fn stop(&self, app: &AppHandle, handle: &Arc<ForwardHandle>, ssh_manager: Option<&SshManager>) {
        if handle.kind == ForwardKind::Remote {
            let state = handle.snapshot();
            self.registry
                .unregister(&handle.ssh_id, u32::from(state.listen_port));
            if let Some(manager) = ssh_manager {
                if let Some(session) = manager.session(&handle.ssh_id) {
                    let _ = session
                        .cancel_tcpip_forward(&state.listen_host, state.listen_port)
                        .await;
                }
            }
        }
        shutdown_handle(handle);
        emit_changed(app, &handle.ssh_id);
    }

    /**
     * @description 停止某 SSH 连接的全部转发（会话断开级联清理；同步——不与 server 拉扯，
     *              连接已死，server 侧随 disconnect 自行回收）
     * @param app AppHandle（事件发射）
     * @param ssh_id SSH 会话 id
     * @returns void
     *
     * @example stop_all_for_ssh(&app, &ssh_id)
     *
     */
    pub(crate) fn stop_all_for_ssh(&self, app: &AppHandle, ssh_id: &str) {
        let handles: Vec<Arc<ForwardHandle>> = {
            let mut forwards = self.forwards.lock().unwrap();
            let ids: Vec<String> = forwards
                .iter()
                .filter(|(_, handle)| handle.ssh_id == ssh_id)
                .map(|(id, _)| id.clone())
                .collect();
            ids.iter().filter_map(|id| forwards.remove(id)).collect()
        };
        if handles.is_empty() {
            return;
        }
        for handle in &handles {
            if handle.kind == ForwardKind::Remote {
                let state = handle.snapshot();
                self.registry
                    .unregister(ssh_id, u32::from(state.listen_port));
            }
            shutdown_handle(handle);
        }
        emit_changed(app, ssh_id);
    }

    /// 该连接全部转发状态快照（列表/事件用，按 id 排序保证前端 diff 稳定）
    fn states_for_ssh(&self, ssh_id: &str) -> Vec<ForwardState> {
        let forwards = self.forwards.lock().unwrap();
        let mut states: Vec<ForwardState> = forwards
            .values()
            .filter(|handle| handle.ssh_id == ssh_id)
            .map(|handle| handle.snapshot())
            .collect();
        states.sort_by(|a, b| a.id.cmp(&b.id));
        states
    }
}

/// 发送关停信号并 abort 全部受管任务（任务丢弃即 channel/监听关闭、端口释放）
fn shutdown_handle(handle: &ForwardHandle) {
    let _ = handle.shutdown.send(true);
    let tasks = std::mem::take(&mut *handle.tasks.lock().unwrap());
    for task in tasks {
        task.abort();
    }
}

/// 广播该连接的完整转发状态快照（ForwardManager 经 manage 注册后可从 AppHandle 取回）
fn emit_changed(app: &AppHandle, ssh_id: &str) {
    if let Some(manager) = app.try_state::<ForwardManager>() {
        let _ = app.emit(
            &format!("forward:{ssh_id}:changed"),
            manager.states_for_ssh(ssh_id),
        );
    }
}

/// 校验转发参数（纯函数，单测覆盖）
fn validate_options(options: &ForwardOptions) -> Result<(), String> {
    if options.listen_host.trim().is_empty() {
        return Err("listen host is required".to_string());
    }
    match options.kind {
        ForwardKind::Local | ForwardKind::Remote => {
            let host = options.target_host.as_deref().unwrap_or("").trim();
            if host.is_empty() {
                return Err("target host is required".to_string());
            }
            let Some(port) = options.target_port else {
                return Err("target port is required".to_string());
            };
            if port == 0 {
                return Err("target port must be 1-65535".to_string());
            }
        }
        ForwardKind::Dynamic => {
            if options.target_host.is_some() || options.target_port.is_some() {
                return Err("dynamic forwarding takes no target".to_string());
            }
        }
    }
    Ok(())
}

/// TargetAddr → (host, port)：Domain 原样透传（DNS 在 SSH server 侧解析，-D 语义）
fn target_addr_to_host_port(target: &TargetAddr) -> (String, u16) {
    match target {
        TargetAddr::Ip(addr) => (addr.ip().to_string(), addr.port()),
        TargetAddr::Domain(host, port) => (host.clone(), *port),
    }
}

/// 双向搬运：任一方向结束（EOF/错误）即返回，两侧随 drop 关闭
async fn pipe_bidirectional<A, B>(a: A, b: B)
where
    A: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
    B: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut a_read, mut a_write) = tokio::io::split(a);
    let (mut b_read, mut b_write) = tokio::io::split(b);
    tokio::select! {
        result = tokio::io::copy(&mut a_read, &mut b_write) => {
            let _ = result;
        }
        result = tokio::io::copy(&mut b_read, &mut a_write) => {
            let _ = result;
        }
    }
}

/// local/dynamic 监听循环：accept → 每连接回调开任务；监听错误标记 failed，关停信号结束循环
async fn run_listener_loop(
    app: AppHandle,
    handle: Arc<ForwardHandle>,
    session: Arc<SshSession>,
    listener: TcpListener,
    on_accept: fn(Arc<ForwardHandle>, Arc<SshSession>, TcpStream, std::net::SocketAddr),
) {
    let mut shutdown = handle.shutdown.subscribe();
    loop {
        let accepted = tokio::select! {
            _ = shutdown.changed() => break,
            accepted = listener.accept() => accepted,
        };
        match accepted {
            Ok((tcp, peer)) => on_accept(handle.clone(), session.clone(), tcp, peer),
            Err(error) => {
                handle.update_state(&app, |state| {
                    state.status = "failed".to_string();
                    state.error = Some(format!("accept failed: {error}"));
                });
                break;
            }
        }
    }
}

/// -L：每连接开 direct-tcpip channel 后双向搬运（单连接失败仅断该连接）
fn accept_local_connection(
    handle: Arc<ForwardHandle>,
    session: Arc<SshSession>,
    tcp: TcpStream,
    peer: std::net::SocketAddr,
) {
    let state = handle.snapshot();
    let target_host = state.target_host.clone().unwrap_or_default();
    let target_port = state.target_port.unwrap_or(0);
    handle.spawn_tracked(async move {
        let channel = session
            .open_direct_tcpip(&target_host, target_port, &peer.ip().to_string(), peer.port())
            .await;
        if let Ok(channel) = channel {
            pipe_bidirectional(tcp, channel.into_stream()).await;
        }
    });
}

/// -D：SOCKS5 no-auth 握手 → CONNECT 目标接管为 direct-tcpip channel → 双向搬运
fn accept_dynamic_connection(
    handle: Arc<ForwardHandle>,
    session: Arc<SshSession>,
    tcp: TcpStream,
    _peer: std::net::SocketAddr,
) {
    handle.spawn_tracked(async move {
        let authed = match Socks5ServerProtocol::accept_no_auth(tcp).await {
            Ok(authed) => authed,
            Err(_) => return,
        };
        let (proto, command, target) = match authed.read_command().await {
            Ok(read) => read,
            Err(_) => return,
        };
        if command != Socks5Command::TCPConnect {
            let _ = proto.reply_error(&ReplyError::CommandNotSupported).await;
            return;
        }
        let (host, port) = target_addr_to_host_port(&target);
        let channel = match session.open_direct_tcpip(&host, port, "127.0.0.1", 0).await {
            Ok(channel) => channel,
            Err(_) => {
                let _ = proto.reply_error(&ReplyError::GeneralFailure).await;
                return;
            }
        };
        let client = match proto.reply_success("127.0.0.1:0".parse().unwrap()).await {
            Ok(client) => client,
            Err(_) => return,
        };
        pipe_bidirectional(client, channel.into_stream()).await;
    });
}

/// -R 入站监督循环：收 (channel, reply) → accept → 连本地目标 → 双向搬运
async fn run_remote_loop(handle: Arc<ForwardHandle>, mut incoming: mpsc::Receiver<RemoteChannel>) {
    while let Some(RemoteChannel { channel, reply }) = incoming.recv().await {
        reply.accept().await;
        let state = handle.snapshot();
        let target_host = state.target_host.clone().unwrap_or_default();
        let target_port = state.target_port.unwrap_or(0);
        handle.spawn_tracked(async move {
            if let Ok(tcp) = TcpStream::connect((target_host.as_str(), target_port)).await {
                pipe_bidirectional(tcp, channel.into_stream()).await;
            }
        });
    }
}

/// 建立一条转发：校验 → 定位连接 → 建监听/注册 server 监听 → 起监督任务。
/// listen_port=0 时同步回填实际分配端口（错误同步返回，前端立即呈现）。
///
/// # Arguments
///
/// * `app` - AppHandle（事件发射）
/// * `ssh_manager` - SSH 会话管理器（定位已认证连接）
/// * `forward_manager` - 转发管理器
/// * `options` - 转发参数
///
/// # Returns
///
/// ForwardState 初始运行态；参数非法/连接不存在/监听失败返回错误文本
///
/// # Examples
///
/// `invoke('forward_start', { options })`
#[tauri::command]
pub async fn forward_start(
    app: AppHandle,
    ssh_manager: State<'_, SshManager>,
    forward_manager: State<'_, ForwardManager>,
    options: ForwardOptions,
) -> Result<ForwardState, String> {
    validate_options(&options)?;
    let Some(session) = ssh_manager.session(&options.ssh_id) else {
        return Err(format!("ssh {} not found", options.ssh_id));
    };

    let id = format!("fwd-{}", Uuid::new_v4());
    let (shutdown, _) = watch::channel(false);
    let handle = Arc::new(ForwardHandle {
        ssh_id: options.ssh_id.clone(),
        kind: options.kind,
        state: Mutex::new(ForwardState {
            id: id.clone(),
            ssh_id: options.ssh_id.clone(),
            kind: options.kind,
            rule_id: options.rule_id.clone(),
            listen_host: options.listen_host.clone(),
            listen_port: options.listen_port,
            target_host: options.target_host.clone(),
            target_port: options.target_port,
            status: "starting".to_string(),
            error: None,
        }),
        shutdown,
        tasks: Mutex::new(Vec::new()),
    });

    match options.kind {
        ForwardKind::Local | ForwardKind::Dynamic => {
            // 本地监听（port=0 由 OS 分配并回填）
            let listener = TcpListener::bind((options.listen_host.as_str(), options.listen_port))
                .await
                .map_err(|e| {
                    format!(
                        "failed to listen on {}:{}: {e}",
                        options.listen_host, options.listen_port
                    )
                })?;
            let actual_port = listener
                .local_addr()
                .map(|addr| addr.port())
                .unwrap_or(options.listen_port);
            let on_accept = match options.kind {
                ForwardKind::Local => accept_local_connection,
                _ => accept_dynamic_connection,
            };
            handle.update_state(&app, |state| {
                state.listen_port = actual_port;
                state.status = "active".to_string();
            });
            handle.spawn_tracked(run_listener_loop(
                app.clone(),
                handle.clone(),
                session,
                listener,
                on_accept,
            ));
        }
        ForwardKind::Remote => {
            // 请求 server 监听（port=0 由 server 分配并回填；显式端口时 russh 返回 0）
            let granted = session
                .tcpip_forward(&options.listen_host, options.listen_port)
                .await
                .map_err(|e| {
                    format!(
                        "server refused to listen on {}:{}: {e}",
                        options.listen_host, options.listen_port
                    )
                })?;
            let actual_port = if options.listen_port == 0 {
                u16::try_from(granted)
                    .map_err(|_| "server assigned an invalid port".to_string())?
            } else {
                options.listen_port
            };
            let (sender, receiver) = mpsc::channel(16);
            forward_manager
                .registry()
                .register(&options.ssh_id, u32::from(actual_port), sender);
            handle.update_state(&app, |state| {
                state.listen_port = actual_port;
                state.status = "active".to_string();
            });
            handle.spawn_tracked(run_remote_loop(handle.clone(), receiver));
        }
    }

    forward_manager
        .forwards
        .lock()
        .unwrap()
        .insert(id.clone(), handle.clone());
    emit_changed(&app, &options.ssh_id);
    Ok(handle.snapshot())
}

/// 停止一条转发（remote 先 cancel_tcpip_forward；全部任务 abort，端口释放）
///
/// # Arguments
///
/// * `app` - AppHandle（事件发射）
/// * `ssh_manager` - SSH 会话管理器（remote 取消监听用）
/// * `forward_manager` - 转发管理器
/// * `id` - 转发 id
///
/// # Examples
///
/// `invoke('forward_stop', { id })`
#[tauri::command]
pub async fn forward_stop(
    app: AppHandle,
    ssh_manager: State<'_, SshManager>,
    forward_manager: State<'_, ForwardManager>,
    id: String,
) -> Result<(), String> {
    let Some(handle) = forward_manager.remove(&id) else {
        return Err(format!("forward {id} not found"));
    };
    forward_manager
        .stop(&app, &handle, Some(&ssh_manager))
        .await;
    Ok(())
}

/// 列出某 SSH 连接的全部转发状态（面板打开时全量拉取）
///
/// # Arguments
///
/// * `forward_manager` - 转发管理器
/// * `ssh_id` - SSH 会话 id
///
/// # Returns
///
/// Vec<ForwardState>（按 id 排序；连接不存在时为空数组）
///
/// # Examples
///
/// `invoke('forward_list', { sshId })`
#[tauri::command]
pub fn forward_list(forward_manager: State<'_, ForwardManager>, ssh_id: String) -> Vec<ForwardState> {
    forward_manager.states_for_ssh(&ssh_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_options(kind: ForwardKind) -> ForwardOptions {
        ForwardOptions {
            ssh_id: "ssh-test".into(),
            kind,
            listen_host: "127.0.0.1".into(),
            listen_port: 18080,
            target_host: Some("db.internal".into()),
            target_port: Some(5432),
            rule_id: None,
        }
    }

    #[test]
    fn options_validation_requires_target_for_local_and_remote() {
        let mut options = sample_options(ForwardKind::Local);
        assert!(validate_options(&options).is_ok());

        options.target_host = Some("  ".into());
        assert!(validate_options(&options).is_err());

        options.target_host = None;
        options.target_port = None;
        assert!(validate_options(&options).is_err());

        let mut remote = sample_options(ForwardKind::Remote);
        remote.target_port = Some(0);
        assert!(validate_options(&remote).is_err());
    }

    #[test]
    fn options_validation_rejects_target_for_dynamic_and_empty_host() {
        let mut options = sample_options(ForwardKind::Dynamic);
        options.target_host = None;
        options.target_port = None;
        assert!(validate_options(&options).is_ok());

        options.target_host = Some("x".into());
        assert!(validate_options(&options).is_err());

        let mut local = sample_options(ForwardKind::Local);
        local.listen_host = " ".into();
        assert!(validate_options(&local).is_err());
    }

    #[test]
    fn state_serializes_camel_case() {
        let state = ForwardState {
            id: "fwd-1".into(),
            ssh_id: "ssh-1".into(),
            kind: ForwardKind::Dynamic,
            rule_id: Some("rule-1".into()),
            listen_host: "127.0.0.1".into(),
            listen_port: 1080,
            target_host: None,
            target_port: None,
            status: "active".into(),
            error: None,
        };
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("\"sshId\":\"ssh-1\""));
        assert!(json.contains("\"ruleId\":\"rule-1\""));
        assert!(json.contains("\"kind\":\"dynamic\""));
        assert!(json.contains("\"listenPort\":1080"));
    }

    #[test]
    fn registry_register_and_unregister_by_port() {
        let registry = ForwardRegistry::default();
        let (sender, _receiver) = mpsc::channel(4);
        registry.register("ssh-1", 8080, sender);

        // dispatch 无法在单测构造 RemoteChannel（需真实 channel），
        // 这里锁定路由表形状：按 (ssh_id, port) 命中/未命中
        let routes = registry.routes.lock().unwrap();
        assert!(routes.get("ssh-1").unwrap().contains_key(&8080));
        assert!(!routes.get("ssh-1").unwrap().contains_key(&9999));
        assert!(routes.get("ssh-2").is_none());
        drop(routes);

        registry.unregister("ssh-1", 8080);
        assert!(registry.routes.lock().unwrap().get("ssh-1").is_none());
    }

    #[test]
    fn registry_unregister_cleans_empty_ssh_bucket() {
        let registry = ForwardRegistry::default();
        let (sender_a, _receiver_a) = mpsc::channel(1);
        let (sender_b, _receiver_b) = mpsc::channel(1);
        registry.register("ssh-1", 100, sender_a);
        registry.register("ssh-1", 200, sender_b);
        registry.unregister("ssh-1", 100);
        {
            let routes = registry.routes.lock().unwrap();
            assert!(routes.get("ssh-1").unwrap().contains_key(&200));
        }
        registry.unregister("ssh-1", 200);
        assert!(registry.routes.lock().unwrap().get("ssh-1").is_none());
    }
}
