//! @description S3 请求执行层（reqwest blocking）：目标组装（path-style / virtual-host）、
//! 签名请求发送、错误响应分诊与 PUT/GET/LIST 对象操作。

use std::time::Duration;

use chrono::Utc;

use crate::secrets::S3SyncConfig;

use super::signing::{
    authorization_header, canonical_query, canonical_request, sha256_hex, signing_key, string_to_sign,
    uri_encode,
};
use super::{RemoteSnapshot, KEY_PREFIX};

/// SigV4 service 标识（S3 兼容服务固定 s3）
const SERVICE: &str = "s3";
/// 请求超时（连接 + 总时长，LAN/公网 MinIO 均够用）
const TIMEOUT_SECS: u64 = 10;

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
