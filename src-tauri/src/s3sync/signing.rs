//! @description AWS SigV4 手签纯函数：哈希/HMAC、严格 URI 编码、canonical request、
//! string-to-sign、四级签名密钥派生与 Authorization 头组装（无 IO，可独立单测）。

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

/// SHA256 摘要 hex（小写）
pub(crate) fn sha256_hex(data: &[u8]) -> String {
    hex_encode(&Sha256::digest(data))
}

/// 字节转 hex（小写）
pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// HMAC-SHA256（HMAC 接受任意长度密钥，new_from_slice 不会失败）
fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("hmac accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// AWS 严格 URI 编码：仅 A-Za-z0-9-._~ 不转义；'/' 是否保留由 keep_slash 控制（路径保、查询值不保）
pub(crate) fn uri_encode(value: &str, keep_slash: bool) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => out.push(byte as char),
            b'/' if keep_slash => out.push('/'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// 组装 canonical request（header 名要求小写；函数内按名排序保证规范序）
pub(crate) fn canonical_request(
    method: &str,
    uri: &str,
    query: &str,
    headers: &[(String, String)],
    payload_sha256: &str,
) -> String {
    let mut sorted: Vec<&(String, String)> = headers.iter().collect();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));
    let headers_block: String = sorted.iter().map(|(name, value)| format!("{name}:{value}\n")).collect();
    let signed = sorted.iter().map(|(name, _)| name.as_str()).collect::<Vec<_>>().join(";");
    format!("{method}\n{uri}\n{query}\n{headers_block}\n{signed}\n{payload_sha256}")
}

/// 规范化查询串：按编码后的 key=value 排序 + AWS 严格编码
pub(crate) fn canonical_query(params: &[(String, String)]) -> String {
    let mut encoded: Vec<String> = params
        .iter()
        .map(|(key, value)| format!("{}={}", uri_encode(key, false), uri_encode(value, false)))
        .collect();
    encoded.sort();
    encoded.join("&")
}

/// string-to-sign：算法行 + 时间戳 + scope + canonical request 的 SHA256 hex
pub(crate) fn string_to_sign(amz_date: &str, scope: &str, canonical_request: &str) -> String {
    format!("AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}", sha256_hex(canonical_request.as_bytes()))
}

/// 四级 HMAC 链派生签名密钥：AWS4+secret → date → region → service → aws4_request
pub(crate) fn signing_key(secret: &str, date: &str, region: &str, service: &str) -> Vec<u8> {
    let k_date = hmac_sha256(format!("AWS4{secret}").as_bytes(), date.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    hmac_sha256(&k_service, b"aws4_request")
}

/// 组装 Authorization 头
pub(crate) fn authorization_header(
    access_key: &str,
    scope: &str,
    signed_headers: &str,
    key: &[u8],
    string_to_sign: &str,
) -> String {
    let signature = hex_encode(&hmac_sha256(key, string_to_sign.as_bytes()));
    format!("AWS4-HMAC-SHA256 Credential={access_key}/{scope}, SignedHeaders={signed_headers}, Signature={signature}")
}
