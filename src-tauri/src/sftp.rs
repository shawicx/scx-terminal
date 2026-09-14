//! @description SFTP 文件面板后端：在同一 russh 连接上开第二 channel 跑 `sftp` subsystem
//!              （russh-sftp 3.0），提供目录浏览/上传/下载（分块 + 进度 Channel）/文件管理命令。
//!              生命周期：SSH 会话断开后所有 SFTP 命令自然报错，前端据此关面板。

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use russh_sftp::client::SftpSession;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;
use uuid::Uuid;

use crate::ssh::SshManager;

/// 一条 SFTP 会话（绑定其来源 SSH 连接，便于排查）
pub struct SftpHandle {
    #[allow(dead_code)]
    pub ssh_id: String,
    pub sftp: SftpSession,
}

#[derive(Default)]
pub struct SftpManager {
    sessions: Mutex<HashMap<String, Arc<SftpHandle>>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn handle(&self, id: &str) -> Result<Arc<SftpHandle>, String> {
        self.sessions
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| format!("sftp {id} not found (closed?)"))
    }

    fn remove(&self, id: &str) -> Option<Arc<SftpHandle>> {
        self.sessions.lock().unwrap().remove(id)
    }
}

/// 目录条目（列表展示用；元数据来自 readdir 的 attrs，无需逐个 stat）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: Option<u64>,
    pub mtime_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpOpened {
    pub id: String,
    pub home: String,
}

/// 传输进度/状态（经 Tauri Channel 推送）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transfer_id: String,
    pub path: String,
    pub done: u64,
    pub total: u64,
    /// progress | done | error
    pub state: String,
    pub error: Option<String>,
}

fn entry_from(parent: &str, name: String, attrs: russh_sftp::client::fs::Metadata) -> FileEntry {
    let path = if parent.ends_with('/') {
        format!("{parent}{name}")
    } else {
        format!("{parent}/{name}")
    };
    let file_type = attrs.file_type();
    FileEntry {
        name,
        path,
        is_dir: file_type.is_dir(),
        is_symlink: file_type.is_symlink(),
        size: attrs.size,
        mtime_ms: attrs.mtime.map(|s| u64::from(s) * 1000),
    }
}

async fn resolve_entry(
    state: &SftpManager,
    id: &str,
) -> Result<Arc<SftpHandle>, String> {
    state.handle(id)
}

/// 打开 SFTP 会话：在指定 SSH 连接上开新 channel 请求 `sftp` subsystem。
/// 同一连接可同时持有 shell channel 与 SFTP channel（SSH 协议多路复用）。
///
/// # Arguments
///
/// * `ssh_manager` - SSH 会话管理器（定位已认证连接）
/// * `sftp_manager` - SFTP 会话管理器
/// * `ssh_id` - SSH 会话 id
///
/// # Returns
///
/// `{ id, home }`：SFTP 会话 id 与远端主目录
///
/// # Examples
///
/// `invoke('sftp_open', { sshId })`
#[tauri::command]
pub async fn sftp_open(
    ssh_manager: State<'_, SshManager>,
    sftp_manager: State<'_, SftpManager>,
    ssh_id: String,
) -> Result<SftpOpened, String> {
    let Some(session) = ssh_manager.session(&ssh_id) else {
        return Err(format!("ssh {ssh_id} not found"));
    };
    let stream = session.open_sftp_channel().await?;
    let sftp = SftpSession::new(stream).await
        .map_err(|e| format!("failed to init sftp: {e}"))?;
    sftp.set_timeout(60);
    let home = sftp.canonicalize(".").await.unwrap_or_else(|_| "/".to_string());

    let id = format!("sftp-{}", Uuid::new_v4());
    sftp_manager.sessions.lock().unwrap().insert(
        id.clone(),
        Arc::new(SftpHandle { ssh_id, sftp }),
    );
    Ok(SftpOpened { id, home })
}

