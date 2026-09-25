//! @description secrets 模块单测：hex/加解密往返与防篡改、密钥生成/查验/列表、
//!              凭据往返、S3 配置往返与「明文不落盘」断言。

use aes_gcm::{Aes256Gcm, KeyInit};

use super::backup::{export_all, replace_all, CredPlain, KeyPlain, SecretsPlain};
use super::creds::{has_password_internal, load_password, remove_password_internal, set_password_internal};
use super::crypto::{decode_hex, decrypt_field, encrypt_field, encode_hex};
use super::keys::{
    generate_key_internal, key_inspect, list_keys_internal, KeyGenerateOptions,
};
use super::sync::{s3_sync_forget, s3_sync_load, s3_sync_store, S3SyncConfig};
use super::SecretsState;

fn temp_state(tag: &str) -> SecretsState {
    let dir = std::env::temp_dir().join(format!("scx-secrets-test-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    super::test_state(&dir)
}

#[test]
fn master_key_round_trips_via_hex() {
    let bytes = [0xABu8; 32];
    let encoded = encode_hex(&bytes);
    assert_eq!(decode_hex(&encoded).unwrap(), bytes);
    assert!(decode_hex("zz").is_err());
}

#[test]
fn field_encryption_round_trip_and_tamper() {
    let dir = std::env::temp_dir().join(format!("scx-secrets-cipher-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let master = {
        let mut key = [0u8; 32];
        getrandom::fill(&mut key).unwrap();
        key
    };
    let cipher = Aes256Gcm::new((&master).into());
    let blob = encrypt_field(&cipher, "secret-pem").unwrap();
    assert_ne!(blob, b"secret-pem".to_vec());
    assert_eq!(decrypt_field(&cipher, &blob).unwrap(), "secret-pem");
    // 篡改一位密文 → 解密失败
    let mut tampered = blob.clone();
    let last = tampered.len() - 1;
    tampered[last] ^= 0xFF;
    assert!(decrypt_field(&cipher, &tampered).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn key_generate_and_list_round_trip() {
    let state = temp_state("gen");
    let meta = generate_key_internal(
        &state,
        &KeyGenerateOptions {
            id: "k1".into(),
            name: "test key".into(),
            algorithm: "ed25519".into(),
            passphrase: None,
            comment: Some("note".into()),
        },
    )
    .unwrap();
    assert_eq!(meta.algorithm, "ed25519");
    assert!(meta.public_key.starts_with("ssh-ed25519 "));
    assert!(meta.fingerprint.starts_with("SHA256:"));
    assert!(!meta.has_passphrase);
    let list = list_keys_internal(&state).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "test key");
}

#[test]
fn key_inspect_validates_content_and_passphrase() {
    let key = russh::keys::ssh_key::PrivateKey::random(
        &mut russh::keys::key::safe_rng(),
        russh::keys::ssh_key::Algorithm::Ed25519,
    )
    .unwrap();
    let plain = key.to_openssh(russh::keys::ssh_key::LineEnding::LF).unwrap().to_string();
    let ok = key_inspect(plain.clone(), None).unwrap();
    assert!(ok.public_key.starts_with("ssh-ed25519 "));
    assert!(ok.fingerprint.starts_with("SHA256:"));
    assert_eq!(ok.algorithm, "ed25519");
    // 加密私钥：正确口令通过，错误口令失败
    let encrypted = key.encrypt(&mut russh::keys::key::safe_rng(), "secret123").unwrap();
    let enc_pem = encrypted.to_openssh(russh::keys::ssh_key::LineEnding::LF).unwrap().to_string();
    assert!(key_inspect(enc_pem.clone(), Some("secret123".into())).is_ok());
    assert!(key_inspect(enc_pem, Some("wrong".into())).is_err());
    // 非法内容失败
    assert!(key_inspect("not a key".into(), None).is_err());
}

#[test]
fn credentials_round_trip() {
    let state = temp_state("cred");
    assert!(!has_password_internal(&state, "p1").unwrap());
    set_password_internal(&state, "p1", "hunter2").unwrap();
    assert!(has_password_internal(&state, "p1").unwrap());
    assert_eq!(load_password(&state, "p1").unwrap().as_deref(), Some("hunter2"));
    remove_password_internal(&state, "p1").unwrap();
    assert_eq!(load_password(&state, "p1").unwrap(), None);
}

#[test]
fn backup_export_and_replace_round_trip() {
    let state = temp_state("backup");
    assert!(export_all(&state).unwrap().ssh_keys.is_empty());
    let plain = SecretsPlain {
        ssh_keys: vec![KeyPlain {
            id: "bk1".into(),
            name: "backup key".into(),
            algorithm: "ed25519".into(),
            public_key: "ssh-ed25519 AAAA".into(),
            fingerprint: "SHA256:xyz".into(),
            comment: String::new(),
            created_at: 1700000000000,
            private_key_pem: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----".into(),
            passphrase: Some("pp".into()),
        }],
        ssh_credentials: vec![CredPlain { profile_id: "p9".into(), password: "pw".into() }],
    };
    replace_all(&state, &plain).unwrap();
    let loaded = export_all(&state).unwrap();
    assert_eq!(loaded.ssh_keys.len(), 1);
    assert_eq!(loaded.ssh_keys[0].id, "bk1");
    assert_eq!(loaded.ssh_keys[0].passphrase.as_deref(), Some("pp"));
    assert_eq!(loaded.ssh_credentials[0].password, "pw");
}

#[test]
fn s3_sync_config_round_trip_and_forget() {
    let state = temp_state("s3cfg");
    assert!(s3_sync_load(&state).unwrap().is_none());
    let config = S3SyncConfig {
        endpoint: "http://127.0.0.1:9000".into(),
        region: "us-east-1".into(),
        bucket: "backups".into(),
        path_style: true,
        access_key: "ak".into(),
        secret_key: "sk-plain-secret".into(),
    };
    s3_sync_store(&state, &config).unwrap();
    let loaded = s3_sync_load(&state).unwrap().expect("stored config must load");
    assert_eq!(loaded.endpoint, config.endpoint);
    assert_eq!(loaded.bucket, config.bucket);
    assert!(loaded.path_style);
    assert_eq!(loaded.secret_key, "sk-plain-secret");
    // secretKey 明文不得落盘
    let raw = std::fs::read(state_db_path(&state)).unwrap();
    assert!(!String::from_utf8_lossy(&raw).contains("sk-plain-secret"));
    s3_sync_forget(&state).unwrap();
    assert!(s3_sync_load(&state).unwrap().is_none());
}

/// 取回 state 底层 secrets.db 文件全路径，供断言密文不落明文
fn state_db_path(state: &SecretsState) -> std::path::PathBuf {
    let conn = state.lock_conn();
    conn.query_row("PRAGMA database_list", [], |row| row.get::<_, String>(2))
        .unwrap()
        .into()
}
