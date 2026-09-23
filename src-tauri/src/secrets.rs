//! @description 敏感数据加密存储：SQLite（secrets.db）+ AES-256-GCM 字段级加密。
//! 主密钥随机生成存 macOS 钥匙串（keyring，service `scx-terminal`/user `master-key`），
//! 密文格式 = 12 字节随机 nonce 前置 + 密文（含 GCM tag）。
//! 存储范围：SSH 密钥链（私钥/口令加密，元数据明文）、SSH 档案密码（按 profileId）。

use std::path::Path;
use std::sync::Mutex;

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

const KEYCHAIN_SERVICE: &str = "scx-terminal";
const KEYCHAIN_USER: &str = "master-key";
const NONCE_LEN: usize = 12;

const SCHEMA_SQL: &str = "CREATE TABLE IF NOT EXISTS ssh_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    public_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    private_key_enc BLOB NOT NULL,
    passphrase_enc BLOB,
    comment TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ssh_credentials (
    profile_id TEXT PRIMARY KEY,
    password_enc BLOB NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS s3_sync (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    endpoint TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'us-east-1',
    bucket TEXT NOT NULL,
    path_style INTEGER NOT NULL DEFAULT 1,
    access_key TEXT NOT NULL,
    secret_key_enc BLOB NOT NULL
);";

/// 打开/建库并初始化 schema
fn open_db(dir: &Path) -> Connection {
    std::fs::create_dir_all(dir).expect("failed to create app data dir");
    let conn = Connection::open(dir.join("secrets.db")).expect("failed to open secrets.db");
    conn.execute_batch(SCHEMA_SQL).expect("failed to init secrets schema");
    conn
}

/// 密钥链条目元数据（私钥本体不出库）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyMeta {
    pub id: String,
    pub name: String,
    pub algorithm: String,
    pub public_key: String,
    pub fingerprint: String,
    pub comment: String,
    pub created_at: i64,
    pub has_passphrase: bool,
}

/// 密钥库状态：SQLite 连接 + 主密钥派生的 AES-256-GCM 实例
pub struct SecretsState {
    conn: Mutex<Connection>,
    cipher: Aes256Gcm,
}

impl SecretsState {
    /// 打开/建库并初始化主密钥；失败直接 panic（无加密库则敏感功能全不可用）
    pub fn new(dir: &Path) -> Self {
        let conn = open_db(dir);
        let master = load_or_create_master_key().expect("failed to load master key");
        let cipher = Aes256Gcm::new((&master).into());
        Self { conn: Mutex::new(conn), cipher }
    }

    /// 测试构造：注入主密钥，绕过系统钥匙串——单测不得依赖/触发钥匙串授权弹窗
    #[cfg(test)]
    pub fn with_master_key(dir: &Path, master: [u8; 32]) -> Self {
        let conn = open_db(dir);
        let cipher = Aes256Gcm::new((&master).into());
        Self { conn: Mutex::new(conn), cipher }
    }
}

/// 测试用：随机主密钥构造（不同实例即不同「机器」，天然覆盖跨机迁移路径）
#[cfg(test)]
pub(crate) fn test_state(dir: &Path) -> SecretsState {
    let mut key = [0u8; 32];
    getrandom::fill(&mut key).expect("random generation failed");
    SecretsState::with_master_key(dir, key)
}

/// 主密钥：钥匙串无则生成 32 随机字节并以 hex 存入；有则读回解析
fn load_or_create_master_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER)
        .map_err(|e| format!("keychain unavailable: {e}"))?;
    match entry.get_password() {
        Ok(secret) => decode_hex(&secret).map_err(|_| "master key in keychain is malformed".to_string()),
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            getrandom::fill(&mut key).map_err(|e| format!("random generation failed: {e}"))?;
            entry.set_password(&encode_hex(&key)).map_err(|e| format!("failed to store master key: {e}"))?;
            Ok(key)
        }
        Err(e) => Err(format!("failed to read master key: {e}")),
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn decode_hex(text: &str) -> Result<[u8; 32], ()> {
    if text.len() != 64 {
        return Err(());
    }
    let mut out = [0u8; 32];
    for (index, chunk) in text.as_bytes().chunks(2).enumerate() {
        let high = (chunk[0] as char).to_digit(16).ok_or(())? as u8;
        let low = (chunk[1] as char).to_digit(16).ok_or(())? as u8;
        out[index] = (high << 4) | low;
    }
    Ok(out)
}

