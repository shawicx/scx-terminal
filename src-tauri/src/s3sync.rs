//! @description 配置云端同步（S3 兼容，MinIO 先行）：reqwest + 手签 AWS SigV4。
//! 快照复用 snapshot.rs（build_snapshot / parse_and_apply），凭据存 secrets.db
//! s3_sync 表（secretKey 加密列）。对象布局 backups/{deviceId}.json，每设备一对象；
//! 手动 push/pull，无自动同步；path-style 寻址默认（AWS virtual-host 留 pathStyle 开关）。

use std::time::Duration;

use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::config::{meta_get, meta_set, ConfigState};
use crate::secrets::{s3_sync_forget, s3_sync_load, s3_sync_store, S3SyncConfig, SecretsState};
use crate::snapshot::{build_snapshot, parse_and_apply};

/// SigV4 service 标识（S3 兼容服务固定 s3）
const SERVICE: &str = "s3";
/// 请求超时（连接 + 总时长，LAN/公网 MinIO 均够用）
const TIMEOUT_SECS: u64 = 10;
/// 对象键前缀（每设备一对象：backups/{deviceId}.json）
const KEY_PREFIX: &str = "backups/";
/// 云端同步配置未设置的统一错误
const NOT_CONFIGURED: &str = "s3 sync is not configured";

/// 云端同步配置的前端视图（secretKey 永不回传）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct S3SyncConfigView {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub path_style: bool,
    pub access_key: String,
    pub has_secret_key: bool,
}

/// 云端设备快照条目（LIST 解析结果）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSnapshot {
    pub key: String,
    pub device_id: String,
    pub last_modified: String,
    pub size: i64,
}

/// push 结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub key: String,
    pub size: u64,
}

// ---- SigV4 纯函数 ----

type HmacSha256 = Hmac<Sha256>;

