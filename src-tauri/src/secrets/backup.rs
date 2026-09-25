//! @description 备份导出/导入：secrets.db 全量明文集合的解密读出与
//!              以本机主密钥重加密的全量替换写入（单事务 all-or-nothing）。

use serde::{Deserialize, Serialize};

use super::crypto::{decrypt_field, encrypt_field};
use super::{now_millis, SecretsState};

/// 备份导出用：密钥条目明文（仅在导出/导入过程内存中转，随后即被口令密文包裹）
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredPlain {
    pub profile_id: String,
    pub password: String,
}

/// 备份导出用：secrets.db 全量明文集合
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
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
    let conn = state.lock_conn();
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
                private_key_pem: decrypt_field(state.cipher(), &private_key_enc)?,
                passphrase: match passphrase_enc {
                    Some(blob) => Some(decrypt_field(state.cipher(), &blob)?),
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
            ssh_credentials.push(CredPlain { profile_id, password: decrypt_field(state.cipher(), &password_enc)? });
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
        let private_key_enc = encrypt_field(state.cipher(), &key.private_key_pem)?;
        let passphrase_enc = key
            .passphrase
            .as_deref()
            .filter(|p| !p.is_empty())
            .map(|p| encrypt_field(state.cipher(), p))
            .transpose()?;
        key_rows.push((key, private_key_enc, passphrase_enc));
    }
    let mut cred_rows = Vec::with_capacity(plain.ssh_credentials.len());
    for cred in &plain.ssh_credentials {
        cred_rows.push((cred, encrypt_field(state.cipher(), &cred.password)?));
    }
    let mut conn = state.lock_conn();
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