fn encrypt_field(cipher: &Aes256Gcm, plaintext: &str) -> Result<Vec<u8>, String> {
    let mut nonce_bytes = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce_bytes).map_err(|e| format!("random generation failed: {e}"))?;
    let nonce = (&nonce_bytes).into();
    let mut ciphertext = cipher.encrypt(nonce, plaintext.as_bytes()).map_err(|_| "encryption failed".to_string())?;
    let mut blob = nonce_bytes.to_vec();
    blob.append(&mut ciphertext);
    Ok(blob)
}

fn decrypt_field(cipher: &Aes256Gcm, blob: &[u8]) -> Result<String, String> {
    if blob.len() <= NONCE_LEN {
        return Err("ciphertext is truncated".to_string());
    }
    let nonce = Nonce::try_from(&blob[..NONCE_LEN]).map_err(|_| "ciphertext is truncated".to_string())?;
    let plaintext = cipher
        .decrypt(&nonce, &blob[NONCE_LEN..])
        .map_err(|_| "decryption failed (master key mismatch or data corrupted)".to_string())?;
    String::from_utf8(plaintext).map_err(|_| "decrypted data is not valid utf-8".to_string())
}

/// 密钥条目内部结构（含解密后的私钥/口令，仅供认证链使用，不序列化）
pub struct LoadedKey {
    pub private_key_pem: String,
    pub passphrase: Option<String>,
}

/// 备份导出用：密钥条目明文（仅在导出/导入过程内存中转，随后即被口令密文包裹）
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPlain {
    pub id: String,
    pub name: String,
    pub algorithm: String,
    pub public_key: String,
    pub fingerprint: String,
    pub comment: String,
    pub created_at: i64,
    pub private_key_pem: String,
    pub passphrase: Option<String>,
}

/// 备份导出用：档案密码明文
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredPlain {
    pub profile_id: String,
    pub password: String,
}

/// 备份导出用：secrets.db 全量明文集合
#[derive(Debug, Default, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretsPlain {
    pub ssh_keys: Vec<KeyPlain>,
    pub ssh_credentials: Vec<CredPlain>,
}

/// 解密读取全部密钥与凭据（备份导出用；明文不经过前端）
///
/// # Arguments
///
/// * `state` - 加密存储状态
///
/// # Returns
///
/// 全量明文集合
///
/// # Examples
///
/// `let plain = export_all(&state)?;`
pub fn export_all(state: &SecretsState) -> Result<SecretsPlain, String> {
    let conn = state.conn.lock().unwrap();
    let mut ssh_keys = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, algorithm, public_key, fingerprint, comment, created_at,
                        private_key_enc, passphrase_enc
                 FROM ssh_keys ORDER BY created_at DESC",
            )
            .map_err(|e| format!("failed to read ssh keys: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, Vec<u8>>(7)?,
                    row.get::<_, Option<Vec<u8>>>(8)?,
                ))
            })
            .map_err(|e| format!("failed to read ssh keys: {e}"))?;
        for row in rows {
            let (id, name, algorithm, public_key, fingerprint, comment, created_at, private_key_enc, passphrase_enc) =
                row.map_err(|e| format!("failed to read ssh key row: {e}"))?;
            ssh_keys.push(KeyPlain {
                id,
                name,
                algorithm,
                public_key,
                fingerprint,
                comment,
                created_at,
                private_key_pem: decrypt_field(&state.cipher, &private_key_enc)?,
                passphrase: match passphrase_enc {
                    Some(blob) => Some(decrypt_field(&state.cipher, &blob)?),
                    None => None,
                },
            });
        }
    }
    let mut ssh_credentials = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT profile_id, password_enc FROM ssh_credentials ORDER BY profile_id")
            .map_err(|e| format!("failed to read ssh credentials: {e}"))?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?)))
            .map_err(|e| format!("failed to read ssh credentials: {e}"))?;
        for row in rows {
            let (profile_id, password_enc) = row.map_err(|e| format!("failed to read ssh credential row: {e}"))?;
            ssh_credentials.push(CredPlain { profile_id, password: decrypt_field(&state.cipher, &password_enc)? });
        }
    }
    drop(conn);
    Ok(SecretsPlain { ssh_keys, ssh_credentials })
}