/// SHA256 摘要 hex（小写）
fn sha256_hex(data: &[u8]) -> String {
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
fn uri_encode(value: &str, keep_slash: bool) -> String {
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

// ---- 请求执行层（reqwest blocking）----

/// 一次签名请求的目标要素
struct RequestTarget {
    url: String,
    host_header: String,
    path: String,
    amz_date: String,
    date: String,
    scope: String,
}

/// 计算目标 URL / 签名 host 头 / 规范路径与日期要素（path-style 与 virtual-host 二选一）
fn build_target(config: &S3SyncConfig, key_path: &str) -> Result<RequestTarget, String> {
    let endpoint = config.endpoint.trim_end_matches('/');
    let base = reqwest::Url::parse(endpoint).map_err(|_| format!("invalid s3 endpoint: {endpoint}"))?;
    let host = base.host_str().ok_or_else(|| format!("invalid s3 endpoint: {endpoint}"))?;
    let port_suffix = match base.port() {
        Some(port) => format!(":{port}"),
        None => String::new(),
    };
    let (host_header, path) = if config.path_style {
        let bucket = uri_encode(&config.bucket, false);
        if key_path.is_empty() {
            (format!("{host}{port_suffix}"), format!("/{bucket}"))
        } else {
            (format!("{host}{port_suffix}"), format!("/{bucket}/{}", uri_encode(key_path, true)))
        }
    } else {
        let bucket = uri_encode(&config.bucket, false);
        (
            format!("{bucket}.{host}{port_suffix}"),
            if key_path.is_empty() { "/".to_string() } else { format!("/{}", uri_encode(key_path, true)) },
        )
    };
    let now = Utc::now();
    Ok(RequestTarget {
        url: format!("{}://{host_header}{path}", base.scheme()),
        host_header,
        path,
        amz_date: now.format("%Y%m%dT%H%M%SZ").to_string(),
        date: now.format("%Y%m%d").to_string(),
        scope: format!("{}/{}/{SERVICE}/aws4_request", now.format("%Y%m%d"), config.region),
    })
}

/// 构造并发出签名请求；网络层错误统一为「failed to reach object storage」前缀
fn execute(
    config: &S3SyncConfig,
    method: &str,
    key_path: &str,
    query_params: &[(String, String)],
    body: Vec<u8>,
) -> Result<reqwest::blocking::Response, String> {
    let target = build_target(config, key_path)?;
    let query = canonical_query(query_params);
    let payload_sha = sha256_hex(&body);
    let signed_headers = "host;x-amz-content-sha256;x-amz-date";
    let headers = vec![
        ("host".to_string(), target.host_header.clone()),
        ("x-amz-content-sha256".to_string(), payload_sha.clone()),
        ("x-amz-date".to_string(), target.amz_date.clone()),
    ];
    let canonical = canonical_request(method, &target.path, &query, &headers, &payload_sha);
    let sts = string_to_sign(&target.amz_date, &target.scope, &canonical);
    let key = signing_key(&config.secret_key, &target.date, &config.region, SERVICE);
    let auth = authorization_header(&config.access_key, &target.scope, signed_headers, &key, &sts);

    let url = if query.is_empty() { target.url.clone() } else { format!("{}?{query}", target.url) };
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("failed to build http client: {e}"))?;
    let mut request = client
        .request(reqwest::Method::from_bytes(method.as_bytes()).expect("method is a constant"), &url)
        .header("host", reqwest::header::HeaderValue::from_str(&target.host_header).map_err(|_| "invalid host header".to_string())?)
        .header("x-amz-date", &target.amz_date)
        .header("x-amz-content-sha256", &payload_sha)
        .header("authorization", &auth);
    if method == "PUT" {
        request = request.body(body);
    }
    request.send().map_err(|e| format!("failed to reach object storage: {e}"))
}

/// 从 S3 错误响应体解析 <Error><Code>/<Message>；无正文或非错误结构返回 None
fn parse_error_body(body: &str) -> Option<String> {
    let doc = roxmltree::Document::parse(body).ok()?;
    let root = doc.root_element();
    if root.tag_name().name() != "Error" {
        return None;
    }
    root.children()
        .find(|child| child.is_element() && child.tag_name().name() == "Code")
        .and_then(|child| child.text())
        .map(str::to_string)
}

/// 失败判定（2xx 之外均视为失败）
fn is_failure(response: &reqwest::blocking::Response) -> bool {
    !(200..=299).contains(&response.status().as_u16())
}

/// 失败响应 → 统一错误串；携带响应体里的 S3 错误码（区分签名不匹配/无权限/键不存在/时钟偏差）。
/// 消耗响应以读取错误体，调用方须先经 is_failure 判定
fn failure_detail(response: reqwest::blocking::Response, not_found: &str) -> String {
    let status = response.status().as_u16();
    let body = response.text().unwrap_or_default();
    let code_part = parse_error_body(&body).map(|code| format!(" {code}")).unwrap_or_default();
    match status {
        403 => format!("object storage rejected credentials (403{code_part})"),
        404 => format!("{not_found}{code_part}"),
        other => format!("unexpected object storage response: {other}{code_part}"),
    }
}

/// PUT 对象（全量覆盖；每设备一对象语义）
pub(crate) fn s3_put(config: &S3SyncConfig, key: &str, body: Vec<u8>) -> Result<(), String> {
    let response = execute(config, "PUT", key, &[], body)?;
    if is_failure(&response) {
        return Err(failure_detail(response, "bucket not found (404)"));
    }
    Ok(())
}

/// GET 对象
pub(crate) fn s3_get(config: &S3SyncConfig, key: &str) -> Result<Vec<u8>, String> {
    let response = execute(config, "GET", key, &[], Vec::new())?;
    if is_failure(&response) {
        return Err(failure_detail(response, &format!("object not found: {key}")));
    }
    let bytes = response.bytes().map_err(|e| format!("failed to read object storage response: {e}"))?;
    Ok(bytes.to_vec())
}

/// LIST prefix 下对象（解析 ListBucketResult XML；条目数为设备数级别，不翻页）
pub(crate) fn s3_list(config: &S3SyncConfig, prefix: &str) -> Result<Vec<RemoteSnapshot>, String> {
    let query = [
        ("list-type".to_string(), "2".to_string()),
        ("prefix".to_string(), prefix.to_string()),
        ("max-keys".to_string(), "1000".to_string()),
    ];
    let response = execute(config, "GET", "", &query, Vec::new())?;
    if is_failure(&response) {
        return Err(failure_detail(response, "bucket not found (404)"));
    }
    let xml = response.text().map_err(|e| format!("failed to read object storage response: {e}"))?;
    parse_list_xml(&xml)
}

/// 解析 ListBucketResult XML → 设备快照条目（key 去前缀 backups/ 与后缀 .json 得 deviceId；
/// 不符合命名约定的条目原样保留 key、deviceId 取整键，避免丢数据）
pub(crate) fn parse_list_xml(xml: &str) -> Result<Vec<RemoteSnapshot>, String> {
    let doc = roxmltree::Document::parse(xml)
        .map_err(|e| format!("failed to parse object storage response: {e}"))?;
    let root = doc.root_element();
    let mut out = Vec::new();
    for node in root.children().filter(|child| child.is_element() && child.tag_name().name() == "Contents") {
        let text = |name: &str| {
            node.children()
                .find(|child| child.is_element() && child.tag_name().name() == name)
                .and_then(|child| child.text())
        };
        let Some(key) = text("Key") else { continue };
        let device_id = key
            .strip_prefix(KEY_PREFIX)
            .and_then(|stripped| stripped.strip_suffix(".json"))
            .unwrap_or(key)
            .to_string();
        out.push(RemoteSnapshot {
            key: key.to_string(),
            device_id,
            last_modified: text("LastModified").unwrap_or_default().to_string(),
            size: text("Size").and_then(|value| value.parse().ok()).unwrap_or(0),
        });
    }
    Ok(out)
}

// ---- 编排 ----

/// 取/建本机 deviceId（config.db meta 持久；首次生成 uuid v4；导入备份不覆盖）
pub(crate) fn device_id_or_create(config: &ConfigState) -> Result<String, String> {
    let conn = config.lock_conn();
    if let Some(existing) = meta_get(&conn, "deviceId").map_err(|e| e.to_string())? {
        return Ok(existing);
    }
    let id = uuid::Uuid::new_v4().to_string();
    meta_set(&conn, "deviceId", &id).map_err(|e| e.to_string())?;
    Ok(id)
}

/// 记录同步时间戳（push/pull 成功后调用）
fn stamp_meta(config: &ConfigState, key: &str) -> Result<(), String> {
    let conn = config.lock_conn();
    let now = Utc::now().timestamp_millis().to_string();
    meta_set(&conn, key, &now).map_err(|e| e.to_string())?;
    Ok(())
}

/// push：build_snapshot → PUT backups/{deviceId}.json → meta 记 lastPushAt
pub(crate) fn push_internal(
    config: &ConfigState,
    secrets: &SecretsState,
    passphrase: &str,
    app_version: &str,
) -> Result<PushResult, String> {
    let sync = s3_sync_load(secrets)?.ok_or(NOT_CONFIGURED.to_string())?;
    let (snapshot, _summary) = build_snapshot(config, secrets, passphrase, app_version)?;
    let body = serde_json::to_vec(&snapshot).map_err(|e| format!("failed to serialize backup: {e}"))?;
    let size = body.len() as u64;
    let key = format!("{KEY_PREFIX}{}.json", device_id_or_create(config)?);
    s3_put(&sync, &key, body)?;
    stamp_meta(config, "lastPushAt")?;
    Ok(PushResult { key, size })
}

/// pull：GET 指定对象 → parse_and_apply（校验失败本机零改动）→ meta 记 lastPullAt
pub(crate) fn pull_internal(
    config: &ConfigState,
    secrets: &SecretsState,
    key: &str,
    passphrase: &str,
) -> Result<(), String> {
    let sync = s3_sync_load(secrets)?.ok_or(NOT_CONFIGURED.to_string())?;
    let bytes = s3_get(&sync, key)?;
    let raw = String::from_utf8(bytes).map_err(|_| "invalid backup file: not UTF-8".to_string())?;
    parse_and_apply(config, secrets, &raw, passphrase)?;
    stamp_meta(config, "lastPullAt")
}

/// 测试连接：LIST prefix（403=凭据无效 / 404=桶不存在 / 连接失败=端点不可达）
///
/// `options` 提供时用表单值测试（secretKey 留空 = 沿用已存密钥），否则用已保存配置
pub(crate) fn test_connection(secrets: &SecretsState, options: Option<&S3SyncConfig>) -> Result<(), String> {
    let config = match options {
        Some(options) => {
            let mut options = options.clone();
            if options.secret_key.is_empty() {
                options.secret_key =
                    s3_sync_load(secrets)?.ok_or(NOT_CONFIGURED.to_string())?.secret_key;
            }
            options
        }
        None => s3_sync_load(secrets)?.ok_or(NOT_CONFIGURED.to_string())?,
    };
    s3_list(&config, KEY_PREFIX)?;
    Ok(())
}

// ---- Tauri 命令（薄包装）----

/// 读取云端同步配置（secretKey 不回传）
///
/// # Examples
///
/// `invoke('s3_sync_get')`
#[tauri::command]
pub fn s3_sync_get(state: State<'_, SecretsState>) -> Result<Option<S3SyncConfigView>, String> {
    Ok(s3_sync_load(&state)?.map(|config| S3SyncConfigView {
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        path_style: config.path_style,
        access_key: config.access_key,
        has_secret_key: !config.secret_key.is_empty(),
    }))
}

/// 保存/覆盖云端同步配置
///
/// # Examples
///
/// `invoke('s3_sync_set', { options })`
#[tauri::command]
pub fn s3_sync_set(state: State<'_, SecretsState>, options: S3SyncConfig) -> Result<(), String> {
    s3_sync_store(&state, &options)
}

/// 清除云端同步配置
///
/// # Examples
///
/// `invoke('s3_sync_clear')`
#[tauri::command]
pub fn s3_sync_clear(state: State<'_, SecretsState>) -> Result<(), String> {
    s3_sync_forget(&state)
}

/// 测试连接（见 test_connection）；options 传当前表单值（secretKey 留空沿用已存）
///
/// # Examples
///
/// `invoke('s3_sync_test', { options })`
#[tauri::command]
pub fn s3_sync_test(state: State<'_, SecretsState>, options: Option<S3SyncConfig>) -> Result<(), String> {
    test_connection(&state, options.as_ref())
}

/// 上传本机快照到云端
///
/// # Examples
///
/// `invoke('s3_sync_push', { passphrase })`
#[tauri::command]
pub fn s3_sync_push(
    app: tauri::AppHandle,
    config: State<'_, ConfigState>,
    secrets: State<'_, SecretsState>,
    passphrase: String,
) -> Result<PushResult, String> {
    push_internal(&config, &secrets, &passphrase, &app.package_info().version.to_string())
}

/// 云端同步状态（设置页展示：本机设备标识 + 最后上传/恢复时间）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub device_id: String,
    pub last_push_at: Option<i64>,
    pub last_pull_at: Option<i64>,
}

