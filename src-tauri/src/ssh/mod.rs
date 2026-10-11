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
    /// 跳板机链（按连接顺序，最外层跳板在前；缺省/空 = 直连）。
    /// 每跳 id 由前端生成为 `{最终会话id}:jump{i}`，指纹/kbd 挑战事件按该 id 发射
    pub jump_hops: Option<Vec<SshHop>>,
}

/// 单个跳板机连接参数（形状对齐 SshConnectOptions 核心字段；中间跳不开 PTY）
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHop {
    /// 跳板连接 id（`{最终id}:jump{i}`；指纹确认与 kbd 挑战按它路由）
    pub id: String,
    /// 跳板档案 id（Rust 据此从加密库解密已存密码）
    pub profile_id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    /// auto | agent | publicKey | password
    pub auth: String,
    /// 密钥链条目 id；null = 不用密钥链
    pub key_id: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// connect_options_parse_jump_hops：camelCase 跳板链字段解析（id/profileId/keyId 形状）
    #[test]
    fn connect_options_parse_jump_hops() {
        let raw = r#"{
            "id": "ssh-1", "profileId": "p1", "host": "target", "port": 22,
            "user": "root", "auth": "auto", "keyId": null, "cols": 80, "rows": 24,
            "jumpHops": [{ "id": "ssh-1:jump0", "profileId": "pj", "host": "bastion",
                           "port": 2222, "user": "ops", "auth": "agent", "keyId": "k1" }]
        }"#;
        let options: SshConnectOptions = serde_json::from_str(raw).unwrap();
        let hops = options.jump_hops.expect("jump hops parsed");
        assert_eq!(hops.len(), 1);
        assert_eq!(hops[0].id, "ssh-1:jump0");
        assert_eq!(hops[0].profile_id, "pj");
        assert_eq!(hops[0].host, "bastion");
        assert_eq!(hops[0].port, 2222);
        assert_eq!(hops[0].user, "ops");
        assert_eq!(hops[0].auth, "agent");
        assert_eq!(hops[0].key_id.as_deref(), Some("k1"));
    }

    /// connect_options_jump_hops_optional：旧前端负载不携带 jumpHops 时解析为直连
    #[test]
    fn connect_options_jump_hops_optional() {
        let raw = r#"{
            "id": "ssh-1", "profileId": "p1", "host": "target", "port": 22,
            "user": "root", "auth": "auto", "keyId": null, "cols": 80, "rows": 24
        }"#;
        let options: SshConnectOptions = serde_json::from_str(raw).unwrap();
        assert!(options.jump_hops.is_none());
    }
}
