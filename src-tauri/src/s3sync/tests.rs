//! @description s3sync 单测：SigV4 与 AWS 官方示例对齐、查询串编码、LIST XML 解析、
//! deviceId 稳定性、假 S3 全链路 push/pull 往返与错误分诊、真实 MinIO 探针（忽略态）。

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use crate::config::load::load_internal;
use crate::config::{meta_get, ConfigState};
use crate::secrets::{replace_all, s3_sync_store, test_state, CredPlain, SecretsPlain, S3SyncConfig};
use crate::s3sync::client::{parse_list_xml, s3_get, s3_list, s3_put};
use crate::s3sync::signing::{
    authorization_header, canonical_query, canonical_request, hex_encode, signing_key, string_to_sign,
};
use crate::s3sync::{device_id_or_create, pull_internal, push_internal};

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
    let secrets_a = test_state(&dir_a);
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
        meta_get(&config_a.lock_conn(), "lastPushAt").unwrap().is_some(),
        "push must stamp lastPushAt"
    );
    let stored = store.lock().unwrap().clone().expect("fake s3 must hold the snapshot");
    assert!(stored.starts_with(b"{"));
    assert!(!String::from_utf8_lossy(&stored).contains("hunter2"), "snapshot must encrypt secrets");

    // 目标机器 B：全新库 + 同一份云端配置
    let dir_b = temp_dir("sync-b");
    let config_b = ConfigState::new(&dir_b);
    let secrets_b = test_state(&dir_b);
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
fn s3_get_maps_404_and_403_errors() {
    let config_404 = S3SyncConfig {
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