/// 读取同步状态（deviceId 不存在则顺手创建，与 push 行为一致）
///
/// # Arguments
///
/// * `config` - 配置库状态
///
/// # Returns
///
/// 设备标识与最近同步时间戳（毫秒，未同步为 None）
///
/// # Examples
///
/// `invoke('s3_sync_status')`
#[tauri::command]
pub fn s3_sync_status(config: State<'_, ConfigState>) -> Result<SyncStatus, String> {
    let device_id = device_id_or_create(&config)?;
    let conn = config.lock_conn();
    let read_stamp = |key: &str| -> Result<Option<i64>, String> {
        Ok(meta_get(&conn, key).map_err(|e| e.to_string())?.and_then(|value| value.parse().ok()))
    };
    Ok(SyncStatus {
        device_id,
        last_push_at: read_stamp("lastPushAt")?,
        last_pull_at: read_stamp("lastPullAt")?,
    })
}

/// 列出云端全部设备快照
///
/// # Examples
///
/// `invoke('s3_sync_list_remote')`
#[tauri::command]
pub fn s3_sync_list_remote(secrets: State<'_, SecretsState>) -> Result<Vec<RemoteSnapshot>, String> {
    let config = s3_sync_load(&secrets)?.ok_or("s3 sync is not configured")?;
    s3_list(&config, "backups/")
}

