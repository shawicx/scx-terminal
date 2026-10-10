//! @description SFTP 传输任务中心：上传/下载统一注册进 TransferManager，任务快照经
//!              app 级事件 `sftp-transfers-changed` 全量广播（进度按 ≥1MB 步进节流），
//!              支持取消（AtomicBool 标志注入传输循环）、暂停/继续/重试与目录递归传输
//!              （先 walk 统计总量、单任务聚合进度）；同一 SSH 连接内任务按 FIFO 排队、
//!              限并发执行（信号量）；断点续传以 `.scxpart` 部分文件为载体（resume 模块），
//!              暂停/取消/出错后保留部分文件，继续/重试时从断点偏移续传；
//!              终态任务保留最近 MAX_HISTORY 条历史供传输中心回看。

mod plan;
mod pump;
mod resume;

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::sftp::SftpHandle;

/// 传输分块大小（与旧 sftp.rs 分块语义一致）
const TRANSFER_CHUNK: usize = 256 * 1024;
/// 进度广播节流：每 ≥1MB 或状态变化时发一次
const PROGRESS_STEP: u64 = 1024 * 1024;
/// 终态任务历史保留条数上限（超出按完成时间淘汰最旧）
pub(crate) const MAX_HISTORY: usize = 100;
/// 同一 SSH 连接的并发传输上限（超出任务排队等待，FIFO）
pub(crate) const MAX_CONCURRENT_PER_SSH: usize = 2;

/// 传输方向（serde 小写：upload | download）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferKind {
    Upload,
    Download,
}

/// 传输任务快照（事件 / 查询负载；camelCase 对齐前端）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferSnapshot {
    pub id: String,
    pub kind: TransferKind,
    pub ssh_id: String,
    pub file_name: String,
    pub local_path: String,
    pub remote_path: String,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    /// queued | running | paused | done | error | canceled
    pub status: String,
    pub error: Option<String>,
    pub started_at: u64,
    pub finished_at: Option<u64>,
}

/// 任务执行参数（resume / retry 复活任务时重新 spawn 所需的全部输入）
#[derive(Clone)]
pub(crate) struct JobSpec {
    pub handle: Arc<SftpHandle>,
    pub kind: TransferKind,
    pub source_root: String,
    pub target_root: String,
}

/// 传输条目：快照（Mutex 内可变）+ 取消/暂停标志（任务循环每分块检查）+
///           执行参数（终态失败/暂停后保留，供继续/重试）+ 运行守卫与序号
pub(crate) struct TransferEntry {
    pub(super) snapshot: Mutex<TransferSnapshot>,
    pub(super) cancel: AtomicBool,
    pub(super) pause: AtomicBool,
    /// 任务循环存活标志（requeue 拒绝在旧循环退出前复活，避免双写）
    pub(super) active: AtomicBool,
    /// 任务循环序号（每次 spawn 自增；循环检测序号变化即让位）
    pub(super) generation: AtomicU64,
    pub(super) job: Mutex<Option<JobSpec>>,
}

/// 传输计划条目：目录（建目录）或文件（分块拷贝 + 计入聚合进度）
pub(crate) enum PlanItem {
    Dir { local: String, remote: String },
    File { local: String, remote: String, size: u64 },
}

/// 分块拷贝错误：Canceled/Paused 由标志触发（状态已由对应命令置位，不覆盖），
/// Failed 携带文本
pub(crate) enum PumpError {
    Canceled,
    Paused,
    Failed(String),
}

/// 全局传输管理器（对标 SftpManager / ForwardManager 模式）
#[derive(Default)]
pub struct TransferManager {
    entries: Mutex<HashMap<String, Arc<TransferEntry>>>,
    /// ssh_id → 并发信号量（同连接限 MAX_CONCURRENT_PER_SSH 路任务）
    permits: Mutex<HashMap<String, Arc<Semaphore>>>,
}

pub(crate) fn now_ms () -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(0))
        .unwrap_or(0)
}

pub(crate) fn is_terminal (status: &str) -> bool {
    matches!(status, "done" | "error" | "canceled")
}

/**
 * @description 传输循环的停机原因：取消或暂停标志命中（plan walk / pump 拷贝逐块检查）
 * @param entry 任务条目
 * @returns Option<PumpError> Some(Canceled/Paused) 表示应立即停止
 *
 * @example if let Some(err) = stop_reason(&entry) { return Err(err) }
 *
 */