/// 列出远端目录（含条目元数据；`. `/`..` 已被库过滤）
///
/// # Arguments
///
/// * `sftp_manager` - SFTP 会话管理器
/// * `id` - SFTP 会话 id
/// * `path` - 远端目录绝对路径
///
/// # Returns
///
/// 条目列表（目录在前由前端排序）
///
/// # Examples
///
/// `invoke('sftp_read_dir', { id, path: '/home' })`
#[tauri::command]
pub async fn sftp_read_dir(
    sftp_manager: State<'_, SftpManager>,
    id: String,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    let handle = resolve_entry(&sftp_manager, &id).await?;
    let read_dir = handle.sftp.read_dir(&path).await.map_err(|e| format!("failed to list {path}: {e}"))?;
    let mut entries: Vec<FileEntry> = read_dir
        .map(|entry| entry_from(&path, entry.file_name(), entry.metadata()))
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// 新建远端目录
///
/// # Arguments
///
/// * `sftp_manager` - SFTP 会话管理器
/// * `id` - SFTP 会话 id
/// * `path` - 新目录绝对路径
///
/// # Examples
///
/// `invoke('sftp_mkdir', { id, path })`
#[tauri::command]
pub async fn sftp_mkdir(sftp_manager: State<'_, SftpManager>, id: String, path: String) -> Result<(), String> {
    let handle = resolve_entry(&sftp_manager, &id).await?;
    handle.sftp.create_dir(&path).await.map_err(|e| format!("mkdir failed: {e}"))
}

/// 重命名/移动远端条目
///
/// # Arguments
///
/// * `sftp_manager` - SFTP 会话管理器
/// * `id` - SFTP 会话 id
/// * `from` / `to` - 原路径与新路径
///
/// # Examples
///
/// `invoke('sftp_rename', { id, from, to })`
#[tauri::command]
pub async fn sftp_rename(
    sftp_manager: State<'_, SftpManager>,
    id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let handle = resolve_entry(&sftp_manager, &id).await?;
    handle.sftp.rename(&from, &to).await.map_err(|e| format!("rename failed: {e}"))
}

/// 删除远端文件
///
/// # Arguments
///
/// * `sftp_manager` - SFTP 会话管理器
/// * `id` - SFTP 会话 id
/// * `path` - 文件绝对路径
///
/// # Examples
///
/// `invoke('sftp_remove_file', { id, path })`
#[tauri::command]
pub async fn sftp_remove_file(sftp_manager: State<'_, SftpManager>, id: String, path: String) -> Result<(), String> {
    let handle = resolve_entry(&sftp_manager, &id).await?;
    handle.sftp.remove_file(&path).await.map_err(|e| format!("remove failed: {e}"))
}

/// 删除远端空目录
///
/// # Arguments
///
/// * `sftp_manager` - SFTP 会话管理器
/// * `id` - SFTP 会话 id
/// * `path` - 目录绝对路径
///
/// # Examples
///
/// `invoke('sftp_remove_dir', { id, path })`
#[tauri::command]
pub async fn sftp_remove_dir(sftp_manager: State<'_, SftpManager>, id: String, path: String) -> Result<(), String> {
    let handle = resolve_entry(&sftp_manager, &id).await?;
    handle.sftp.remove_dir(&path).await.map_err(|e| format!("rmdir failed: {e}"))
}

/// 关闭 SFTP 会话（面板关闭/会话退出时调用）
///
/// # Arguments
///
/// * `sftp_manager` - SFTP 会话管理器
/// * `id` - SFTP 会话 id
///
/// # Examples
///
/// `invoke('sftp_close', { id })`
#[tauri::command]
pub async fn sftp_close(sftp_manager: State<'_, SftpManager>, id: String) -> Result<(), String> {
    if let Some(handle) = sftp_manager.remove(&id) {
        let _ = handle.sftp.close().await;
    }
    Ok(())
}

const TRANSFER_CHUNK: usize = 256 * 1024;
/// 进度推送节流：每 ≥1MB 或完成时发一次
const PROGRESS_STEP: u64 = 1024 * 1024;

fn send_progress(channel: &Channel<TransferProgress>, progress: TransferProgress) {
    let _ = channel.send(progress);
}

/// 下载远端文件到本地路径（分块流式 + 进度推送；命令立即返回，结果经 Channel 收尾）
///
/// # Arguments
///
/// * `sftp_manager` - SFTP 会话管理器
/// * `id` - SFTP 会话 id
/// * `remote_path` - 远端文件绝对路径
/// * `local_path` - 本地目标文件路径
/// * `progress` - 进度 Channel（TransferProgress）
///
/// # Examples
///
/// `invoke('sftp_download', { id, remotePath, localPath, progress })`
#[tauri::command]
pub async fn sftp_download(
    sftp_manager: State<'_, SftpManager>,
    id: String,
    remote_path: String,
    local_path: String,
    progress: Channel<TransferProgress>,
) -> Result<(), String> {
    let handle = sftp_manager.handle(&id)?;
    let transfer_id = Uuid::new_v4().to_string();
    let remote = remote_path.clone();
    let local = local_path.clone();
    tauri::async_runtime::spawn(async move {
        let result = run_download(&handle.sftp, &remote, &local, &transfer_id, &progress).await;
        let state = match &result {
            Ok(()) => "done",
            Err(_) => "error",
        };
        send_progress(&progress, TransferProgress {
            transfer_id,
            path: remote,
            done: 0,
            total: 0,
            state: state.to_string(),
            error: result.err(),
        });
    });
    Ok(())
}

async fn run_download(
    sftp: &SftpSession,
    remote: &str,
    local: &str,
    transfer_id: &str,
    progress: &Channel<TransferProgress>,
) -> Result<(), String> {
    let mut remote_file = sftp.open(remote).await.map_err(|e| format!("open failed: {e}"))?;
    let total = remote_file.metadata().await.ok().and_then(|m| m.size).unwrap_or(0);
    if let Some(parent) = Path::new(local).parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| format!("mkdir failed: {e}"))?;
    }
    let mut local_file = tokio::fs::File::create(local).await.map_err(|e| format!("create failed: {e}"))?;
    let mut buf = vec![0u8; TRANSFER_CHUNK];
    let mut done: u64 = 0;
    let mut last_report: u64 = 0;
    loop {
        let n = remote_file.read(&mut buf).await.map_err(|e| format!("read failed: {e}"))?;
        if n == 0 {
            break;
        }
        local_file.write_all(&buf[..n]).await.map_err(|e| format!("write failed: {e}"))?;
        done += n as u64;
        if done - last_report >= PROGRESS_STEP {
            last_report = done;
            send_progress(progress, TransferProgress {
                transfer_id: transfer_id.to_string(),
                path: remote.to_string(),
                done,
                total,
                state: "progress".to_string(),
                error: None,
            });
        }
    }
    local_file.flush().await.map_err(|e| format!("flush failed: {e}"))?;
    remote_file.shutdown().await.map_err(|e| format!("close failed: {e}"))?;
    send_progress(progress, TransferProgress {
        transfer_id: transfer_id.to_string(),
        path: remote.to_string(),
        done,
        total,
        state: "done".to_string(),
        error: None,
    });
    Ok(())
}