/// 从云端拉取指定快照并应用（见 pull_internal）
///
/// # Examples
///
/// `invoke('s3_sync_pull', { key, passphrase })`
#[tauri::command]
pub fn s3_sync_pull(
    config: State<'_, ConfigState>,
    secrets: State<'_, SecretsState>,
    key: String,
    passphrase: String,
) -> Result<(), String> {
    pull_internal(&config, &secrets, &key, &passphrase)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::load_internal;
    use crate::secrets::{replace_all, CredPlain, SecretsPlain};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Arc, Mutex};

    static SEQ: AtomicU32 = AtomicU32::new(0);

    /// 唯一临时目录
    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "scx-s3sync-test-{tag}-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 空载荷 SHA256（众所周知的常量，AWS 文档示例同款）
    const EMPTY_SHA: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    /// 最小假 S3：accept `expected` 个连接，逐个读完整请求并交回调应答；返回 base_url 与请求记录
    fn fake_s3<F>(expected: usize, respond: F) -> (String, std::thread::JoinHandle<Vec<RecordedRequest>>)
    where
        F: Fn(&RecordedRequest) -> (u16, Vec<u8>) + Send + Sync + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let respond = Arc::new(respond);
        let handle = std::thread::spawn(move || {
            let mut recorded = Vec::new();
            for _ in 0..expected {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buffer = Vec::new();
                let mut chunk = [0u8; 4096];
                // 读到头结束
                loop {
                    let n = stream.read(&mut chunk).unwrap();
                    if n == 0 {
                        break;
                    }
                    buffer.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buffer);
                    if let Some(header_end) = text.find("\r\n\r\n") {
                        let content_length = text
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                if name.trim().eq_ignore_ascii_case("content-length") {
                                    value.trim().parse::<usize>().ok()
                                } else {
                                    None
                                }
                            })
                            .unwrap_or(0);
                        if buffer.len() >= header_end + 4 + content_length {
                            break;
                        }
                    }
                }
                let text = String::from_utf8_lossy(&buffer).into_owned();
                let (head, body) = text.split_once("\r\n\r\n").unwrap_or((text.as_str(), ""));
                let mut lines = head.lines();
                let start_line = lines.next().unwrap_or_default().to_string();
                let headers = lines
                    .filter_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        Some((name.trim().to_ascii_lowercase(), value.trim().to_string()))
                    })
                    .collect::<Vec<_>>();
                let request = RecordedRequest {
                    start_line,
                    headers,
                    body: body.as_bytes().to_vec(),
                };
                let (status, payload) = respond(&request);
                let reason = match status {
                    200 => "OK",
                    403 => "Forbidden",
                    404 => "Not Found",
                    _ => "Error",
                };
                let response = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    payload.len()
                )
                .into_bytes();
                let mut response = response;
                response.extend_from_slice(&payload);
                stream.write_all(&response).unwrap();
                stream.flush().unwrap();
                recorded.push(request);
            }
            recorded
        });
        (format!("http://127.0.0.1:{port}"), handle)
    }

    struct RecordedRequest {
        start_line: String,
        headers: Vec<(String, String)>,
        #[allow(dead_code)]
        body: Vec<u8>,
    }

    impl RecordedRequest {
        fn header (&self, name: &str) -> Option<&str> {
            self.headers
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.as_str())
        }
    }

    #[test]
    fn sigv4_matches_aws_documented_example() {
        // AWS 官方文档 iam ListUsers 示例（值已经 node crypto 独立复现核对）：
        // GET /，content-type + host + x-amz-date，空载荷，service=iam
        let headers = vec![
            ("content-type".to_string(), "application/x-www-form-urlencoded; charset=utf-8".to_string()),
            ("host".to_string(), "iam.amazonaws.com".to_string()),
            ("x-amz-date".to_string(), "20150830T123600Z".to_string()),
        ];
        let canonical = canonical_request(
            "GET",
            "/",
            "Action=ListUsers&Version=2010-05-08",
            &headers,
            EMPTY_SHA,
        );
        assert_eq!(
            canonical,
            format!(
                "GET\n/\nAction=ListUsers&Version=2010-05-08\n\
                 content-type:application/x-www-form-urlencoded; charset=utf-8\n\
                 host:iam.amazonaws.com\nx-amz-date:20150830T123600Z\n\n\
                 content-type;host;x-amz-date\n{EMPTY_SHA}"
            )
        );

        let sts = string_to_sign(
            "20150830T123600Z",
            "20150830/us-east-1/iam/aws4_request",
            &canonical,
        );
        assert_eq!(
            sts,
            "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/iam/aws4_request\n\
             f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59"
        );

        let key = signing_key(
            "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            "20150830",
            "us-east-1",
            "iam",
        );
        assert_eq!(
            hex_encode(&key),
            "c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9"
        );

        let auth = authorization_header(
            "AKIDEXAMPLE",
            "20150830/us-east-1/iam/aws4_request",
            "content-type;host;x-amz-date",
            &key,
            &sts,
        );
        assert!(auth.starts_with("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request"));
        assert!(auth.ends_with("Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7"));
    }

    #[test]
    fn canonical_query_sorts_and_encodes() {
        let query = canonical_query(&[
            ("prefix".to_string(), "backups/".to_string()),
            ("list-type".to_string(), "2".to_string()),
            ("max-keys".to_string(), "1".to_string()),
        ]);
        assert_eq!(query, "list-type=2&max-keys=1&prefix=backups%2F");
    }

    #[test]
    fn list_xml_parses_entries_and_empty() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>backups</Name>
  <Prefix>backups/</Prefix>
  <KeyCount>2</KeyCount>
  <Contents>
    <Key>backups/aaaaaaaa-bbbb.json</Key>
    <LastModified>2026-09-23T10:00:00.000Z</LastModified>
    <Size>1234</Size>
  </Contents>
  <Contents>
    <Key>backups/cccccccc-dddd.json</Key>
    <LastModified>2026-09-23T11:00:00.000Z</LastModified>
    <Size>567</Size>
  </Contents>
