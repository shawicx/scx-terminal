//! transfers 单测（从 mod.rs 外移；`use super::*` 保持原语义）。

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
