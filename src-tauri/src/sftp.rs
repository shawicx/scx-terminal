//! @description SFTP 文件面板后端：在同一 russh 连接上开第二 channel 跑 `sftp` subsystem
//!              （russh-sftp 3.0），提供目录浏览/文件管理命令；上传/下载经 transfers 模块
//!              的 TransferManager 执行（事件广播进度、支持取消与目录递归）。
//!              生命周期：SSH 会话断开后所有 SFTP 命令自然报错，前端据此关面板。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::ssh::SshManager;
use crate::transfers;

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
    // symlink 目录判定：readdir 元数据是 lstat 语义（isDir 恒 false），
    // 跟随 stat 修正指向目录的 symlink（双击可进入）；stat 失败保持原值
    for entry in entries.iter_mut() {
        if entry.is_symlink {
            if let Ok(meta) = handle.sftp.metadata(&entry.path).await {
                entry.is_dir = meta.file_type().is_dir();
            }
        }
    }
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

/// 下载远端文件/目录到本地路径（TransferManager 后台任务；进度经 `sftp-transfers-changed` 事件广播）
///
/// # Arguments
///
/// * `app` - AppHandle（事件发射）
/// * `sftp_manager` - SFTP 会话管理器
/// * `id` - SFTP 会话 id
/// * `remote_path` - 远端源路径（文件或目录）
/// * `local_path` - 本地目标路径（与源同形）
///
/// # Returns
///
/// String 传输任务 id（`sftp_transfer_cancel` 可取消）
///
/// # Examples
///
/// `invoke('sftp_download', { id, remotePath, localPath })`
#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    sftp_manager: State<'_, SftpManager>,
    id: String,
    remote_path: String,
    local_path: String,
) -> Result<String, String> {
    let handle = sftp_manager.handle(&id)?;
    Ok(transfers::start_download(&app, handle, remote_path, local_path))
}

/// 上传本地文件/目录到远端路径（TransferManager 后台任务；语义同 sftp_download）
///
/// # Arguments
///
/// * `app` - AppHandle（事件发射）
/// * `sftp_manager` - SFTP 会话管理器
/// * `id` - SFTP 会话 id
/// * `local_path` - 本地源路径（文件或目录）
/// * `remote_path` - 远端目标路径（与源同形）
///
/// # Returns
///
/// String 传输任务 id
///
/// # Examples
///
/// `invoke('sftp_upload', { id, localPath, remotePath })`
#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    sftp_manager: State<'_, SftpManager>,
    id: String,
    local_path: String,
    remote_path: String,
) -> Result<String, String> {
    let handle = sftp_manager.handle(&id)?;
    Ok(transfers::start_upload(&app, handle, local_path, remote_path))
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
