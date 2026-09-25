//! snapshot 单测（从原 snapshot.rs 外移）：口令包裹往返/防篡改、跨机导出导入全链路、
//! 旧格式兼容、坏文件零写入。

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use crate::config::load::load_internal;
use crate::config::ConfigState;
use crate::secrets::{
    load_password, load_private_key, replace_all, test_state, CredPlain, KeyPlain, SecretsPlain, SecretsState,
};
use crate::snapshot::crypto::{unwrap_secrets, wrap_secrets};
use crate::snapshot::model::{BackupSecrets, BACKUP_FORMAT, BACKUP_VERSION};
use crate::snapshot::{export_internal, import_internal};

static SEQ: AtomicU32 = AtomicU32::new(0);

/// 唯一临时目录（tag + pid + 自增序号，避免同进程测试互撞）
fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "scx-snapshot-test-{tag}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// 机器 A 的 config.db 种子数据（覆盖全部纳入实体 + 应被排除的 recents）
fn seed_config(state: &ConfigState) {
    state.lock_conn().execute_batch(
        r##"INSERT INTO settings (key, value) VALUES
            ('terminal', '{"fontSize":14}'),
            ('advanced', '{"debugLog":true}'),
            ('recents', '{"hosts":["should-not-export"]}');
        INSERT INTO hotkeys (action, bindings) VALUES ('command-palette', '["Ctrl+P"]');
        INSERT INTO profiles (id, type, name, is_default, sort_order, data) VALUES
            ('p-ssh', 'ssh', 'srv1', 0, 0, '{"id":"p-ssh","type":"ssh","name":"srv1","host":"1.2.3.4","keyId":"k1"}'),
            ('p-local', 'local', 'zsh', 1, 1, '{"id":"p-local","type":"local","name":"zsh"}');
        INSERT INTO color_schemes (name, sort_order, data) VALUES ('mine', 0, '{"background":"#0f0f0f"}');
        INSERT INTO quick_command_groups (id, name, sort_order) VALUES ('g1', 'ops', 0);
        INSERT INTO quick_commands (id, group_id, name, command, auto_run, sort_order)
            VALUES ('q1', 'g1', 'df', 'df -h', 1, 0);
        INSERT INTO ssh_groups (id, name, sort_order) VALUES ('sg1', 'prod', 0);
        INSERT INTO local_groups (id, name, is_default, sort_order) VALUES ('lg1', 'zsh', 1, 0);
        INSERT INTO meta (key, value) VALUES ('initialized', '1');"##,
    ).unwrap();
}

/// 生成一把真实 ed25519 私钥 PEM（与 secrets.rs 测试同源方式）
fn test_pem() -> String {
    let key = russh::keys::ssh_key::PrivateKey::random(
        &mut russh::keys::key::safe_rng(),
        russh::keys::ssh_key::Algorithm::Ed25519,
    )
    .unwrap();
    key.to_openssh(russh::keys::ssh_key::LineEnding::LF).unwrap().to_string()
}

/// 机器 A 的 secrets.db 种子数据（1 把带口令私钥 + 1 条档案密码）
fn seed_secrets(state: &SecretsState, pem: &str) {
    replace_all(
        state,
        &SecretsPlain {
            ssh_keys: vec![KeyPlain {
                id: "k1".into(),
                name: "backup key".into(),
                algorithm: "ed25519".into(),
                public_key: "ssh-ed25519 AAAAtest".into(),
                fingerprint: "SHA256:test".into(),
                comment: String::new(),
                created_at: 42,
                private_key_pem: pem.to_string(),
                passphrase: Some("keypass".into()),
            }],
            ssh_credentials: vec![CredPlain {
                profile_id: "p-ssh".into(),
                password: "hunter2".into(),
            }],
        },
    )
    .unwrap();
}

