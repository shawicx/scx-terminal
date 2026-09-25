//! @description 主密钥与字段级加解密：钥匙串读写（TOFU 生成）、hex 编解码、
//!              AES-256-GCM nonce 前置密文格式的封装与解封。

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, Nonce};

use super::{KEYCHAIN_SERVICE, KEYCHAIN_USER};

const NONCE_LEN: usize = 12;

/// 主密钥：钥匙串无则生成 32 随机字节并以 hex 存入；有则读回解析
pub(super) fn load_or_create_master_key() -> Result<[u8; 32], String> {
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

pub(super) fn encode_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

pub(super) fn decode_hex(text: &str) -> Result<[u8; 32], ()> {
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

pub(super) fn encrypt_field(cipher: &Aes256Gcm, plaintext: &str) -> Result<Vec<u8>, String> {
    let mut nonce_bytes = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce_bytes).map_err(|e| format!("random generation failed: {e}"))?;
    let nonce = (&nonce_bytes).into();
    let mut ciphertext = cipher.encrypt(nonce, plaintext.as_bytes()).map_err(|_| "encryption failed".to_string())?;
    let mut blob = nonce_bytes.to_vec();
    blob.append(&mut ciphertext);
    Ok(blob)
}

pub(super) fn decrypt_field(cipher: &Aes256Gcm, blob: &[u8]) -> Result<String, String> {
    if blob.len() <= NONCE_LEN {
        return Err("ciphertext is truncated".to_string());
    }
    let nonce = Nonce::try_from(&blob[..NONCE_LEN]).map_err(|_| "ciphertext is truncated".to_string())?;
    let plaintext = cipher
        .decrypt(&nonce, &blob[NONCE_LEN..])
        .map_err(|_| "decryption failed (master key mismatch or data corrupted)".to_string())?;
    String::from_utf8(plaintext).map_err(|_| "decrypted data is not valid utf-8".to_string())
}
