//! @description 传输计划构建：远端（SFTP）/本地（tokio fs）递归 walk 收集目录与文件条目，
//!              单文件直传短路；symlink 跳过避免环；远端建目录沿用「已存在即成功」语义。

use std::sync::atomic::Ordering;

use russh_sftp::client::SftpSession;

use super::{failed, join_local, join_remote, PlanItem, PumpError, TransferEntry};

/// 下载计划：单文件直传；目录递归 walk（远端侧收集，本地侧映射路径）
pub(super) async fn build_download_plan (
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
pub(super) async fn build_upload_plan (local_root: &str, remote_root: &str) -> Result<Vec<PlanItem>, PumpError> {
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
pub(super) async fn ensure_remote_dir (sftp: &SftpSession, remote: &str) -> Result<(), PumpError> {
    if let Err(error) = sftp.create_dir(remote).await {
        let exists = sftp.try_exists(remote).await.unwrap_or(false);
        if !exists {
            return Err(failed(format!("mkdir {remote} failed: {error}")));
        }
    }
    Ok(())
}
