//! @description 传输计划执行：逐条建目录 / 分块拷贝（download：remote→local；
//!              upload：local→remote），进度聚合上报（≥1MB 节流），逐项响应取消。

use std::path::Path;
use std::sync::atomic::Ordering;

use russh_sftp::client::SftpSession;
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::plan::ensure_remote_dir;
use super::{
    advance, failed, PlanItem, PumpError, TransferEntry, TransferKind, TransferManager, PROGRESS_STEP,
    TRANSFER_CHUNK,
};

/// 执行传输计划：逐条建目录 / 分块拷贝，进度聚合上报（≥1MB 节流），逐项响应取消
pub(super) async fn execute_plan (
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
