//! @description SSH 会话实体：连接阶段 Handler（TOFU 指纹确认、-R 入站路由）与
//!              已建立会话的通道操作（SFTP 子通道 / exec / direct-tcpip / 转发注册与断开）。

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use russh::keys::{self, ssh_key, PublicKeyOrCertificate};
use russh::{client, Disconnect};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use crate::forward::{ForwardRegistry, RemoteChannel};
use crate::pty::PtyDataQueue;

/// hostkey 指纹确认弹窗等待上限：超时视为拒绝，防止认证阶段永久挂起
const HOSTKEY_CONFIRM_TIMEOUT: Duration = Duration::from_secs(120);

/// 连接阶段的客户端 Handler：覆写 check_server_key 实现 TOFU 指纹确认；
/// 覆写 server_channel_open_forwarded_tcpip 把 -R 入站 channel 路由到转发任务
pub(super) struct ScxHandler {
    pub(super) app: AppHandle,
    pub(super) id: String,
    pub(super) host: String,
    pub(super) port: u16,
    /// 前端 hostkey 确认应答（ssh_confirm_host_key 发送）；None = 已消费（回调仅一次，防御性 Option）
    pub(super) hostkey_reply: Option<oneshot::Receiver<bool>>,
    /// -R 入站 channel 路由表（ForwardManager 注入，跨连接共享）
    pub(super) forward_registry: Arc<ForwardRegistry>,
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
    pub(super) write: tokio::sync::Mutex<Option<russh::ChannelWriteHalf<client::Msg>>>,
    /// 连接句柄：open_sftp_channel 复用它开第二 channel（SFTP 文件面板）
    pub(super) connection: tokio::sync::Mutex<Option<client::Handle<ScxHandler>>>,
    pub(super) exited: Arc<AtomicBool>,
    pub(super) queue: Arc<PtyDataQueue>,
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
    pub(super) async fn disconnect(&self) {
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
