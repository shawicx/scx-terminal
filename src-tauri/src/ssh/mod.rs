//! @description SSH 会话（russh 客户端）：连接 / 认证（agent、私钥、密码）/ TOFU 主机指纹
//!              确认（读写系统 ~/.ssh/known_hosts）/ PTY + shell / 双向数据转发 / keepalive。
//!              数据面复用 pty 的 PtyDataQueue 背压队列，事件约定 `ssh:{id}:exit|close|hostkey`。
//!
//! 模块拆分：session（ScxHandler 与 SshSession 通道操作）/ auth（认证策略链与前端挑战）/ commands
//!（Tauri 命令薄包装）。注意：`#[tauri::command]` 生成的 `__tauri_command_name_*` 宏留在
//! 定义模块，lib.rs 需按 `ssh::commands::xxx` 完整路径引用；前端 invoke 命令名不受影响。

mod auth;
pub(crate) mod commands;
mod session;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::oneshot;

pub use session::SshSession;

/// 认证进行中等待前端 kbd-interactive 应答的通道表（SshManager 与认证链共用）
pub(crate) type KbdWaiters = Arc<Mutex<HashMap<String, oneshot::Sender<Option<Vec<String>>>>>>;

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

#[derive(Default)]
pub struct SshManager {
    pub(super) sessions: Arc<Mutex<HashMap<String, Arc<SshSession>>>>,
    /// connect 进行中等待前端指纹确认的应答通道（连接成功后移除）
    pub(super) hostkey_waiters: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
    /// 认证进行中等待前端 kbd-interactive 应答的通道：每轮挑战 insert 一个条目，
    /// `ssh_respond_kbd` 应答时移除。Sender 发送 `None` = 用户取消
    pub(super) kbd_waiters: KbdWaiters,
}

impl SshManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub(crate) fn session(&self, id: &str) -> Option<Arc<SshSession>> {
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