/// 全量替换写入（备份导入用；以本机主密钥重加密，单事务 all-or-nothing）
///
/// # Arguments
///
/// * `state` - 加密存储状态
/// * `plain` - 导入的明文集合
///
/// # Examples
///
/// `replace_all(&state, &plain)?;`
pub fn replace_all(state: &SecretsState, plain: &SecretsPlain) -> Result<(), String> {
    // 先在事务外完成全部加密（失败时零写入）
    let mut key_rows = Vec::with_capacity(plain.ssh_keys.len());
    for key in &plain.ssh_keys {
        let private_key_enc = encrypt_field(&state.cipher, &key.private_key_pem)?;
        let passphrase_enc = key
            .passphrase
            .as_deref()
            .filter(|p| !p.is_empty())
            .map(|p| encrypt_field(&state.cipher, p))
            .transpose()?;
        key_rows.push((key, private_key_enc, passphrase_enc));
    }
    let mut cred_rows = Vec::with_capacity(plain.ssh_credentials.len());
    for cred in &plain.ssh_credentials {
        cred_rows.push((cred, encrypt_field(&state.cipher, &cred.password)?));
    }
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM ssh_keys", [])
        .map_err(|e| format!("failed to clear ssh keys: {e}"))?;
    tx.execute("DELETE FROM ssh_credentials", [])
        .map_err(|e| format!("failed to clear ssh credentials: {e}"))?;
    for (key, private_key_enc, passphrase_enc) in key_rows {
        tx.execute(
            "INSERT INTO ssh_keys (id, name, algorithm, public_key, fingerprint, private_key_enc, passphrase_enc, comment, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                key.id,
                key.name,
                key.algorithm,
                key.public_key,
                key.fingerprint,
                private_key_enc,
                passphrase_enc,
                key.comment,
                key.created_at,
            ],
        )
        .map_err(|e| format!("failed to import ssh key {}: {e}", key.id))?;
    }
    let stamp = now_millis();
    for (cred, blob) in cred_rows {
        tx.execute(
            "INSERT INTO ssh_credentials (profile_id, password_enc, updated_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![cred.profile_id, blob, stamp],
        )
        .map_err(|e| format!("failed to import ssh credential {}: {e}", cred.profile_id))?;
    }
    tx.commit().map_err(|e| format!("failed to commit secrets import: {e}"))
}

/// 云端同步（S3 兼容）配置：非敏感字段明文列 + secretKey 加密列；secret 仅存于 Rust 侧
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3SyncConfig {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub path_style: bool,
    pub access_key: String,
    pub secret_key: String,
}

/// 读取云端同步配置（未配置返回 None；secretKey 用主密钥解密，仅供 Rust 侧签名使用）
///
/// # Arguments
///
/// * `state` - 加密存储状态
///
/// # Returns
///
/// 配置或 None
///
/// # Examples
///
/// `if let Some(cfg) = s3_sync_load(&state)? { ... }`
pub fn s3_sync_load(state: &SecretsState) -> Result<Option<S3SyncConfig>, String> {
    let conn = state.conn.lock().unwrap();
    let row = conn
        .query_row(
            "SELECT endpoint, region, bucket, path_style, access_key, secret_key_enc
             FROM s3_sync WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)? != 0,
                    row.get::<_, String>(4)?,
                    row.get::<_, Vec<u8>>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|e| format!("failed to read s3 sync config: {e}"))?;
    drop(conn);
    match row {
        None => Ok(None),
        Some((endpoint, region, bucket, path_style, access_key, secret_enc)) => Ok(Some(S3SyncConfig {
            endpoint,
            region,
            bucket,
            path_style,
            access_key,
            secret_key: decrypt_field(&state.cipher, &secret_enc)?,
        })),
    }
}

