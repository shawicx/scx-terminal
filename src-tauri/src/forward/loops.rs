//! 转发数据面循环：local/dynamic 监听 accept、SOCKS5 CONNECT 接管、-R 入站监督、
//! 双向搬运与参数校验（纯逻辑，便于单测）。

use fast_socks5::util::target_addr::TargetAddr;
use fast_socks5::{ReplyError, Socks5Command};
use fast_socks5::server::Socks5ServerProtocol;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

use crate::ssh::SshSession;

use super::{ForwardHandle, ForwardKind, ForwardOptions, RemoteChannel};

/// 校验转发参数（纯函数，单测覆盖）
pub(super) fn validate_options(options: &ForwardOptions) -> Result<(), String> {
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
pub(super) async fn run_listener_loop(
    app: tauri::AppHandle,
    handle: std::sync::Arc<ForwardHandle>,
    session: std::sync::Arc<SshSession>,
    listener: TcpListener,
    on_accept: fn(std::sync::Arc<ForwardHandle>, std::sync::Arc<SshSession>, TcpStream, std::net::SocketAddr),
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
pub(super) fn accept_local_connection(
    handle: std::sync::Arc<ForwardHandle>,
    session: std::sync::Arc<SshSession>,
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
pub(super) fn accept_dynamic_connection(
    handle: std::sync::Arc<ForwardHandle>,
    session: std::sync::Arc<SshSession>,
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
pub(super) async fn run_remote_loop(
    handle: std::sync::Arc<ForwardHandle>,
    mut incoming: mpsc::Receiver<RemoteChannel>,
) {
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
