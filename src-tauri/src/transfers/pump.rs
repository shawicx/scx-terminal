//! @description 传输计划执行：逐条建目录 / 分块拷贝（download：remote→local；
//!              upload：local→remote）。断点续传：拷贝一律写目标侧 `.scxpart` 部分
//!              文件（隐藏文件名），执行前预扫各文件已有部分大小初始化聚合基数，
//!              从偏移续写（远端 open_with_flags 不截断 + AsyncSeek 定位），写满后
//!              rename 成正式名收尾；暂停/取消/出错保留部分文件供续传。
//!              进度聚合上报（≥1MB 节流），逐项响应取消/暂停。

use std::path::Path;
use std::sync::atomic::Ordering;

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use super::plan::ensure_remote_dir;
use super::resume::{local_part_size, part_path, remote_part_size, ResumeDecision};
use super::{
    advance, failed, stop_reason, PlanItem, PumpError, TransferEntry, TransferKind, TransferManager,
    PROGRESS_STEP, TRANSFER_CHUNK,
};

/// 执行传输计划：预扫断点（聚合基数）→ 逐条建目录 / 分块拷贝（续传），进度聚合上报
/// （≥1MB 节流），逐项响应取消/暂停
pub(super) async fn execute_plan (
    app: &AppHandle,
    manager: &TransferManager,
    sftp: &SftpSession,
    entry: &TransferEntry,
    kind: TransferKind,
    plan: Vec<PlanItem>,
) -> Result<(), PumpError> {
    let mut transferred: u64 = 0;
    // 预扫断点：已完成文件计满、部分文件计偏移，续传任务的 UI 进度从断点起跳
    for item in &plan {
        if let PlanItem::File { local, remote, size } = item {
            let part_size = match kind {
                TransferKind::Download => local_part_size(local).await,
                TransferKind::Upload => remote_part_size(sftp, remote).await,
            };
            match super::resume::resume_offset(*size, part_size) {
                ResumeDecision::Continue(offset) => transferred += offset,
                ResumeDecision::Complete => transferred += size,
                ResumeDecision::Restart => {}
            }
        }
    }
    let mut last_report: u64 = transferred;
    advance(app, manager, entry, |snapshot| snapshot.transferred_bytes = transferred);
    for item in plan {
        if let Some(err) = stop_reason(entry) {
            return Err(err);
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
            PlanItem::File { local, remote, size } => {
                copy_file(app, manager, sftp, entry, kind, &local, &remote, size, &mut transferred, &mut last_report)
                    .await?;
            }
        }
    }
    // 收尾上报最终字节数（保证 UI 到 100%）
    advance(app, manager, entry, |snapshot| snapshot.transferred_bytes = transferred);
    Ok(())
}

/**
 * @description 单文件分块拷贝（download：remote→local；upload：local→remote），
 *              目标侧写 `.scxpart` 部分文件：已有部分与源大小比较决定 重传/续传/直接
 *              改名收尾，完成后 rename 成正式目标名（覆盖已存在的同名文件）
 * @param app AppHandle（进度广播）
 * @param manager 传输管理器
 * @param sftp SFTP 会话
 * @param entry 任务条目（取消/暂停标志）
 * @param kind 传输方向
 * @param local 本地侧路径
 * @param remote 远端侧路径
 * @param size 源文件大小（plan 统计）
 * @param transferred 聚合进度累加器（含断点基数）
 * @param last_report 上次广播的聚合进度（节流用）
 * @returns Result<(), PumpError>
 *
 * @example copy_file(&app, &manager, &sftp, &entry, kind, "/tmp/a", "/srv/a", 1024, &mut t, &mut r).await
 *
 */