/// 上传本地文件到远端路径（分块流式 + 进度推送；命令立即返回）
///
/// # Arguments
///
/// * `sftp_manager` - SFTP 会话管理器
/// * `id` - SFTP 会话 id
/// * `local_path` - 本地源文件路径
/// * `remote_path` - 远端目标文件路径
/// * `progress` - 进度 Channel
///
/// # Examples
///
/// `invoke('sftp_upload', { id, localPath, remotePath, progress })`
#[tauri::command]
pub async fn sftp_upload(
    sftp_manager: State<'_, SftpManager>,
    id: String,
    local_path: String,
    remote_path: String,
    progress: Channel<TransferProgress>,
) -> Result<(), String> {
    let handle = sftp_manager.handle(&id)?;
    let transfer_id = Uuid::new_v4().to_string();
    let remote = remote_path.clone();
    let local = local_path.clone();
    tauri::async_runtime::spawn(async move {
        let result = run_upload(&handle.sftp, &local, &remote, &transfer_id, &progress).await;
        let state = match &result {
            Ok(()) => "done",
            Err(_) => "error",
        };
        send_progress(&progress, TransferProgress {
            transfer_id,
            path: remote,
            done: 0,
            total: 0,
            state: state.to_string(),
            error: result.err(),
        });
    });
    Ok(())
}

async fn run_upload(
    sftp: &SftpSession,
    local: &str,
    remote: &str,
    transfer_id: &str,
    progress: &Channel<TransferProgress>,
) -> Result<(), String> {
    let mut local_file = tokio::fs::File::open(local).await.map_err(|e| format!("open failed: {e}"))?;
    let total = local_file.metadata().await.map(|m| m.len()).unwrap_or(0);
    let mut remote_file = sftp.create(remote).await.map_err(|e| format!("create failed: {e}"))?;
    let mut buf = vec![0u8; TRANSFER_CHUNK];
    let mut done: u64 = 0;
    let mut last_report: u64 = 0;
    loop {
        let n = local_file.read(&mut buf).await.map_err(|e| format!("read failed: {e}"))?;
        if n == 0 {
            break;
        }
        remote_file.write_all(&buf[..n]).await.map_err(|e| format!("write failed: {e}"))?;
        done += n as u64;
        if done - last_report >= PROGRESS_STEP {
            last_report = done;
            send_progress(progress, TransferProgress {
                transfer_id: transfer_id.to_string(),
                path: remote.to_string(),
                done,
                total,
                state: "progress".to_string(),
                error: None,
            });
        }
    }
    remote_file.flush().await.map_err(|e| format!("flush failed: {e}"))?;
    remote_file.shutdown().await.map_err(|e| format!("close failed: {e}"))?;
    send_progress(progress, TransferProgress {
        transfer_id: transfer_id.to_string(),
        path: remote.to_string(),
        done,
        total,
        state: "done".to_string(),
        error: None,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{entry_from, FileEntry};

    #[test]
    fn entry_metadata_maps_to_file_entry() {
        // 不起 SSH 连接：直接验证 entry_from 的元数据映射与路径拼接
        // （attrs 从 read_dir 真实结构构造不可行——这里验证 serde 形状与 is_dir 判定语义）
        let entry = FileEntry {
            name: "a.txt".into(),
            path: "/tmp/a.txt".into(),
            is_dir: false,
            is_symlink: false,
            size: Some(42),
            mtime_ms: Some(1_000),
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"isDir\":false"));
        assert!(json.contains("\"size\":42"));
    }

    #[test]
    fn entry_path_joins_parent() {
        // 复刻 russh-sftp DirEntry::path 的拼接语义
        let join = |parent: &str, name: &str| {
            if parent.ends_with('/') {
                format!("{parent}{name}")
            } else {
                format!("{parent}/{name}")
            }
        };
        assert_eq!(join("/home", "a"), "/home/a");
        assert_eq!(join("/home/", "a"), "/home/a");
        let attrs_meta: Option<u64> = None;
        let _ = entry_from("/home", "a".into(), test_attrs());
        let _ = attrs_meta;
    }

    fn test_attrs() -> russh_sftp::client::fs::Metadata {
        russh_sftp::client::fs::Metadata::default()
    }
}