/// 保存/覆盖云端同步配置（secretKey 入库前加密；单行表）
///
/// # Arguments
///
/// * `state` - 加密存储状态
/// * `config` - 完整配置（含 secretKey 明文）
///
/// # Examples
///
/// `s3_sync_store(&state, &config)?;`
pub fn s3_sync_store(state: &SecretsState, config: &S3SyncConfig) -> Result<(), String> {
    let secret_enc = encrypt_field(&state.cipher, &config.secret_key)?;
    let conn = state.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO s3_sync (id, endpoint, region, bucket, path_style, access_key, secret_key_enc)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            endpoint = excluded.endpoint,
            region = excluded.region,
            bucket = excluded.bucket,
            path_style = excluded.path_style,
            access_key = excluded.access_key,
            secret_key_enc = excluded.secret_key_enc",
        rusqlite::params![
            config.endpoint,
            config.region,
            config.bucket,
            config.path_style as i64,
            config.access_key,
            secret_enc
        ],
    )
    .map_err(|e| format!("failed to save s3 sync config: {e}"))?;
    Ok(())
}

/// 清除云端同步配置
///
/// # Arguments
///
/// * `state` - 加密存储状态
///
/// # Examples
///
/// `s3_sync_forget(&state)?;`
pub fn s3_sync_forget(state: &SecretsState) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    conn.execute("DELETE FROM s3_sync WHERE id = 1", [])
        .map_err(|e| format!("failed to clear s3 sync config: {e}"))?;
    Ok(())
}

/// 认证链内部读取：按 keyId 解密私钥与口令
pub fn load_private_key(state: &SecretsState, key_id: &str) -> Result<LoadedKey, String> {
    let conn = state.conn.lock().unwrap();
    let value = conn
        .query_row(
            "SELECT private_key_enc, passphrase_enc FROM ssh_keys WHERE id = ?1",
            [key_id],
            |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Option<Vec<u8>>>(1)?)),
        )
        .map_err(|e| format!("keychain entry not found: {e}"))?;
    let private_key_pem = decrypt_field(&state.cipher, &value.0)?;
    let passphrase = match value.1 {
        Some(blob) => Some(decrypt_field(&state.cipher, &blob)?),
        None => None,
    };
    Ok(LoadedKey { private_key_pem, passphrase })
}

/// 认证链内部读取：按档案 id 解密已存密码；未设置返回 None
pub fn load_password(state: &SecretsState, profile_id: &str) -> Result<Option<String>, String> {
    let conn = state.conn.lock().unwrap();
    let blob = match conn
        .query_row(
            "SELECT password_enc FROM ssh_credentials WHERE profile_id = ?1",
            [profile_id],
            |row| row.get::<_, Vec<u8>>(0),
        )
    {
        Ok(blob) => blob,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(format!("failed to read stored password: {e}")),
    };
    decrypt_field(&state.cipher, &blob).map(Some)
}

fn row_to_meta(row: &rusqlite::Row<'_>) -> rusqlite::Result<SshKeyMeta> {
    Ok(SshKeyMeta {
        id: row.get(0)?,
        name: row.get(1)?,
        algorithm: row.get(2)?,
        public_key: row.get(3)?,
        fingerprint: row.get(4)?,
        comment: row.get(5)?,
        created_at: row.get(6)?,
        has_passphrase: row.get::<_, Option<Vec<u8>>>(7)?.is_some(),
    })
}

const KEY_META_COLUMNS: &str =
    "id, name, algorithm, public_key, fingerprint, comment, created_at, passphrase_enc";

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyGenerateOptions {
    pub id: String,
    pub name: String,
    /// ed25519 | rsa
    pub algorithm: String,
    /// 加密私钥的口令（可空 = 不加密私钥本体）
    pub passphrase: Option<String>,
    pub comment: Option<String>,
}

/// 应用内生成密钥对（ed25519/rsa），私钥（可选 passphrase 加密）加密入库，返回公钥元数据
///
/// # Arguments
///
/// * `app` - AppHandle（定位应用数据目录）——预留，当前未用
/// * `state` - 加密存储状态
/// * `options` - id/name/algorithm/passphrase/comment
///
/// # Returns
///
/// 密钥条目元数据（含公钥与指纹）
///
/// # Examples
///
/// `invoke('key_generate', { options: { id, name, algorithm: 'ed25519' } })`
fn generate_key_internal(state: &SecretsState, options: &KeyGenerateOptions) -> Result<SshKeyMeta, String> {
    let algorithm = match options.algorithm.as_str() {
        "rsa" => russh::keys::ssh_key::Algorithm::Rsa { hash: None },
        _ => russh::keys::ssh_key::Algorithm::Ed25519,
    };
    let mut private_key = russh::keys::ssh_key::PrivateKey::random(
        &mut russh::keys::key::safe_rng(),
        algorithm,
    )
    .map_err(|e| format!("key generation failed: {e}"))?;
    if let Some(passphrase) = options.passphrase.as_deref().filter(|p| !p.is_empty()) {
        private_key = private_key
            .encrypt(&mut russh::keys::key::safe_rng(), passphrase)
            .map_err(|e| format!("key encryption failed: {e}"))?;
    }
    let pem = private_key
        .to_openssh(russh::keys::ssh_key::LineEnding::LF)
        .map_err(|e| format!("key serialization failed: {e}"))?
        .to_string();
    insert_key(state, &options.id, &options.name, &options.algorithm, &private_key, &pem, options.passphrase.as_deref(), options.comment.as_deref().unwrap_or(""))
}