pub(crate) fn stop_reason (entry: &TransferEntry) -> Option<PumpError> {
    if entry.cancel.load(Ordering::Acquire) {
        Some(PumpError::Canceled)
    } else if entry.pause.load(Ordering::Acquire) {
        Some(PumpError::Paused)
    } else {
        None
    }
}

/// 远端路径拼接（与 sftp.rs entry_from 语义一致：根目录不加双斜杠）
pub(crate) fn join_remote (parent: &str, name: &str) -> String {
    if parent.ends_with('/') {
        format!("{parent}{name}")
    } else {
        format!("{parent}/{name}")
    }
}

/// 本地路径拼接（PathBuf 语义；字符串形式回传前端）
pub(crate) fn join_local (parent: &str, name: &str) -> String {
    Path::new(parent).join(name).to_string_lossy().to_string()
}

/// 路径最后一段（传输任务展示名）
pub(crate) fn base_name (path: &str) -> String {
    path.rsplit('/').find(|s| !s.is_empty()).unwrap_or(path).to_string()
}

pub(crate) fn failed (e: String) -> PumpError {
    PumpError::Failed(e)
}

impl TransferManager {
    pub fn new () -> Self {
        Self::default()
    }

    /**
     * @description 取指定连接的并发信号量（无则按 MAX_CONCURRENT_PER_SSH 创建）
     * @param ssh_id SSH 连接 id
     * @returns Arc<Semaphore> 信号量（acquire_owned 后持有至任务结束）
     *
     * @example let permit = manager.permit("ssh-1").acquire_owned().await.unwrap()
     *
     */
    pub(crate) fn permit (&self, ssh_id: &str) -> Arc<Semaphore> {
        self.permits
            .lock()
            .unwrap()
            .entry(ssh_id.to_string())
            .or_insert_with(|| Arc::new(Semaphore::new(MAX_CONCURRENT_PER_SSH)))
            .clone()
    }

    /**
     * @description 注册传输任务（初始 queued 状态，附执行参数供继续/重试复活）；调用方随后广播快照
     * @param kind 传输方向
     * @param ssh_id 归属 SSH 连接 id
     * @param file_name 展示文件名（源路径最后一段）
     * @param local_path 本地侧路径
     * @param remote_path 远端侧路径
     * @returns (String, Arc<TransferEntry>) 任务 id 与条目（任务循环持有）
     *
     * @example let (id, entry) = manager.register(TransferKind::Upload, "ssh-1", "a.txt", "/tmp/a.txt", "/srv/a.txt")
     *
     */
    pub(crate) fn register (
        &self,
        kind: TransferKind,
        ssh_id: &str,
        file_name: &str,
        local_path: &str,
        remote_path: &str,
    ) -> (String, Arc<TransferEntry>) {
        let entry = Arc::new(TransferEntry {
            snapshot: Mutex::new(TransferSnapshot {
                id: format!("tr-{}", Uuid::new_v4()),
                kind,
                ssh_id: ssh_id.to_string(),
                file_name: file_name.to_string(),
                local_path: local_path.to_string(),
                remote_path: remote_path.to_string(),
                total_bytes: 0,
                transferred_bytes: 0,
                status: "queued".to_string(),
                error: None,
                started_at: now_ms(),
                finished_at: None,
            }),
            cancel: AtomicBool::new(false),
            pause: AtomicBool::new(false),
            active: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            job: Mutex::new(None),
        });
        let id = entry.snapshot.lock().unwrap().id.clone();
        self.entries.lock().unwrap().insert(id.clone(), entry.clone());
        (id, entry)
    }

    /**
     * @description 挂载任务执行参数（register 后、spawn 前调用；继续/重试复活依赖）
     * @param entry 任务条目
     * @param job 执行参数（SFTP 句柄 + 方向 + 源/目标根路径）
     * @returns ()
     *
     * @example manager.set_job(&entry, job)
     *
     */
    pub(crate) fn set_job (&self, entry: &TransferEntry, job: JobSpec) {
        *entry.job.lock().unwrap() = Some(job);
    }

    /**
     * @description 受保护的快照变更：终态（done/error/canceled）后拒绝再改——
     *              取消后到达的迟到错误不覆盖 canceled，finish 不覆盖 error
     * @param entry 任务条目
     * @param mutate 变更闭包
     * @returns bool 是否实际变更（false = 已终态被拒）
     *
     * @example manager.mutate(&entry, |s| s.transferred_bytes = 42)
     *
     */
    pub(crate) fn mutate (&self, entry: &TransferEntry, mutate: impl FnOnce(&mut TransferSnapshot)) -> bool {
        let mut snapshot = entry.snapshot.lock().unwrap();
        if is_terminal(&snapshot.status) {
            return false;
        }
        mutate(&mut snapshot);
        true
    }

