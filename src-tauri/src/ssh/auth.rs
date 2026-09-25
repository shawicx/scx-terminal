//! @description SSH 认证策略链：agent → 密钥链条目 → 默认私钥 → 密码类（kbd-interactive
//!              优先 + 纯 password 兜底）；前端凭据挑战经事件 + oneshot 应答通道往返。

use std::sync::Arc;
use std::time::Duration;

use russh::keys::agent::client::AgentClient;
use russh::keys::{self, ssh_key, PrivateKeyWithHashAlg};
use russh::client;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use crate::secrets::{self, SecretsState};

use super::session::ScxHandler;
use super::{KbdWaiters, SshConnectOptions};

/// kbd-interactive 挑战弹窗等待上限：留足 MFA（短信/验证器）取证时间
const KBD_CHALLENGE_TIMEOUT: Duration = Duration::from_secs(300);

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
    kbd_waiters: &KbdWaiters,
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
    kbd_waiters: &KbdWaiters,
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
    kbd_waiters: &KbdWaiters,
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
pub(super) async fn authenticate(
    handle: &mut client::Handle<ScxHandler>,
    secrets: &SecretsState,
    options: &SshConnectOptions,
    app: &AppHandle,
    kbd_waiters: &KbdWaiters,
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
