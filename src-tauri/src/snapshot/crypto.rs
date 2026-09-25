//! 凭据密文段的口令加密：Argon2id 派生 32 字节密钥 + AES-256-GCM（nonce 随机）。

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

use super::model::{BackupSecrets, KdfParams};

/// Argon2id 内存成本（KiB，OWASP 推荐档）
const KDF_M_KIB: u32 = 19456;
/// Argon2id 时间成本
const KDF_T: u32 = 2;
/// Argon2id 并行度
const KDF_P: u32 = 1;
/// KDF 盐长度（字节）
const SALT_LEN: usize = 16;
/// AES-GCM nonce 长度（字节）
const NONCE_LEN: usize = 12;

/// 口令派生 32 字节密钥（参数随快照携带，导入端按同参数重派生）
fn derive_key(passphrase: &str, kdf: &KdfParams) -> Result<[u8; 32], String> {
    if kdf.algo != "argon2id" {
        return Err("invalid backup file: unsupported kdf algorithm".to_string());
    }
    let salt = B64
        .decode(kdf.salt.as_bytes())
        .map_err(|_| "invalid backup file: bad kdf salt".to_string())?;
    let params =
        Params::new(kdf.m, kdf.t, kdf.p, Some(32)).map_err(|e| format!("invalid backup file: bad kdf params: {e}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon
        .hash_password_into(passphrase.as_bytes(), &salt, &mut key)
        .map_err(|_| "invalid backup file: kdf failed".to_string())?;
    Ok(key)
}

/// 用口令包裹 secrets 明文 JSON：Argon2id 派生 32 字节密钥 → AES-256-GCM（nonce 随机）
pub(crate) fn wrap_secrets(plaintext_json: &str, passphrase: &str) -> Result<BackupSecrets, String> {
    let mut salt = [0u8; SALT_LEN];
    getrandom::fill(&mut salt).map_err(|e| format!("random generation failed: {e}"))?;
    let kdf =
        KdfParams { algo: "argon2id".into(), salt: B64.encode(salt), m: KDF_M_KIB, t: KDF_T, p: KDF_P };
    let key = derive_key(passphrase, &kdf)?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce_bytes).map_err(|e| format!("random generation failed: {e}"))?;
    let cipher = Aes256Gcm::new((&key).into());
    let nonce = Nonce::try_from(nonce_bytes.as_slice()).map_err(|_| "encryption failed".to_string())?;
    let ciphertext = cipher
        .encrypt(&nonce, plaintext_json.as_bytes())
        .map_err(|_| "encryption failed".to_string())?;
    Ok(BackupSecrets { kdf, nonce: B64.encode(nonce_bytes), ciphertext: B64.encode(ciphertext) })
}

/// 解包 secrets 密文段；口令错误与文件损坏统一报错（不区分，防探测）
pub(crate) fn unwrap_secrets(secrets: &BackupSecrets, passphrase: &str) -> Result<String, String> {
    let key = derive_key(passphrase, &secrets.kdf)?;
    let nonce_bytes = B64
        .decode(secrets.nonce.as_bytes())
        .map_err(|_| "invalid backup file: bad nonce".to_string())?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err("invalid backup file: bad nonce".to_string());
    }
    let ciphertext = B64
        .decode(secrets.ciphertext.as_bytes())
        .map_err(|_| "invalid backup file: bad ciphertext".to_string())?;
    let cipher = Aes256Gcm::new((&key).into());
    let nonce = Nonce::try_from(nonce_bytes.as_slice())
        .map_err(|_| "invalid backup file: bad nonce".to_string())?;
    let plain = cipher
        .decrypt(&nonce, ciphertext.as_slice())
        .map_err(|_| "口令错误或文件损坏".to_string())?;
    String::from_utf8(plain).map_err(|_| "口令错误或文件损坏".to_string())
}