    /**
     * @description 全部任务快照（活动在前、终态在后；同组按开始时间新→旧）
     * @param ssh_id 可选过滤（某连接的任务）
     * @returns Vec<TransferSnapshot>
     *
     * @example let list = manager.snapshots(None)
     *
     */
    pub(crate) fn snapshots (&self, ssh_id: Option<&str>) -> Vec<TransferSnapshot> {
        let mut list: Vec<TransferSnapshot> = self
            .entries
            .lock()
            .unwrap()
            .values()
            .filter(|entry| {
                ssh_id
                    .map(|id| entry.snapshot.lock().unwrap().ssh_id == id)
                    .unwrap_or(true)
            })
            .map(|entry| entry.snapshot.lock().unwrap().clone())
            .collect();
        list.sort_by(|a, b| {
            is_terminal(&a.status)
                .cmp(&is_terminal(&b.status))
                .then_with(|| b.started_at.cmp(&a.started_at))
                .then_with(|| a.id.cmp(&b.id))
        });
        list
    }

    /**
     * @description 请求取消：置取消标志并把非终态任务标记为 canceled（循环随后自行退出）
     * @param id 任务 id
     * @returns bool 是否命中且取消成功
     *
     * @example manager.cancel(&id)
     *
     */
    fn cancel (&self, id: &str) -> bool {
        let Some(entry) = self.entries.lock().unwrap().get(id).cloned() else {
            return false;
        };
        entry.cancel.store(true, Ordering::Release);
        self.mutate(&entry, |snapshot| {
            snapshot.status = "canceled".to_string();
            snapshot.finished_at = Some(now_ms());
        })
    }

    /**
     * @description 请求暂停：置暂停标志并把非终态任务标记为 paused（循环随后自行退出，
     *              部分文件保留在目标侧）
     * @param id 任务 id
     * @returns bool 是否命中且暂停成功
     *
     * @example manager.pause(&id)
     *
     */
    fn pause (&self, id: &str) -> bool {
        let Some(entry) = self.entries.lock().unwrap().get(id).cloned() else {
            return false;
        };
        entry.pause.store(true, Ordering::Release);
        self.mutate(&entry, |snapshot| {
            snapshot.status = "paused".to_string();
            snapshot.finished_at = None;
        })
    }

    /**
     * @description 复活任务（继续/重试共用）：校验当前状态在允许集合内且旧循环已退出，
     *              复位标志、状态回 queued、清错误，返回执行参数供重新 spawn。
     *              终态（error/canceled）不经 mutate（其终态保护会拒绝），直接持锁改写
     * @param id 任务 id
     * @param allowed 允许复活的当前状态集合（resume=["paused"]；retry=["error","canceled"]）
     * @returns Option<(Arc<TransferEntry>, JobSpec)> 复活失败（状态不符/循环未退/无参数）为 None
     *
     * @example if let Some((entry, job)) = manager.requeue(&id, &["paused"]) { /* respawn */ }
     *
     */
    fn requeue (&self, id: &str, allowed: &[&str]) -> Option<(Arc<TransferEntry>, JobSpec)> {
        let entry = self.entries.lock().unwrap().get(id).cloned()?;
        if entry.active.load(Ordering::Acquire) {
            return None; // 旧循环尚未退出，拒绝并发复活（防双写）
        }
        // 先取执行参数（缺失则不动任何状态）
        let job = entry.job.lock().unwrap().clone()?;
        {
            let mut snapshot = entry.snapshot.lock().unwrap();
            if !allowed.contains(&snapshot.status.as_str()) {
                return None;
            }
            snapshot.status = "queued".to_string();
            snapshot.error = None;
            snapshot.finished_at = None;
        }
        entry.cancel.store(false, Ordering::Release);
        entry.pause.store(false, Ordering::Release);
        Some((entry, job))
    }

    /**
     * @description 清除终态任务（传输中心「全部清除」；不影响进行中任务）
     * @param ssh_id 可选过滤（某连接的任务）
     * @returns void
     *
     * @example manager.clear(Some("ssh-1"))
     *
     */
    fn clear (&self, ssh_id: Option<&str>) {
        self.entries
            .lock()
            .unwrap()
            .retain(|_, entry| {
                let snapshot = entry.snapshot.lock().unwrap();
                let terminal = is_terminal(&snapshot.status);
                let matched = ssh_id
                    .map(|id| snapshot.ssh_id == id)
                    .unwrap_or(true);
                !(terminal && matched)
            });
    }

    /**
     * @description 终态历史淘汰：超过 MAX_HISTORY 条时按完成时间移除最旧
     * @returns void
     *
     * @example manager.trim_history()
     *
     */
    fn trim_history (&self) {
        let mut entries = self.entries.lock().unwrap();
        let mut terminal: Vec<(String, u64)> = entries
            .iter()
            .filter(|(_, entry)| is_terminal(&entry.snapshot.lock().unwrap().status))
            .map(|(id, entry)| {
                let snapshot = entry.snapshot.lock().unwrap();
                (id.clone(), snapshot.finished_at.unwrap_or(snapshot.started_at))
            })
            .collect();
        if terminal.len() <= MAX_HISTORY {
            return;
        }
        terminal.sort_by_key(|(_, finished)| *finished);
        let excess = terminal.len() - MAX_HISTORY;
        for (id, _) in terminal.into_iter().take(excess) {
            entries.remove(&id);
        }
    }
}

