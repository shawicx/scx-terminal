//! @description SFTP 传输任务中心：上传/下载统一注册进 TransferManager，任务快照经
//!              app 级事件 `sftp-transfers-changed` 全量广播（进度按 ≥1MB 步进节流），
//!              支持取消（AtomicBool 标志注入传输循环）与目录递归传输（先 walk 统计总量、
//!              单任务聚合进度）；终态任务保留最近 MAX_HISTORY 条历史供传输中心回看。

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

use crate::sftp::SftpHandle;

/// 传输分块大小（与旧 sftp.rs 分块语义一致）
const TRANSFER_CHUNK: usize = 256 * 1024;
/// 进度广播节流：每 ≥1MB 或状态变化时发一次
const PROGRESS_STEP: u64 = 1024 * 1024;
/// 终态任务历史保留条数上限（超出按完成时间淘汰最旧）
const MAX_HISTORY: usize = 100;

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
    /// queued | running | done | error | canceled
    pub status: String,
    pub error: Option<String>,
    pub started_at: u64,
    pub finished_at: Option<u64>,
}

/// 传输条目：快照（Mutex 内可变）+ 取消标志（任务循环每分块检查）
struct TransferEntry {
    snapshot: Mutex<TransferSnapshot>,
    cancel: AtomicBool,
}

/// 传输计划条目：目录（建目录）或文件（分块拷贝 + 计入聚合进度）
enum PlanItem {
    Dir { local: String, remote: String },
    File { local: String, remote: String, size: u64 },
}

/// 分块拷贝错误：Canceled 由取消标志触发（状态已由 cancel 置位，不覆盖），Failed 携带文本
enum PumpError {
    Canceled,
    Failed(String),
}

/// 全局传输管理器（对标 SftpManager / ForwardManager 模式）
#[derive(Default)]
pub struct TransferManager {
    entries: Mutex<HashMap<String, Arc<TransferEntry>>>,
}

fn now_ms () -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(0))
        .unwrap_or(0)
}

fn is_terminal (status: &str) -> bool {
    matches!(status, "done" | "error" | "canceled")
}

/// 远端路径拼接（与 sftp.rs entry_from 语义一致：根目录不加双斜杠）
fn join_remote (parent: &str, name: &str) -> String {
    if parent.ends_with('/') {
        format!("{parent}{name}")
    } else {
        format!("{parent}/{name}")
    }
}

/// 本地路径拼接（PathBuf 语义；字符串形式回传前端）
fn join_local (parent: &str, name: &str) -> String {
    Path::new(parent).join(name).to_string_lossy().to_string()
}

/// 路径最后一段（传输任务展示名）
fn base_name (path: &str) -> String {
    path.rsplit('/').find(|s| !s.is_empty()).unwrap_or(path).to_string()
}

fn failed (e: String) -> PumpError {
    PumpError::Failed(e)
}

impl TransferManager {
    pub fn new () -> Self {
        Self::default()
    }