</ListBucketResult>"#;
        let entries = parse_list_xml(xml).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].device_id, "aaaaaaaa-bbbb");
        assert_eq!(entries[0].key, "backups/aaaaaaaa-bbbb.json");
        assert_eq!(entries[0].size, 1234);
        assert_eq!(entries[1].device_id, "cccccccc-dddd");
        assert_eq!(entries[1].last_modified, "2026-09-23T11:00:00.000Z");

        let empty = r#"<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>backups</Name><Prefix>backups/</Prefix><KeyCount>0</KeyCount>
</ListBucketResult>"#;
        assert!(parse_list_xml(empty).unwrap().is_empty());
    }

    #[test]
    fn device_id_created_once_and_stable() {
        let dir = temp_dir("devid");
        let config = ConfigState::new(&dir);
        let first = device_id_or_create(&config).unwrap();
        let second = device_id_or_create(&config).unwrap();
        assert_eq!(first, second, "deviceId must be created once and reused");
        assert!(uuid::Uuid::parse_str(&first).is_ok(), "deviceId must be a uuid");
    }

    #[test]
    fn push_then_pull_round_trip_via_fake_s3() {
        // 源机器 A：1 个 SSH 档案 + 1 条凭据
        let dir_a = temp_dir("sync-a");
        let config_a = ConfigState::new(&dir_a);
        let secrets_a = crate::secrets::test_state(&dir_a);
        config_a.lock_conn()
            .execute_batch(
                "INSERT INTO profiles (id, type, name, is_default, sort_order, data) VALUES
                    ('p-ssh', 'ssh', 'srv1', 0, 0, '{\"id\":\"p-ssh\",\"type\":\"ssh\",\"name\":\"srv1\",\"host\":\"1.2.3.4\"}');
                 INSERT INTO meta (key, value) VALUES ('initialized', '1');",
            )
            .unwrap();
        replace_all(
            &secrets_a,
            &SecretsPlain {
                ssh_keys: vec![],
                ssh_credentials: vec![CredPlain { profile_id: "p-ssh".into(), password: "hunter2".into() }],
            },
        )
        .unwrap();

        // 假 S3：PUT 存下快照，GET 回放
        let store: Arc<Mutex<Option<Vec<u8>>>> = Arc::new(Mutex::new(None));
        let store_for_put = Arc::clone(&store);
        let (base, server) = fake_s3(2, move |request| {
            if request.start_line.starts_with("PUT") {
                *store_for_put.lock().unwrap() = Some(request.body.clone());
                (200, Vec::new())
            } else {
                match store_for_put.lock().unwrap().clone() {
                    Some(body) => (200, body),
                    None => (404, Vec::new()),
                }
            }
        });

        let sync_config = S3SyncConfig {
            endpoint: base,
            region: "us-east-1".into(),
            bucket: "scx-backups".into(),
            path_style: true,
            access_key: "ak".into(),
            secret_key: "sk".into(),
        };
        s3_sync_store(&secrets_a, &sync_config).unwrap();

        // push
        let pushed = push_internal(&config_a, &secrets_a, "pass123", "0.1.6-test").unwrap();
        let device_id = device_id_or_create(&config_a).unwrap();
        assert_eq!(pushed.key, format!("backups/{device_id}.json"));
        assert!(
            crate::config::meta_get(&config_a.lock_conn(), "lastPushAt").unwrap().is_some(),
            "push must stamp lastPushAt"
        );
        let stored = store.lock().unwrap().clone().expect("fake s3 must hold the snapshot");
        assert!(stored.starts_with(b"{"));
        assert!(!String::from_utf8_lossy(&stored).contains("hunter2"), "snapshot must encrypt secrets");

        // 目标机器 B：全新库 + 同一份云端配置
        let dir_b = temp_dir("sync-b");
        let config_b = ConfigState::new(&dir_b);
        let secrets_b = crate::secrets::test_state(&dir_b);
        s3_sync_store(&secrets_b, &sync_config).unwrap();

        pull_internal(&config_b, &secrets_b, &pushed.key, "pass123").unwrap();

        let snapshot = load_internal(&config_b).unwrap().expect("pull must initialize config");
        assert_eq!(snapshot.profiles.len(), 1);
        assert_eq!(snapshot.profiles[0]["host"], "1.2.3.4");
        assert_eq!(
            crate::secrets::load_password(&secrets_b, "p-ssh").unwrap().as_deref(),
            Some("hunter2")
        );

        // 请求面断言：path-style 路径 + SigV4 头
        let recorded = server.join().unwrap();
        assert!(
            recorded[0].start_line.starts_with(&format!("PUT /scx-backups/backups/{device_id}.json")),
            "unexpected start line: {}", recorded[0].start_line
        );
        let auth = recorded[0].header("authorization").expect("authorization header must exist");
        assert!(auth.starts_with("AWS4-HMAC-SHA256 Credential=ak/"), "unexpected auth: {auth}");
        assert!(recorded[0].header("x-amz-date").is_some());
        assert!(recorded[0].header("x-amz-content-sha256").is_some());
    }

    #[test]
    fn s3_get_maps_404_and_403_errors() {        let config_404 = S3SyncConfig {
            endpoint: fake_s3(1, |_| (404, Vec::new())).0,
            region: "us-east-1".into(),
            bucket: "b".into(),
            path_style: true,
            access_key: "ak".into(),
            secret_key: "sk".into(),
        };
        let err = s3_get(&config_404, "backups/none.json").unwrap_err();
        assert!(err.contains("object not found"), "unexpected error: {err}");

        let config_403 = S3SyncConfig {
            endpoint: fake_s3(1, |_| (403, Vec::new())).0,
            region: "us-east-1".into(),
            bucket: "b".into(),
            path_style: true,
            access_key: "ak".into(),
            secret_key: "sk".into(),
        };
        let err = s3_get(&config_403, "backups/none.json").unwrap_err();
        assert!(err.contains("credentials"), "unexpected error: {err}");
    }

    #[test]
    fn s3_error_surfaces_minio_error_code() {
        // MinIO/S3 的 403 响应体携带 <Error><Code>…</Code></Error>，错误串必须带上该码，
        // 前端才能区分 SignatureDoesNotMatch / AccessDenied / InvalidAccessKeyId / RequestTimeTooSkewed
        let make_config = |body: &'static [u8]| S3SyncConfig {
            endpoint: fake_s3(1, move |_| (403, body.to_vec())).0,
            region: "us-east-1".into(),
            bucket: "b".into(),
            path_style: true,
            access_key: "ak".into(),
            secret_key: "sk".into(),
        };
        let signature_xml: &[u8] = br#"<?xml version="1.0"?><Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match the signature you provided.</Message></Error>"#;
        let err = s3_get(&make_config(signature_xml), "backups/none.json").unwrap_err();
        assert!(err.contains("SignatureDoesNotMatch"), "unexpected error: {err}");

        let denied_xml: &[u8] = br#"<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Access Denied.</Message></Error>"#;
        let err = s3_get(&make_config(denied_xml), "backups/none.json").unwrap_err();
        assert!(err.contains("AccessDenied"), "unexpected error: {err}");

        // 非错误码结构的正文不影响既有消息
        let err = s3_get(&make_config(b"plain text"), "backups/none.json").unwrap_err();
        assert!(err.contains("credentials"), "unexpected error: {err}");
    }

    /// 真实 MinIO 实测探针（排障资产）：验证手签 SigV4 能被真实服务接受。
    /// 运行方式：
    /// ```sh
    /// MINIO_ROOT_USER=probeadmin MINIO_ROOT_PASSWORD=probepassword123 \
    ///   minio server /tmp/scx-minio-probe/data --address 127.0.0.1:19000 &
    /// mc alias set probe http://127.0.0.1:19000 ... && mc mb probe/scx-backups
    /// S3_PROBE_ENDPOINT=http://127.0.0.1:19000 S3_PROBE_BUCKET=scx-backups \
    /// S3_PROBE_AK=probeadmin S3_PROBE_SK=probepassword123 \
    ///   cargo test --manifest-path src-tauri/Cargo.toml live_minio_probe -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "live probe: needs a local MinIO (see doc comment)"]
    fn live_minio_probe() {
        let read = |key: &str| std::env::var(key).unwrap_or_else(|_| panic!("{key} not set"));
        let config = S3SyncConfig {
            endpoint: read("S3_PROBE_ENDPOINT"),
            region: "us-east-1".into(),
            bucket: read("S3_PROBE_BUCKET"),
            path_style: true,
            access_key: read("S3_PROBE_AK"),
            secret_key: read("S3_PROBE_SK"),
        };
        // 正确凭据：LIST/PUT/GET 全链路必须通过（SigV4 被真实服务接受的证据）
        s3_list(&config, "backups/").expect("list must succeed with valid credentials");
        s3_put(&config, "backups/probe.json", br#"{"probe":true}"#.to_vec())
            .expect("put must succeed with valid credentials");
        assert_eq!(s3_get(&config, "backups/probe.json").unwrap(), br#"{"probe":true}"#.to_vec());
        // 错误密钥：应得到携带 SignatureDoesNotMatch 错误码的 403
        let bad = S3SyncConfig { secret_key: "definitely-wrong".into(), ..config.clone() };
        let err = s3_list(&bad, "backups/").unwrap_err();
        println!("wrong-secret error: {err}");
        assert!(err.contains("SignatureDoesNotMatch"), "unexpected error: {err}");
    }
}