/// 广播全部任务快照（app 级事件；未注册 TransferManager 时为 no-op，便于单测）
pub(crate) fn emit_all (app: &AppHandle) {
    if let Some(manager) = app.try_state::<TransferManager>() {
        let _ = app.emit("sftp-transfers-changed", manager.snapshots(None));
    }
}

/// 变更并广播（run_task 主路径用的组合便捷函数）
pub(super) fn advance (app: &AppHandle, manager: &TransferManager, entry: &TransferEntry, mutate: impl FnOnce(&mut TransferSnapshot)) {
    if manager.mutate(entry, mutate) {
        emit_all(app);
    }
}

/**
 * @description 启动下载任务：注册（queued）→ 后台排队（信号量）→ 统计（远端 stat/递归
 *              walk）→ 逐条执行（断点续传）→ 终态收尾；立即返回任务 id，进度与结果经
 *              `sftp-transfers-changed` 事件广播
 * @param app AppHandle（事件发射 / 取消 TransferManager）
 * @param handle SFTP 会话（任务期间持有）
 * @param remote_path 远端源路径（文件或目录）
 * @param local_path 本地目标路径（文件或目录，与源同形）
 * @returns String 传输任务 id
 *
 * @example let id = start_download(&app, handle, "/srv/app.tar.gz", "/Users/scx/Downloads/app.tar.gz")
 *
 */
pub(crate) fn start_download (
    app: &AppHandle,
    handle: Arc<SftpHandle>,
    remote_path: String,
    local_path: String,
) -> String {
    let manager = app.state::<TransferManager>();
    let job = JobSpec {
        handle: handle.clone(),
        kind: TransferKind::Download,
        source_root: remote_path.clone(),
        target_root: local_path.clone(),
    };
    let (id, entry) = manager.register(
        TransferKind::Download,
        &handle.ssh_id,
        &base_name(&remote_path),
        &local_path,
        &remote_path,
    );
    manager.set_job(&entry, job);
    emit_all(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run_task(app, entry).await;
    });
    id
}

/**
 * @description 启动上传任务（语义同 start_download，方向相反）
 * @param app AppHandle（事件发射 / 取消 TransferManager）
 * @param handle SFTP 会话（任务期间持有）
 * @param local_path 本地源路径（文件或目录）
 * @param remote_path 远端目标路径（与源同形）
 * @returns String 传输任务 id
 *
 * @example let id = start_upload(&app, handle, "/Users/scx/app.tar.gz", "/srv/app.tar.gz")
 *
 */
pub(crate) fn start_upload (
    app: &AppHandle,
    handle: Arc<SftpHandle>,
    local_path: String,
    remote_path: String,
) -> String {
    let manager = app.state::<TransferManager>();
    let job = JobSpec {
        handle: handle.clone(),
        kind: TransferKind::Upload,
        source_root: local_path.clone(),
        target_root: remote_path.clone(),
    };
    let (id, entry) = manager.register(
        TransferKind::Upload,
        &handle.ssh_id,
        &base_name(&local_path),
        &local_path,
        &remote_path,
    );
    manager.set_job(&entry, job);
    emit_all(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run_task(app, entry).await;
    });
    id
}