    /**
     * @description 注册传输任务（初始 queued 状态）；调用方随后广播快照
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
    fn register (
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
        });
        let id = entry.snapshot.lock().unwrap().id.clone();
        self.entries.lock().unwrap().insert(id.clone(), entry.clone());
        (id, entry)
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
    fn mutate (&self, entry: &TransferEntry, mutate: impl FnOnce(&mut TransferSnapshot)) -> bool {
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
    fn snapshots (&self, ssh_id: Option<&str>) -> Vec<TransferSnapshot> {
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
fn emit_all (app: &AppHandle) {
    if let Some(manager) = app.try_state::<TransferManager>() {
        let _ = app.emit("sftp-transfers-changed", manager.snapshots(None));
    }
}

/// 变更并广播（run_task 主路径用的组合便捷函数）
fn advance (app: &AppHandle, manager: &TransferManager, entry: &TransferEntry, mutate: impl FnOnce(&mut TransferSnapshot)) {
    if manager.mutate(entry, mutate) {
        emit_all(app);
    }
}

/**
 * @description 启动下载任务：注册（queued）→ 后台统计（远端 stat/递归 walk）→ 逐条执行 →
 *              终态收尾；立即返回任务 id，进度与结果经 `sftp-transfers-changed` 事件广播
 * @param app AppHandle（事件发射 / 取回 TransferManager）
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
    let (id, entry) = manager.register(
        TransferKind::Download,
        &handle.ssh_id,
        &base_name(&remote_path),
        &local_path,
        &remote_path,
    );
    emit_all(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run_task(app, handle, entry, TransferKind::Download, remote_path, local_path).await;
    });
    id
}

/**
 * @description 启动上传任务（语义同 start_download，方向相反）
 * @param app AppHandle（事件发射 / 取回 TransferManager）
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
    let (id, entry) = manager.register(
        TransferKind::Upload,
        &handle.ssh_id,
        &base_name(&local_path),
        &local_path,
        &remote_path,
    );
    emit_all(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run_task(app, handle, entry, TransferKind::Upload, local_path, remote_path).await;
    });
    id
}

/// 任务主体：建计划（统计总量）→ 执行（分块拷贝 + 进度）→ 终态收尾 + 历史淘汰
async fn run_task (
    app: AppHandle,
    handle: Arc<SftpHandle>,
    entry: Arc<TransferEntry>,
    kind: TransferKind,
    source_root: String,
    target_root: String,
) {
    if entry.cancel.load(Ordering::Acquire) {
        return; // 排队期间已取消，状态已由 cancel() 置位
    }
    let manager = app.state::<TransferManager>();
    advance(&app, &manager, &entry, |snapshot| snapshot.status = "running".to_string());

    let plan = match kind {
        TransferKind::Download => build_download_plan(&handle.sftp, &source_root, &target_root, &entry).await,
        TransferKind::Upload => build_upload_plan(&source_root, &target_root).await,
    };
    let plan = match plan {
        Ok(plan) => plan,
        Err(PumpError::Canceled) => return,
        Err(PumpError::Failed(error)) => {
            advance(&app, &manager, &entry, |snapshot| {
                snapshot.status = "error".to_string();
                snapshot.error = Some(error);
                snapshot.finished_at = Some(now_ms());
            });
            manager.trim_history();
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

    let result = execute_plan(&app, &manager, &handle.sftp, &entry, kind, plan).await;
    match result {
        Ok(()) => {
            advance(&app, &manager, &entry, |snapshot| {
                snapshot.status = "done".to_string();
                snapshot.finished_at = Some(now_ms());
            });
        }
        // 取消：状态已由 cancel() 置位，这里不再变更
        Err(PumpError::Canceled) => {}
        Err(PumpError::Failed(error)) => {
            advance(&app, &manager, &entry, |snapshot| {
                snapshot.status = "error".to_string();
                snapshot.error = Some(error);
                snapshot.finished_at = Some(now_ms());
            });
        }
    }
    manager.trim_history();
}

/// 下载计划：单文件直传；目录递归 walk（远端侧收集，本地侧映射路径）
async fn build_download_plan (
    sftp: &SftpSession,
    remote_root: &str,
    local_root: &str,
    entry: &TransferEntry,
) -> Result<Vec<PlanItem>, PumpError> {
    let meta = sftp
        .metadata(remote_root)
        .await
        .map_err(|e| failed(format!("failed to stat {remote_root}: {e}")))?;
    if !meta.file_type().is_dir() {
        return Ok(vec![PlanItem::File {
            local: local_root.to_string(),
            remote: remote_root.to_string(),
            size: meta.size.unwrap_or(0),
        }]);
    }
    let mut plan = vec![PlanItem::Dir {
        local: local_root.to_string(),
        remote: remote_root.to_string(),
    }];
    walk_remote(sftp, remote_root, local_root, &mut plan, entry).await?;
    Ok(plan)
}

/// 远端目录递归（DFS 先序：父目录先入计划）；symlink 跳过避免环
async fn walk_remote (
    sftp: &SftpSession,
    remote_dir: &str,
    local_dir: &str,
    plan: &mut Vec<PlanItem>,
    entry: &TransferEntry,
) -> Result<(), PumpError> {
    let read_dir = sftp
        .read_dir(remote_dir)
        .await
        .map_err(|e| failed(format!("failed to list {remote_dir}: {e}")))?;
    for dir_entry in read_dir {
        if entry.cancel.load(Ordering::Acquire) {
            return Err(PumpError::Canceled);
        }
        let name = dir_entry.file_name();
        let meta = dir_entry.metadata();
        let file_type = meta.file_type();
        if file_type.is_symlink() {
            continue;
        }
        let remote = join_remote(remote_dir, &name);
        let local = join_local(local_dir, &name);
        if file_type.is_dir() {
            plan.push(PlanItem::Dir { local: local.clone(), remote: remote.clone() });
            Box::pin(walk_remote(sftp, &remote, &local, plan, entry)).await?;
        } else {
            plan.push(PlanItem::File { local, remote, size: meta.size.unwrap_or(0) });
        }
    }
    Ok(())
}

/// 上传计划：单文件直传；目录递归 walk（本地侧收集，远端侧映射路径）
async fn build_upload_plan (local_root: &str, remote_root: &str) -> Result<Vec<PlanItem>, PumpError> {
    let meta = tokio::fs::metadata(local_root)
        .await
        .map_err(|e| failed(format!("failed to stat {local_root}: {e}")))?;
    if !meta.is_dir() {
        return Ok(vec![PlanItem::File {
            local: local_root.to_string(),
            remote: remote_root.to_string(),
            size: meta.len(),
        }]);
    }
    let mut plan = vec![PlanItem::Dir {
        local: local_root.to_string(),
        remote: remote_root.to_string(),
    }];
    walk_local(local_root, remote_root, &mut plan).await?;
    Ok(plan)
}

/// 本地目录递归（DFS 先序）；symlink 跳过（与远端 walk 语义一致）
async fn walk_local (local_dir: &str, remote_dir: &str, plan: &mut Vec<PlanItem>) -> Result<(), PumpError> {
    let mut read_dir = tokio::fs::read_dir(local_dir)
        .await
        .map_err(|e| failed(format!("failed to list {local_dir}: {e}")))?;
    while let Some(dir_entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| failed(format!("failed to read entry in {local_dir}: {e}")))?
    {
        let name = dir_entry.file_name().to_string_lossy().to_string();
        let file_type = dir_entry
            .file_type()
            .await
            .map_err(|e| failed(format!("failed to stat {local_dir}/{name}: {e}")))?;
        if file_type.is_symlink() {
            continue;
        }
        let local = join_local(local_dir, &name);
        let remote = join_remote(remote_dir, &name);
        if file_type.is_dir() {
            plan.push(PlanItem::Dir { local: local.clone(), remote: remote.clone() });
            Box::pin(walk_local(&local, &remote, plan)).await?;
        } else {
            let size = dir_entry
                .metadata()
                .await
                .map(|m| m.len())
                .unwrap_or(0);
            plan.push(PlanItem::File { local, remote, size });
        }
    }
    Ok(())
}

/// 远端建目录（已存在视为成功——目录冲突不阻断传输）
async fn ensure_remote_dir (sftp: &SftpSession, remote: &str) -> Result<(), PumpError> {
    if let Err(error) = sftp.create_dir(remote).await {
        let exists = sftp.try_exists(remote).await.unwrap_or(false);
        if !exists {
            return Err(failed(format!("mkdir {remote} failed: {error}")));
        }
    }
    Ok(())
}

/// 执行传输计划：逐条建目录 / 分块拷贝，进度聚合上报（≥1MB 节流），逐项响应取消
async fn execute_plan (
    app: &AppHandle,
    manager: &TransferManager,
    sftp: &SftpSession,
    entry: &TransferEntry,
    kind: TransferKind,
    plan: Vec<PlanItem>,
) -> Result<(), PumpError> {
    let mut transferred: u64 = 0;
    let mut last_report: u64 = 0;
    for item in plan {
        if entry.cancel.load(Ordering::Acquire) {
            return Err(PumpError::Canceled);
        }
        match item {
            PlanItem::Dir { local, remote } => match kind {
                TransferKind::Download => {
                    tokio::fs::create_dir_all(&local)
                        .await
                        .map_err(|e| failed(format!("mkdir {local} failed: {e}")))?;
                }
                TransferKind::Upload => {
                    ensure_remote_dir(sftp, &remote).await?;
                }
            },
            PlanItem::File { local, remote, .. } => {
                copy_file(app, manager, sftp, entry, kind, &local, &remote, &mut transferred, &mut last_report)
                    .await?;
            }
        }
    }
    // 收尾上报最终字节数（保证 UI 到 100%）
    advance(app, manager, entry, |snapshot| snapshot.transferred_bytes = transferred);
    Ok(())
}

/// 单文件分块拷贝（download：remote→local；upload：local→remote）
async fn copy_file (
    app: &AppHandle,
    manager: &TransferManager,
    sftp: &SftpSession,
    entry: &TransferEntry,
    kind: TransferKind,
    local: &str,
    remote: &str,
    transferred: &mut u64,
    last_report: &mut u64,
) -> Result<(), PumpError> {
    match kind {
        TransferKind::Download => {
            let mut remote_file = sftp
                .open(remote)
                .await
                .map_err(|e| failed(format!("open {remote} failed: {e}")))?;
            if let Some(parent) = Path::new(local).parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| failed(format!("mkdir failed: {e}")))?;
            }
            let mut local_file = tokio::fs::File::create(local)
                .await
                .map_err(|e| failed(format!("create {local} failed: {e}")))?;
            let mut buf = vec![0u8; TRANSFER_CHUNK];
            loop {
                if entry.cancel.load(Ordering::Acquire) {
                    return Err(PumpError::Canceled);
                }
                let n = remote_file
                    .read(&mut buf)
                    .await
                    .map_err(|e| failed(format!("read {remote} failed: {e}")))?;
                if n == 0 {
                    break;
                }
                local_file
                    .write_all(&buf[..n])
                    .await
                    .map_err(|e| failed(format!("write {local} failed: {e}")))?;
                *transferred += n as u64;
                if *transferred - *last_report >= PROGRESS_STEP {
                    *last_report = *transferred;
                    let value = *transferred;
                    advance(app, manager, entry, |snapshot| snapshot.transferred_bytes = value);
                }
            }
            local_file
                .flush()
                .await
                .map_err(|e| failed(format!("flush {local} failed: {e}")))?;
            remote_file
                .shutdown()
                .await
                .map_err(|e| failed(format!("close {remote} failed: {e}")))?;
        }
        TransferKind::Upload => {
            let mut local_file = tokio::fs::File::open(local)
                .await
                .map_err(|e| failed(format!("open {local} failed: {e}")))?;
            let mut remote_file = sftp
                .create(remote)
                .await
                .map_err(|e| failed(format!("create {remote} failed: {e}")))?;
            let mut buf = vec![0u8; TRANSFER_CHUNK];
            loop {
                if entry.cancel.load(Ordering::Acquire) {
                    return Err(PumpError::Canceled);
                }
                let n = local_file
                    .read(&mut buf)
                    .await
                    .map_err(|e| failed(format!("read {local} failed: {e}")))?;
                if n == 0 {
                    break;
                }
                remote_file
                    .write_all(&buf[..n])
                    .await
                    .map_err(|e| failed(format!("write {remote} failed: {e}")))?;
                *transferred += n as u64;
                if *transferred - *last_report >= PROGRESS_STEP {
                    *last_report = *transferred;
                    let value = *transferred;
                    advance(app, manager, entry, |snapshot| snapshot.transferred_bytes = value);
                }
            }
            remote_file
                .flush()
                .await
                .map_err(|e| failed(format!("flush {remote} failed: {e}")))?;
            remote_file
                .shutdown()
                .await
                .map_err(|e| failed(format!("close {remote} failed: {e}")))?;
        }
    }
    Ok(())
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

/// 请求取消一条传输任务（排队/进行中均可取消）
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
mod tests {
    use super::*;

    /// 单测构造：绕过 AppHandle 直接注册条目
    fn make_entry (manager: &TransferManager, status: &str) -> (String, Arc<TransferEntry>) {
        let (id, entry) = manager.register(
            TransferKind::Upload,
            "ssh-test",
            "a.txt",
            "/tmp/a.txt",
            "/srv/a.txt",
        );
        if status != "queued" {
            let mut snapshot = entry.snapshot.lock().unwrap();
            snapshot.status = status.to_string();
        }
        (id, entry)
    }

    #[test]
    fn snapshots_active_first_then_by_started_desc () {
        let manager = TransferManager::new();
        make_entry(&manager, "done");
        make_entry(&manager, "running");
        make_entry(&manager, "error");
        let snapshots = manager.snapshots(None);
        let statuses: Vec<&str> = snapshots.iter().map(|s| s.status.as_str()).collect();
        assert_eq!(statuses.len(), 3);
        assert_eq!(statuses[0], "running");
        assert!(statuses[1..].contains(&"done") && statuses[1..].contains(&"error"));
    }

    #[test]
    fn snapshots_filter_by_ssh_id () {
        let manager = TransferManager::new();
        make_entry(&manager, "queued");
        let (id, entry) = manager.register(TransferKind::Download, "ssh-other", "b.txt", "/tmp/b.txt", "/srv/b.txt");
        let _ = id;
        let _ = entry;
        assert_eq!(manager.snapshots(Some("ssh-other")).len(), 1);
        assert_eq!(manager.snapshots(Some("ssh-test")).len(), 1);
        assert_eq!(manager.snapshots(None).len(), 2);
    }

    #[test]
    fn mutate_rejected_after_terminal_status () {
        let manager = TransferManager::new();
        let (_, entry) = make_entry(&manager, "error");
        assert!(!manager.mutate(&entry, |s| s.status = "done".to_string()));
        assert_eq!(entry.snapshot.lock().unwrap().status, "error");
    }

    #[test]
    fn cancel_sets_flag_and_status_only_for_active () {
        let manager = TransferManager::new();
        let (id, entry) = make_entry(&manager, "queued");
        assert!(manager.cancel(&id));
        assert!(entry.cancel.load(Ordering::Acquire));
        assert_eq!(entry.snapshot.lock().unwrap().status, "canceled");
        // 终态后再取消：返回 false 且状态不变
        assert!(!manager.cancel(&id));
        assert_eq!(entry.snapshot.lock().unwrap().status, "canceled");
        // 不存在的任务
        assert!(!manager.cancel("tr-none"));
    }

    #[test]
    fn clear_removes_only_terminal_entries () {
        let manager = TransferManager::new();
        make_entry(&manager, "running");
        make_entry(&manager, "done");
        make_entry(&manager, "canceled");
        manager.clear(None);
        let snapshots = manager.snapshots(None);
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].status, "running");
    }

    #[test]
    fn trim_history_drops_oldest_terminal_entries () {
        let manager = TransferManager::new();
        for i in 0..(MAX_HISTORY + 5) {
            let (id, entry) = make_entry(&manager, "done");
            let mut snapshot = entry.snapshot.lock().unwrap();
            snapshot.started_at = 1_000 + u64::try_from(i).unwrap();
            snapshot.finished_at = Some(1_000 + u64::try_from(i).unwrap());
            drop(snapshot);
            let _ = id;
        }
        make_entry(&manager, "running");
        manager.trim_history();
        let snapshots = manager.snapshots(None);
        // 1 条活动 + MAX_HISTORY 条历史；最旧的 5 条被淘汰
        assert_eq!(snapshots.len(), MAX_HISTORY + 1);
        assert_eq!(snapshots[0].status, "running");
        let oldest = snapshots.iter().filter(|s| is_terminal(&s.status)).map(|s| s.started_at).min().unwrap();
        assert!(oldest >= 1_005);
    }

    #[test]
    fn remote_and_local_path_join_semantics () {
        assert_eq!(join_remote("/home", "a"), "/home/a");
        assert_eq!(join_remote("/", "a"), "/a");
        // 本地 join 走平台分隔符（Windows 下为反斜杠），远端恒为 '/'
        let sep = std::path::MAIN_SEPARATOR;
        assert_eq!(join_local("/Users/scx", "a"), format!("/Users/scx{sep}a"));
        assert_eq!(join_local("/", "a"), "/a");
        assert_eq!(base_name("/srv/app.tar.gz"), "app.tar.gz");
        assert_eq!(base_name("/srv/dir/"), "dir");
    }

    #[test]
    fn snapshot_serializes_camel_case () {
        let manager = TransferManager::new();
        let (_, entry) = make_entry(&manager, "queued");
        let snapshot = entry.snapshot.lock().unwrap().clone();
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(json.contains("\"kind\":\"upload\""));
        assert!(json.contains("\"sshId\":\"ssh-test\""));
        assert!(json.contains("\"fileName\":\"a.txt\""));
        assert!(json.contains("\"totalBytes\":0"));
        assert!(json.contains("\"startedAt\":"));
    }
}