/// 命令包装：应用内生成密钥对（见 generate_key_internal）
#[tauri::command]
pub fn key_generate(state: State<'_, SecretsState>, options: KeyGenerateOptions) -> Result<SshKeyMeta, String> {
    generate_key_internal(&state, &options)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyImportOptions {
    pub id: String,
    pub name: String,
    /// 私钥内容（OpenSSH/PKCS8 PEM）；与 sourcePath 二选一（拖放导入走路径）
    pub content: Option<String>,
    /// 私钥文件绝对路径（拖放导入时由 Tauri drag-drop 事件提供）
    pub source_path: Option<String>,
    /// 私钥已加密时用于解密的口令
    pub passphrase: Option<String>,
    pub comment: Option<String>,
}

/// 解析导入入参：content 与 sourcePath 二选一，返回私钥 PEM
fn resolve_import_pem(options: &KeyImportOptions) -> Result<String, String> {
    if let Some(content) = options.content.as_deref().filter(|c| !c.trim().is_empty()) {
        return Ok(content.to_string());
    }
    if let Some(path) = options.source_path.as_deref().filter(|p| !p.trim().is_empty()) {
        return std::fs::read_to_string(path).map_err(|e| format!("failed to read key file: {e}"));
    }
    Err("no key content or source path provided".to_string())
}

/// key_inspect 的返回结构
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyInspection {
    pub public_key: String,
    pub fingerprint: String,
    pub algorithm: String,
}

/// 验证私钥并推导元数据（不存储）——前端粘贴/修改私钥后防抖调用，自动填充公钥与指纹
///
/// # Arguments
///
/// * `content` - 私钥内容（OpenSSH/PKCS8 PEM）
/// * `passphrase` - 加密私钥的口令（可空）
///
/// # Returns
///
/// 公钥 one-line、SHA256 指纹、算法标签
///
/// # Examples
///
/// `invoke('key_inspect', { content, passphrase })`
#[tauri::command]
pub fn key_inspect(content: String, passphrase: Option<String>) -> Result<SshKeyInspection, String> {
    let private_key = russh::keys::decode_secret_key(&content, passphrase.as_deref())
        .map_err(|e| format!("failed to decode private key (wrong passphrase?): {e}"))?;
    Ok(SshKeyInspection {
        public_key: private_key.public_key().to_openssh().unwrap_or_default(),
        fingerprint: private_key.public_key().fingerprint(russh::keys::ssh_key::HashAlg::Sha256).to_string(),
        algorithm: algorithm_label(&private_key),
    })
}

/// 导入私钥：解码验证（加密钥须口令正确）后加密入库；content 与 sourcePath 二选一
///
/// # Arguments
///
/// * `state` - 加密存储状态
/// * `options` - id/name/content|sourcePath/passphrase/comment
///
/// # Returns
///
/// 密钥条目元数据
///
/// # Examples
///
/// `invoke('key_import', { options: { id, name, content } })`
#[tauri::command]
pub fn key_import(state: State<'_, SecretsState>, options: KeyImportOptions) -> Result<SshKeyMeta, String> {
    import_key_internal(&state, &options)
}

fn import_key_internal(state: &SecretsState, options: &KeyImportOptions) -> Result<SshKeyMeta, String> {
    let content = resolve_import_pem(options)?;
    let private_key = russh::keys::decode_secret_key(&content, options.passphrase.as_deref())
        .map_err(|e| format!("failed to decode private key (wrong passphrase?): {e}"))?;
    let algorithm = algorithm_label(&private_key);
    let public_key = private_key.public_key().to_openssh().unwrap_or_default();
    let fingerprint = private_key.public_key().fingerprint(russh::keys::ssh_key::HashAlg::Sha256).to_string();
    let conn = state.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO ssh_keys (id, name, algorithm, public_key, fingerprint, private_key_enc, passphrase_enc, comment, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            options.id,
            options.name,
            algorithm,
            public_key,
            fingerprint,
            encrypt_field(&state.cipher, &content)?,
            options.passphrase.as_deref().filter(|p| !p.is_empty()).map(|p| encrypt_field(&state.cipher, p)).transpose()?,
            options.comment.as_deref().unwrap_or(""),
            now_millis(),
        ],
    )
    .map_err(|e| format!("failed to save key: {e}"))?;
    drop(conn);
    key_get_meta(state, &options.id)
}