/**
 * @description 任务主体：取连接并发许可（FIFO 排队）→ 建计划（统计总量）→ 执行（分块
 *              拷贝 + 断点续传 + 进度）→ 终态收尾 + 历史淘汰。generation 用于复活任务
 *              时旧循环让位（同 id 并发 spawn 时只认最新一代）
 * @param app AppHandle（事件发射 / 取消 TransferManager）
 * @param entry 任务条目（执行参数从 entry.job 取）
 * @returns ()
 *
 * @example tauri::async_runtime::spawn(async move { run_task(app, entry).await })
 *
 */
async fn run_task (app: AppHandle, entry: Arc<TransferEntry>) {
    entry.generation.fetch_add(1, Ordering::AcqRel);
    let generation = entry.generation.load(Ordering::Acquire);
    entry.active.store(true, Ordering::Release);

    let finish = |entry: &TransferEntry| {
        // 当前代已让位（被复活取代）时不清理 active，避免覆盖新循环
        if entry.generation.load(Ordering::Acquire) == generation {
            entry.active.store(false, Ordering::Release);
        }
    };

    let manager = app.state::<TransferManager>();
    let ssh_id = entry.snapshot.lock().unwrap().ssh_id.clone();
    // 连接级并发许可：超出 MAX_CONCURRENT_PER_SSH 的任务在此 FIFO 排队（保持 queued）
    let _permit = manager.permit(&ssh_id).acquire_owned().await;
    // 排队期间被取消/暂停（或被新一代取代）：状态已由对应命令置位，直接退出
    if entry.generation.load(Ordering::Acquire) != generation || stop_reason(&entry).is_some() {
        finish(&entry);
        return;
    }
    advance(&app, &manager, &entry, |snapshot| snapshot.status = "running".to_string());

    let Some((handle, kind, source_root, target_root)) = entry
        .job
        .lock()
        .unwrap()
        .as_ref()
        .map(|job| (job.handle.clone(), job.kind, job.source_root.clone(), job.target_root.clone()))
    else {
        advance(&app, &manager, &entry, |snapshot| {
            snapshot.status = "error".to_string();
            snapshot.error = Some("job spec missing".to_string());
            snapshot.finished_at = Some(now_ms());
        });
        finish(&entry);
        return;
    };

    let plan = match kind {
        TransferKind::Download => plan::build_download_plan(&handle.sftp, &source_root, &target_root, &entry).await,
        TransferKind::Upload => plan::build_upload_plan(&source_root, &target_root).await,
    };
    let plan = match plan {
        Ok(plan) => plan,
        Err(PumpError::Canceled) | Err(PumpError::Paused) => {
            finish(&entry);
            return;
        }
        Err(PumpError::Failed(error)) => {
            advance(&app, &manager, &entry, |snapshot| {
                snapshot.status = "error".to_string();
                snapshot.error = Some(error);
                snapshot.finished_at = Some(now_ms());
            });
            manager.trim_history();
            finish(&entry);
            return;
        }
    };

    let total: u64 = plan
        .iter()
        .map(|item| match item {
            PlanItem::File { size, .. } => *size,
            PlanItem::Dir { .. } => 0,
        })
        .sum();
    advance(&app, &manager, &entry, |snapshot| snapshot.total_bytes = total);

    let result = pump::execute_plan(&app, &manager, &handle.sftp, &entry, kind, plan).await;
    match result {
        Ok(()) => {
            advance(&app, &manager, &entry, |snapshot| {
                snapshot.status = "done".to_string();
                snapshot.finished_at = Some(now_ms());
            });
            // 完成即释放执行参数（终态任务无需复活）
            *entry.job.lock().unwrap() = None;
        }
        // 取消/暂停：状态已由对应命令置位，部分文件保留，这里不再变更
        Err(PumpError::Canceled) | Err(PumpError::Paused) => {}
        Err(PumpError::Failed(error)) => {
            advance(&app, &manager, &entry, |snapshot| {
                snapshot.status = "error".to_string();
                snapshot.error = Some(error);
                snapshot.finished_at = Some(now_ms());
            });
        }
    }
    manager.trim_history();
    finish(&entry);
}

/// 查询传输任务（传输中心全量拉取；可按连接过滤）
///
/// # Arguments
///
/// * `manager` - 传输管理器
/// * `ssh_id` - 可选 SSH 连接 id 过滤
///
/// # Returns
///
/// Vec<TransferSnapshot>（活动在前、终态在后；同组开始时间新→旧）
///
/// # Examples
///
/// `invoke('sftp_transfers', { sshId: null })`
#[tauri::command]
pub fn sftp_transfers (manager: State<'_, TransferManager>, ssh_id: Option<String>) -> Vec<TransferSnapshot> {
    manager.snapshots(ssh_id.as_deref())
}