async fn copy_file (
    app: &AppHandle,
    manager: &TransferManager,
    sftp: &SftpSession,
    entry: &TransferEntry,
    kind: TransferKind,
    local: &str,
    remote: &str,
    size: u64,
    transferred: &mut u64,
    last_report: &mut u64,
) -> Result<(), PumpError> {
    match kind {
        TransferKind::Download => {
            let part = part_path(local);
            let decision = super::resume::resume_offset(size, local_part_size(local).await);
            if let Some(parent) = Path::new(&part).parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| failed(format!("mkdir failed: {e}")))?;
            }
            let mut remote_file = sftp
                .open(remote)
                .await
                .map_err(|e| failed(format!("open {remote} failed: {e}")))?;
            let mut local_file = match decision {
                // 部分文件已写满：源未变，直接改名收尾（秒过）
                ResumeDecision::Complete => {
                    finalize_local(&part, local).await?;
                    *transferred += size;
                    report(app, manager, entry, *transferred, last_report);
                    return Ok(());
                }
                // 断点续传：非截断打开部分文件，两侧定位到偏移后继续
                ResumeDecision::Continue(offset) => {
                    remote_file
                        .seek(std::io::SeekFrom::Start(offset))
                        .await
                        .map_err(|e| failed(format!("seek {remote}@{offset} failed: {e}")))?;
                    let mut file = tokio::fs::OpenOptions::new()
                        .write(true)
                        .create(true)
                        .open(&part)
                        .await
                        .map_err(|e| failed(format!("open {part} failed: {e}")))?;
                    file.seek(std::io::SeekFrom::Start(offset))
                        .await
                        .map_err(|e| failed(format!("seek {part}@{offset} failed: {e}")))?;
                    file
                }
                // 重传（无部分文件或源已变化）：截断新建部分文件
                ResumeDecision::Restart => {
                    tokio::fs::File::create(&part)
                        .await
                        .map_err(|e| failed(format!("create {part} failed: {e}")))?
                }
            };
            pump_loop(app, manager, entry, &mut remote_file, &mut local_file, remote, &part, transferred, last_report).await?;
            local_file
                .flush()
                .await
                .map_err(|e| failed(format!("flush {part} failed: {e}")))?;
            local_file
                .sync_all()
                .await
                .map_err(|e| failed(format!("sync {part} failed: {e}")))?;
            remote_file
                .shutdown()
                .await
                .map_err(|e| failed(format!("close {remote} failed: {e}")))?;
            finalize_local(&part, local).await?;
        }
        TransferKind::Upload => {
            let part = part_path(remote);
            let decision = super::resume::resume_offset(size, remote_part_size(sftp, remote).await);
            let mut local_file = tokio::fs::File::open(local)
                .await
                .map_err(|e| failed(format!("open {local} failed: {e}")))?;
            let mut remote_file = match decision {
                ResumeDecision::Complete => {
                    finalize_remote(sftp, &part, remote).await?;
                    *transferred += size;
                    report(app, manager, entry, *transferred, last_report);
                    return Ok(());
                }
                ResumeDecision::Continue(offset) => {
                    local_file
                        .seek(std::io::SeekFrom::Start(offset))
                        .await
                        .map_err(|e| failed(format!("seek {local}@{offset} failed: {e}")))?;
                    let mut file = sftp
                        .open_with_flags(&part, OpenFlags::CREATE | OpenFlags::WRITE)
                        .await
                        .map_err(|e| failed(format!("open {part} failed: {e}")))?;
                    file.seek(std::io::SeekFrom::Start(offset))
                        .await
                        .map_err(|e| failed(format!("seek {part}@{offset} failed: {e}")))?;
                    file
                }
                ResumeDecision::Restart => {
                    sftp.create(&part)
                        .await
                        .map_err(|e| failed(format!("create {part} failed: {e}")))?
                }
            };
            pump_loop(app, manager, entry, &mut local_file, &mut remote_file, local, &part, transferred, last_report).await?;
            remote_file
                .flush()
                .await
                .map_err(|e| failed(format!("flush {part} failed: {e}")))?;
            remote_file
                .shutdown()
                .await
                .map_err(|e| failed(format!("close {part} failed: {e}")))?;
            finalize_remote(sftp, &part, remote).await?;
        }
    }
    Ok(())
}

