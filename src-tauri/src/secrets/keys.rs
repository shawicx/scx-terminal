//! @description 密钥链 CRUD 与解析：生成/导入/查验/列表/更新/删除 SSH 私钥条目，
//!              私钥与口令以主密钥加密入库，元数据（公钥/指纹）明文。

use serde::Serialize;
use tauri::State;

use super::crypto::{decrypt_field, encrypt_field};
use super::{now_millis, SecretsState, SshKeyMeta};

/// 密钥条目内部结构（含解密后的私钥/口令，仅供认证链使用，不序列化）
pub struct LoadedKey {
    pub private_key_pem: String,
    pub passphrase: Option<String>,
}

/// 认证链内部读取：按 keyId 解密私钥与口令
pub fn load_private_key(state: &SecretsState, key_id: &str) -> Result<LoadedKey, String> {
    let conn = state.lock_conn();
    let value = conn
        .query_row(
            "SELECT private_key_enc, passphrase_enc FROM ssh_keys WHERE id = ?1",
            [key_id],
            |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Option<Vec<u8>>>(1)?)),
        )
        .map_err(|e| format!("keychain entry not found: {e}"))?;
    let private_key_pem = decrypt_field(state.cipher(), &value.0)?;
    let passphrase = match value.1 {
        Some(blob) => Some(decrypt_field(state.cipher(), &blob)?),
        None => None,
    };
    Ok(LoadedKey { private_key_pem, passphrase })
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
pub(super) fn generate_key_internal(state: &SecretsState, options: &KeyGenerateOptions) -> Result<SshKeyMeta, String> {
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
    let conn = state.lock_conn();
    conn.execute(
        "INSERT INTO ssh_keys (id, name, algorithm, public_key, fingerprint, private_key_enc, passphrase_enc, comment, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            options.id,
            options.name,
            algorithm,
            public_key,
            fingerprint,
            encrypt_field(state.cipher(), &content)?,
            options.passphrase.as_deref().filter(|p| !p.is_empty()).map(|p| encrypt_field(state.cipher(), p)).transpose()?,
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
    let conn = state.lock_conn();
    conn.execute(
        "INSERT INTO ssh_keys (id, name, algorithm, public_key, fingerprint, private_key_enc, passphrase_enc, comment, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            id,
            name,
            algorithm,
            public_key,
            fingerprint,
            encrypt_field(state.cipher(), pem)?,
            passphrase.filter(|p| !p.is_empty()).map(|p| encrypt_field(state.cipher(), p)).transpose()?,
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

fn key_get_meta(state: &SecretsState, id: &str) -> Result<SshKeyMeta, String> {
    let conn = state.lock_conn();
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
pub(super) fn list_keys_internal(state: &SecretsState) -> Result<Vec<SshKeyMeta>, String> {
    let conn = state.lock_conn();
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
    let conn = state.lock_conn();
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
    let conn = state.lock_conn();
    conn.execute("DELETE FROM ssh_keys WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete key: {e}"))?;
    Ok(())
}

/// 命令包装：删除条目（见 delete_key_internal）
#[tauri::command]
pub fn key_delete(state: State<'_, SecretsState>, id: String) -> Result<(), String> {
    delete_key_internal(&state, &id)
}