/// 请求取消一条传输任务（排队/进行中/已暂停均可取消；部分文件保留，可重试续传）
///
/// # Arguments
///
/// * `app` - AppHandle（事件发射）
/// * `manager` - 传输管理器
/// * `id` - 传输任务 id
///
/// # Returns
///
/// `()`；任务不存在返回错误
///
/// # Examples
///
/// `invoke('sftp_transfer_cancel', { id })`
#[tauri::command]
pub fn sftp_transfer_cancel (app: AppHandle, manager: State<'_, TransferManager>, id: String) -> Result<(), String> {
    if manager.cancel(&id) {
        emit_all(&app);
        Ok(())
    } else {
        Err(format!("transfer {id} not found or already finished"))
    }
}

/// 请求暂停一条传输任务（排队/进行中可暂停；部分文件保留在目标侧供续传）
///
/// # Arguments
///
/// * `app` - AppHandle（事件发射）
/// * `manager` - 传输管理器
/// * `id` - 传输任务 id
///
/// # Returns
///
/// `()`；任务不存在/已终态返回错误
///
/// # Examples
///
/// `invoke('sftp_transfer_pause', { id })`
#[tauri::command]
pub fn sftp_transfer_pause (app: AppHandle, manager: State<'_, TransferManager>, id: String) -> Result<(), String> {
    if manager.pause(&id) {
        emit_all(&app);
        Ok(())
    } else {
        Err(format!("transfer {id} not found or already finished"))
    }
}

/// 继续一条已暂停的传输任务（从 `.scxpart` 部分文件断点续传）
///
/// # Arguments
///
/// * `app` - AppHandle（事件发射 + 重新 spawn 任务循环）
/// * `manager` - 传输管理器
/// * `id` - 传输任务 id
///
/// # Returns
///
/// `()`；任务不存在/非 paused/旧循环未退出返回错误
///
/// # Examples
///
/// `invoke('sftp_transfer_resume', { id })`
#[tauri::command]
pub fn sftp_transfer_resume (app: AppHandle, manager: State<'_, TransferManager>, id: String) -> Result<(), String> {
    revive_transfer(&app, &manager, &id, &["paused"], "paused")
}

/// 重试一条失败/已取消的传输任务（同样走断点续传，已完成部分不重传）
///
/// # Arguments
///
/// * `app` - AppHandle（事件发射 + 重新 spawn 任务循环）
/// * `manager` - 传输管理器
/// * `id` - 传输任务 id
///
/// # Returns
///
/// `()`；任务不存在/非 error|canceled/旧循环未退出返回错误
///
/// # Examples
///
/// `invoke('sftp_transfer_retry', { id })`
#[tauri::command]
pub fn sftp_transfer_retry (app: AppHandle, manager: State<'_, TransferManager>, id: String) -> Result<(), String> {
    revive_transfer(&app, &manager, &id, &["error", "canceled"], "failed or canceled")
}

/**
 * @description 复活任务公共实现：requeue 校验状态并复位 → 广播 → 重新 spawn run_task
 * @param app AppHandle
 * @param manager 传输管理器
 * @param id 任务 id
 * @param allowed 允许复活的当前状态集合
 * @param expected 错误信息中描述的期望状态（中文提示语由前端 i18n 呈现，这里仅英文诊断）
 * @returns Result<(), String> 复活失败返回错误文本
 *
 * @example revive_transfer(&app, &manager, &id, &["paused"], "paused")
 *
 */
fn revive_transfer (app: &AppHandle, manager: &TransferManager, id: &str, allowed: &[&str], expected: &str) -> Result<(), String> {
    let Some((entry, _job)) = manager.requeue(id, allowed) else {
        return Err(format!("transfer {id} not found, not {expected}, or still stopping"));
    };
    emit_all(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run_task(app, entry).await;
    });
    Ok(())
}

/// 清除终态传输任务（不影响进行中任务）
///
/// # Arguments
///
/// * `app` - AppHandle（事件发射）
/// * `manager` - 传输管理器
/// * `ssh_id` - 可选 SSH 连接 id 过滤
///
/// # Examples
///
/// `invoke('sftp_transfers_clear', { sshId: null })`
#[tauri::command]
pub fn sftp_transfers_clear (app: AppHandle, manager: State<'_, TransferManager>, ssh_id: Option<String>) {
    manager.clear(ssh_id.as_deref());
    emit_all(&app);
}

#[cfg(test)]
mod tests;