/**
 * @description 分块拷贝循环（reader→writer，方向由调用方决定）：逐块读写 + 聚合进度
 *              （≥1MB 节流广播），逐块响应取消/暂停
 * @param app AppHandle（进度广播）
 * @param manager 传输管理器
 * @param entry 任务条目（取消/暂停标志）
 * @param reader 读侧（源）
 * @param writer 写侧（部分文件）
 * @param reader_name 源路径（错误信息用）
 * @param writer_name 部分文件路径（错误信息用）
 * @param transferred 聚合进度累加器
 * @param last_report 上次广播的聚合进度（节流用）
 * @returns Result<(), PumpError>
 *
 * @example pump_loop(&app, &manager, &entry, &mut src, &mut dst, "/srv/a", "/tmp/.a.part", &mut t, &mut r).await
 *
 */
async fn pump_loop<R, W> (
    app: &AppHandle,
    manager: &TransferManager,
    entry: &TransferEntry,
    reader: &mut R,
    writer: &mut W,
    reader_name: &str,
    writer_name: &str,
    transferred: &mut u64,
    last_report: &mut u64,
) -> Result<(), PumpError>
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    let mut buf = vec![0u8; TRANSFER_CHUNK];
    loop {
        if entry.cancel.load(Ordering::Acquire) || entry.pause.load(Ordering::Acquire) {
            return Err(stop_reason(entry).unwrap_or(PumpError::Canceled));
        }
        let n = reader
            .read(&mut buf)
            .await
            .map_err(|e| failed(format!("read {reader_name} failed: {e}")))?;
        if n == 0 {
            break;
        }
        writer
            .write_all(&buf[..n])
            .await
            .map_err(|e| failed(format!("write {writer_name} failed: {e}")))?;
        *transferred += n as u64;
        if *transferred - *last_report >= PROGRESS_STEP {
            report(app, manager, entry, *transferred, last_report);
        }
    }
    Ok(())
}

/// 聚合进度节流广播（≥1MB 步进）
fn report (app: &AppHandle, manager: &TransferManager, entry: &TransferEntry, transferred: u64, last_report: &mut u64) {
    *last_report = transferred;
    advance(app, manager, entry, |snapshot| snapshot.transferred_bytes = transferred);
}

/**
 * @description 本地部分文件收尾：移除已存在的同名正式文件（Windows rename 不覆盖）
 *              后 rename 成正式名
 * @param part 部分文件路径
 * @param target 正式目标路径
 * @returns Result<(), PumpError>
 *
 * @example finalize_local("/tmp/.a.gz.scxpart", "/tmp/a.gz").await
 *
 */
async fn finalize_local (part: &str, target: &str) -> Result<(), PumpError> {
    if tokio::fs::try_exists(target).await.unwrap_or(false) {
        tokio::fs::remove_file(target)
            .await
            .map_err(|e| failed(format!("remove {target} failed: {e}")))?;
    }
    tokio::fs::rename(part, target)
        .await
        .map_err(|e| failed(format!("rename {part} -> {target} failed: {e}")))
}

/**
 * @description 远端部分文件收尾：移除已存在的同名正式文件后 rename 成正式名
 * @param sftp SFTP 会话
 * @param part 部分文件路径
 * @param target 正式目标路径
 * @returns Result<(), PumpError>
 *
 * @example finalize_remote(&sftp, "/srv/.a.gz.scxpart", "/srv/a.gz").await
 *
 */
async fn finalize_remote (sftp: &SftpSession, part: &str, target: &str) -> Result<(), PumpError> {
    if sftp.try_exists(target).await.unwrap_or(false) {
        sftp.remove_file(target)
            .await
            .map_err(|e| failed(format!("remove {target} failed: {e}")))?;
    }
    sftp.rename(part, target)
        .await
        .map_err(|e| failed(format!("rename {part} -> {target} failed: {e}")))
}