fn insert_key(
    state: &SecretsState,
    id: &str,
    name: &str,
    algorithm: &str,
    private_key: &russh::keys::ssh_key::PrivateKey,
    pem: &str,
    passphrase: Option<&str>,
    comment: &str,
) -> Result<SshKeyMeta, String> {
    let public_key = private_key.public_key().to_openssh().unwrap_or_default();
    let fingerprint = private_key.public_key().fingerprint(russh::keys::ssh_key::HashAlg::Sha256).to_string();
    let conn = state.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO ssh_keys (id, name, algorithm, public_key, fingerprint, private_key_enc, passphrase_enc, comment, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            id,
            name,
            algorithm,
            public_key,
            fingerprint,
            encrypt_field(&state.cipher, pem)?,
            passphrase.filter(|p| !p.is_empty()).map(|p| encrypt_field(&state.cipher, p)).transpose()?,
            comment,
            now_millis(),
        ],
    )
    .map_err(|e| format!("failed to save key: {e}"))?;
    drop(conn);
    key_get_meta(state, id)
}

fn algorithm_label(private_key: &russh::keys::ssh_key::PrivateKey) -> String {
    match private_key.algorithm() {
        russh::keys::ssh_key::Algorithm::Ed25519 => "ed25519".to_string(),
        russh::keys::ssh_key::Algorithm::Rsa { .. } => "rsa".to_string(),
        russh::keys::ssh_key::Algorithm::Ecdsa { curve } => format!("ecdsa-{curve:?}").to_lowercase(),
        other => format!("{other:?}").to_lowercase(),
    }
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn key_get_meta(state: &SecretsState, id: &str) -> Result<SshKeyMeta, String> {
    let conn = state.conn.lock().unwrap();
    conn.query_row(
        &format!("SELECT {KEY_META_COLUMNS} FROM ssh_keys WHERE id = ?1"),
        [id],
        row_to_meta,
    )
    .map_err(|e| format!("key not found after save: {e}"))
}

/// 列出密钥链条目元数据（按创建时间倒序；私钥不出库）
///
/// # Arguments
///
/// * `state` - 加密存储状态
///
/// # Returns
///
/// 条目元数据列表
///
/// # Examples
///
/// `invoke('key_list')`
fn list_keys_internal(state: &SecretsState) -> Result<Vec<SshKeyMeta>, String> {
    let conn = state.conn.lock().unwrap();
    let mut statement = conn
        .prepare(&format!("SELECT {KEY_META_COLUMNS} FROM ssh_keys ORDER BY created_at DESC"))
        .map_err(|e| format!("failed to list keys: {e}"))?;
    let rows = statement
        .query_map([], row_to_meta)
        .map_err(|e| format!("failed to list keys: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("failed to read key row: {e}"))?);
    }
    Ok(out)
}

/// 命令包装：列出条目（见 list_keys_internal）
#[tauri::command]
pub fn key_list(state: State<'_, SecretsState>) -> Result<Vec<SshKeyMeta>, String> {
    list_keys_internal(&state)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyUpdateOptions {
    pub id: String,
    pub name: Option<String>,
    pub comment: Option<String>,
}

/// 更新条目元数据（重命名/备注）
///
/// # Arguments
///
/// * `state` - 加密存储状态
/// * `options` - id + 可选 name/comment
///
/// # Examples
///
/// `invoke('key_update', { options: { id, name: '新名字' } })`
fn update_key_internal(state: &SecretsState, options: &KeyUpdateOptions) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    if let Some(name) = &options.name {
        conn.execute("UPDATE ssh_keys SET name = ?1 WHERE id = ?2", rusqlite::params![name, options.id])
            .map_err(|e| format!("failed to update key: {e}"))?;
    }
    if let Some(comment) = &options.comment {
        conn.execute("UPDATE ssh_keys SET comment = ?1 WHERE id = ?2", rusqlite::params![comment, options.id])
            .map_err(|e| format!("failed to update key: {e}"))?;
    }
    Ok(())
}

/// 命令包装：更新条目（见 update_key_internal）
#[tauri::command]
pub fn key_update(state: State<'_, SecretsState>, options: KeyUpdateOptions) -> Result<(), String> {
    update_key_internal(&state, &options)
}

/// 删除密钥条目（私钥密文随行删除；引用它的档案由前端同步置空 keyId）
///
/// # Arguments
///
/// * `state` - 加密存储状态
/// * `id` - 条目 id
///
/// # Examples
///
/// `invoke('key_delete', { id })`
fn delete_key_internal(state: &SecretsState, id: &str) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    conn.execute("DELETE FROM ssh_keys WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete key: {e}"))?;
    Ok(())
}