#[test]
fn secrets_wrap_round_trip_wrong_passphrase_and_tamper_fail() {
    let wrapped = wrap_secrets(r#"{"a":1}"#, "pass123").unwrap();
    assert_eq!(unwrap_secrets(&wrapped, "pass123").unwrap(), r#"{"a":1}"#);

    let err = unwrap_secrets(&wrapped, "wrong-pass").unwrap_err();
    assert!(err.contains("口令错误或文件损坏"), "unexpected error: {err}");

    // 篡改：换入另一段合法 b64 密文（nonce 不同 → GCM tag 校验失败）
    let other = wrap_secrets(r#"{"a":1}"#, "pass123").unwrap();
    let tampered = BackupSecrets { ciphertext: other.ciphertext, ..wrapped.clone() };
    let err = unwrap_secrets(&tampered, "pass123").unwrap_err();
    assert!(err.contains("口令错误或文件损坏"), "unexpected error: {err}");
}

#[test]
fn export_import_round_trip_across_machines() {
    // 机器 A：种子 + 导出
    let dir_a = temp_dir("a");
    let config_a = ConfigState::new(&dir_a);
    let secrets_a = test_state(&dir_a);
    seed_config(&config_a);
    let pem = test_pem();
    seed_secrets(&secrets_a, &pem);

    let file = dir_a.join("backup.json");
    let summary = export_internal(&config_a, &secrets_a, &file, "pass123", "0.1.6-test").unwrap();
    assert_eq!(summary.profile_count, 2);
    assert_eq!(summary.quick_command_count, 1);
    assert_eq!(summary.ssh_key_count, 1);

    // 文件层：信封正确，明文痕迹不得出现
    let raw = std::fs::read_to_string(&file).unwrap();
    let doc: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(doc["format"], BACKUP_FORMAT);
    assert_eq!(doc["version"], BACKUP_VERSION);
    assert!(!raw.contains("hunter2"));
    assert!(!raw.contains("PRIVATE KEY"));

    // 机器 B：全新状态导入（不同主密钥）
    let dir_b = temp_dir("b");
    let config_b = ConfigState::new(&dir_b);
    let secrets_b = test_state(&dir_b);
    import_internal(&config_b, &secrets_b, &file, "pass123").unwrap();

    let snapshot = load_internal(&config_b).unwrap().expect("imported config must be initialized");
    assert_eq!(snapshot.terminal, Some(serde_json::json!({"fontSize": 14})));
    assert_eq!(snapshot.advanced.as_ref().unwrap()["debugLog"], true);
    assert!(snapshot.recents.is_none(), "recents must not travel with backup");
    assert_eq!(snapshot.profiles.len(), 2);
    assert_eq!(snapshot.profiles[0]["host"], "1.2.3.4", "sort_order must be preserved");
    assert_eq!(snapshot.profiles[1]["name"], "zsh");
    assert_eq!(snapshot.quick_commands.len(), 1);
    assert_eq!(snapshot.quick_commands[0].id, "q1");
    assert!(snapshot.quick_commands[0].auto_run);
    assert_eq!(snapshot.quick_commands[0].group_id.as_deref(), Some("g1"));
    assert_eq!(snapshot.quick_command_groups.len(), 1);
    assert_eq!(snapshot.quick_command_groups[0].name, "ops");
    assert_eq!(snapshot.ssh_groups.len(), 1);
    assert_eq!(snapshot.ssh_groups[0].name, "prod");
    assert_eq!(snapshot.local_groups.len(), 1);
    assert_eq!(snapshot.local_groups[0].name, "zsh");
    assert!(snapshot.local_groups[0].is_default);

    // B 机凭据：用 B 自己的主密钥可解回明文
    let loaded = load_private_key(&secrets_b, "k1").unwrap();
    assert_eq!(loaded.private_key_pem, pem);
    assert_eq!(loaded.passphrase.as_deref(), Some("keypass"));
    assert_eq!(load_password(&secrets_b, "p-ssh").unwrap().as_deref(), Some("hunter2"));
}

#[test]
fn import_accepts_backup_without_local_groups_field() {
    // v1 早期备份（local_groups 字段加入前）去掉该键后仍可导入
    let dir_a = temp_dir("old-a");
    let config_a = ConfigState::new(&dir_a);
    let secrets_a = test_state(&dir_a);
    seed_config(&config_a);
    let file = dir_a.join("backup.json");
    export_internal(&config_a, &secrets_a, &file, "pass123", "0.1.6-test").unwrap();

    let mut doc: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    doc["config"].as_object_mut().unwrap().remove("localGroups");
    let old = dir_a.join("old-format.json");
    std::fs::write(&old, doc.to_string()).unwrap();

    let dir_b = temp_dir("old-b");
    let config_b = ConfigState::new(&dir_b);
    let secrets_b = test_state(&dir_b);
    import_internal(&config_b, &secrets_b, &old, "pass123").unwrap();
    let snapshot = load_internal(&config_b).unwrap().expect("old-format import must initialize");
    assert!(snapshot.local_groups.is_empty());
    assert_eq!(snapshot.profiles.len(), 2);
}

#[test]
fn import_rejects_unknown_version_without_touching_target() {
    let dir_a = temp_dir("a");
    let config_a = ConfigState::new(&dir_a);
    let secrets_a = test_state(&dir_a);
    seed_config(&config_a);
    let pem = test_pem();
    seed_secrets(&secrets_a, &pem);
    let file = dir_a.join("backup.json");
    export_internal(&config_a, &secrets_a, &file, "pass123", "0.1.6-test").unwrap();

    let mut doc: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    doc["version"] = serde_json::json!(99);
    let bad = dir_a.join("bad-version.json");
    std::fs::write(&bad, doc.to_string()).unwrap();

    let dir_b = temp_dir("b");
    let config_b = ConfigState::new(&dir_b);
    let secrets_b = test_state(&dir_b);
    let err = import_internal(&config_b, &secrets_b, &bad, "pass123").unwrap_err();
    assert!(err.contains("unsupported backup version"), "unexpected error: {err}");
    assert!(
        load_internal(&config_b).unwrap().is_none(),
        "rejected import must not touch target config"
    );
    assert!(
        load_password(&secrets_b, "p-ssh").unwrap().is_none(),
        "rejected import must not touch target secrets"
    );
}

#[test]
fn import_rejects_corrupted_json_without_touching_target() {
    let dir_a = temp_dir("a");
    let bad = dir_a.join("corrupted.json");
    std::fs::write(&bad, "not-json{{{").unwrap();

    let dir_b = temp_dir("b");
    let config_b = ConfigState::new(&dir_b);
    let secrets_b = test_state(&dir_b);
    let err = import_internal(&config_b, &secrets_b, &bad, "pass123").unwrap_err();
    assert!(err.contains("invalid backup file"), "unexpected error: {err}");
    assert!(load_internal(&config_b).unwrap().is_none());
}

#[test]
fn import_snapshot_with_empty_secrets_succeeds() {
    let dir_a = temp_dir("a");
    let config_a = ConfigState::new(&dir_a);
    let secrets_a = test_state(&dir_a);
    let file = dir_a.join("empty.json");
    export_internal(&config_a, &secrets_a, &file, "pass123", "0.1.6-test").unwrap();

    let dir_b = temp_dir("b");
    let config_b = ConfigState::new(&dir_b);
    let secrets_b = test_state(&dir_b);
    import_internal(&config_b, &secrets_b, &file, "pass123").unwrap();

    let snapshot = load_internal(&config_b).unwrap().expect("empty import still initializes");
    assert!(snapshot.profiles.is_empty());
    assert!(snapshot.quick_commands.is_empty());
    assert!(load_password(&secrets_b, "any").unwrap().is_none());
}
