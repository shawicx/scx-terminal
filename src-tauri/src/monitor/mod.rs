//! SSH 服务器监控：采样任务管理（MonitorManager）与 IPC 命令
//!（monitor_start / monitor_stop）；采样命令拼装与 /proc 输出解析见 parse 子模块。

mod parse;

#[cfg(test)]
mod tests;

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, State};

use crate::ssh::SshManager;

use parse::{build_command, parse_sample, ParseOutcome, PrevCounters};

/// 采样等级：card = 5s 核心指标；full = 2s 核心 + 每 3 轮低频组
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MonitorLevel {
    Card,
    Full,
}

/// monitor-sample 事件 payload
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SampleEvent {
    profile_id: String,
    sample: parse::MonitorSample,
}

/// monitor-sample-error / monitor-fatal / monitor-unsupported 事件 payload
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorEvent {
    profile_id: String,
    message: String,
}

/// 按档案索引的采样任务管理器（profileId → spawn 句柄 + 代次，abort 即取消）
///
/// 任务表条目携带随每次启动递增的 generation；任务自清理（fatal/unsupported）
/// 仅当表中代次与自身一致才移除，防止旧任务迟滞 remove 误删重启后的新条目。
#[derive(Default)]
pub struct MonitorManager {
    tasks: Arc<Mutex<std::collections::HashMap<String, (JoinHandle<()>, u64)>>>,
    next_gen: std::sync::atomic::AtomicU64,
}

impl MonitorManager {
    pub fn new() -> Self {
        Self::default()
    }
}

/// 当前毫秒时间戳
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 启动（或重启）档案的采样任务
///
/// # Arguments
///
/// * `app` - AppHandle（事件发射）
/// * `ssh` - SSH 会话管理器
/// * `manager` - 监控任务管理器
/// * `profile_id` - 档案 id
/// * `ssh_id` - 采样的 SSH 连接 id
/// * `level` - 采样等级
///
/// # Returns
///
/// Ok(())；档案不存在连接返回 Err
///
/// # Examples
///
/// `invoke('monitor_start', { profileId, sshId, level: 'full' })`
#[tauri::command]
pub async fn monitor_start(
    app: AppHandle,
    ssh: State<'_, SshManager>,
    manager: State<'_, MonitorManager>,
    profile_id: String,
    ssh_id: String,
    level: MonitorLevel,
) -> Result<(), String> {
    if ssh.session(&ssh_id).is_none() {
        return Err(format!("ssh session {ssh_id} not found"));
    }
    let sessions = ssh.sessions_arc();
    let tasks = manager.tasks.clone();
    let interval = match level {
        MonitorLevel::Card => Duration::from_secs(5),
        MonitorLevel::Full => Duration::from_secs(2),
    };
    // spawn 闭包按 move 捕获 profile_id；任务表键需在 move 前克隆
    let task_key = profile_id.clone();
    // 已有任务先取消（升级/降级统一走重启）；remove→abort→分配代次→spawn→insert
    // 全程单一临界区（spawn 同步不阻塞，持 std Mutex 守卫安全；守卫在返回前
    // 显式释放，不跨任何 await），防止并发 start 交错覆盖句柄或旧任务迟滞
    // remove 误删新条目
    let mut tasks_map = manager.tasks.lock().unwrap();
    if let Some((old, _)) = tasks_map.remove(&profile_id) {
        old.abort();
    }
    let my_gen = manager
        .next_gen
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let handle = tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        ticker.tick().await; // interval 首个 tick 立即返回，跳过后进入节奏
        let mut prev: Option<PrevCounters> = None;
        let mut round: u32 = 0;
        loop {
            ticker.tick().await;
            let Some(session) = sessions.lock().unwrap().get(&ssh_id).cloned() else {
                let _ = app.emit(
                    "monitor-fatal",
                    MonitorEvent {
                        profile_id: profile_id.clone(),
                        message: "ssh session closed".into(),
                    },
                );
                // 代次守卫：仅当表中仍是本任务代次才移除，防误删重启后的新条目
                let mut tasks = tasks.lock().unwrap();
                if tasks.get(&profile_id).map(|(_, g)| *g == my_gen).unwrap_or(false) {
                    tasks.remove(&profile_id);
                }
                return;
            };
            let with_low = level == MonitorLevel::Full && round % 3 == 0;
            let cmd = build_command(with_low, round == 0);
            match session.exec_command(&cmd, Duration::from_secs(10)).await {
                Ok(raw) => match parse_sample(&raw, prev.as_ref(), now_ms()) {
                    Ok(ParseOutcome::Sample(sample, counters)) => {
                        prev = Some(counters);
                        let _ = app.emit(
                            "monitor-sample",
                            SampleEvent {
                                profile_id: profile_id.clone(),
                                sample: *sample,
                            },
                        );
                    }
                    Ok(ParseOutcome::Unsupported) => {
                        let _ = app.emit(
                            "monitor-unsupported",
                            MonitorEvent {
                                profile_id: profile_id.clone(),
                                message: "unsupported platform".into(),
                            },
                        );
                        // 代次守卫：仅当表中仍是本任务代次才移除，防误删重启后的新条目
                        let mut tasks = tasks.lock().unwrap();
                        if tasks.get(&profile_id).map(|(_, g)| *g == my_gen).unwrap_or(false) {
                            tasks.remove(&profile_id);
                        }
                        return;
                    }
                    Err(e) => {
                        let _ = app.emit(
                            "monitor-sample-error",
                            MonitorEvent {
                                profile_id: profile_id.clone(),
                                message: e,
                            },
                        );
                    }
                },
                Err(e) => {
                    let _ = app.emit(
                        "monitor-sample-error",
                        MonitorEvent {
                            profile_id: profile_id.clone(),
                            message: e,
                        },
                    );
                }
            }
            round += 1;
        }
    });
    tasks_map.insert(task_key, (handle, my_gen));
    drop(tasks_map);
    Ok(())
}

/// 停止档案的采样任务
///
/// # Arguments
///
/// * `manager` - 监控任务管理器
/// * `profile_id` - 档案 id
///
/// # Returns
///
/// Ok(())（无任务为幂等 no-op）
///
/// # Examples
///
/// `invoke('monitor_stop', { profileId })`
#[tauri::command]
pub fn monitor_stop(manager: State<'_, MonitorManager>, profile_id: String) -> Result<(), String> {
    if let Some((task, _)) = manager.tasks.lock().unwrap().remove(&profile_id) {
        task.abort();
    }
    Ok(())
}