/// 命令包装：删除条目（见 delete_key_internal）
#[tauri::command]
pub fn key_delete(state: State<'_, SecretsState>, id: String) -> Result<(), String> {
    delete_key_internal(&state, &id)
}

/// 设置/覆盖档案密码（加密入库）
///
/// # Arguments
///
/// * `state` - 加密存储状态
/// * `profileId` - 档案 id
/// * `password` - 密码明文（入库前加密）
///
/// # Examples
///
/// `invoke('cred_set_password', { profileId, password })`
fn set_password_internal(state: &SecretsState, profile_id: &str, password: &str) -> Result<(), String> {
    let blob = encrypt_field(&state.cipher, password)?;
    let conn = state.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO ssh_credentials (profile_id, password_enc, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(profile_id) DO UPDATE SET password_enc = excluded.password_enc, updated_at = excluded.updated_at",
        rusqlite::params![profile_id, blob, now_millis()],
    )
    .map_err(|e| format!("failed to save password: {e}"))?;
    Ok(())
}

/// 命令包装：设置档案密码（见 set_password_internal）
#[tauri::command]
pub fn cred_set_password(state: State<'_, SecretsState>, profile_id: String, password: String) -> Result<(), String> {
    set_password_internal(&state, &profile_id, &password)
}

/// 清除档案密码
///
/// # Arguments
///
/// * `state` - 加密存储状态
/// * `profileId` - 档案 id
///
/// # Examples
///
/// `invoke('cred_remove', { profileId })`
fn remove_password_internal(state: &SecretsState, profile_id: &str) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    conn.execute("DELETE FROM ssh_credentials WHERE profile_id = ?1", [profile_id])
        .map_err(|e| format!("failed to remove password: {e}"))?;
    Ok(())
}

/// 命令包装：清除档案密码（见 remove_password_internal）
#[tauri::command]
pub fn cred_remove(state: State<'_, SecretsState>, profile_id: String) -> Result<(), String> {
    remove_password_internal(&state, &profile_id)
}

/// 查询档案是否已设置密码（不返回内容）
///
/// # Arguments
///
/// * `state` - 加密存储状态
/// * `profileId` - 档案 id
///
/// # Returns
///
/// 已设置返回 true
///
/// # Examples
///
/// `invoke('cred_has_password', { profileId })`
fn has_password_internal(state: &SecretsState, profile_id: &str) -> Result<bool, String> {
    let conn = state.conn.lock().unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ssh_credentials WHERE profile_id = ?1",
            [&profile_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("failed to query password state: {e}"))?;
    Ok(count > 0)
}

/// 命令包装：查询档案密码状态（见 has_password_internal）
#[tauri::command]
pub fn cred_has_password(state: State<'_, SecretsState>, profile_id: String) -> Result<bool, String> {
    has_password_internal(&state, &profile_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_state(tag: &str) -> SecretsState {
        let dir = std::env::temp_dir().join(format!("scx-secrets-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        test_state(&dir)
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
        let conn = state.conn.lock().unwrap();
        conn.query_row("PRAGMA database_list", [], |row| row.get::<_, String>(2))
            .unwrap()
            .into()
    }
}
