//! forward 单测（从原 forward.rs 外移）：参数校验、状态序列化、-R 路由表形状。

use super::loops::validate_options;
use super::{ForwardKind, ForwardOptions, ForwardRegistry, ForwardState};
use tokio::sync::mpsc;

fn sample_options(kind: ForwardKind) -> ForwardOptions {
    ForwardOptions {
        ssh_id: "ssh-test".into(),
        kind,
        listen_host: "127.0.0.1".into(),
        listen_port: 18080,
        target_host: Some("db.internal".into()),
        target_port: Some(5432),
        rule_id: None,
    }
}

#[test]
fn options_validation_requires_target_for_local_and_remote() {
    let mut options = sample_options(ForwardKind::Local);
    assert!(validate_options(&options).is_ok());

    options.target_host = Some("  ".into());
    assert!(validate_options(&options).is_err());

    options.target_host = None;
    options.target_port = None;
    assert!(validate_options(&options).is_err());

    let mut remote = sample_options(ForwardKind::Remote);
    remote.target_port = Some(0);
    assert!(validate_options(&remote).is_err());
}

#[test]
fn options_validation_rejects_target_for_dynamic_and_empty_host() {
    let mut options = sample_options(ForwardKind::Dynamic);
    options.target_host = None;
    options.target_port = None;
    assert!(validate_options(&options).is_ok());

    options.target_host = Some("x".into());
    assert!(validate_options(&options).is_err());

    let mut local = sample_options(ForwardKind::Local);
    local.listen_host = " ".into();
    assert!(validate_options(&local).is_err());
}

#[test]
fn state_serializes_camel_case() {
    let state = ForwardState {
        id: "fwd-1".into(),
        ssh_id: "ssh-1".into(),
        kind: ForwardKind::Dynamic,
        rule_id: Some("rule-1".into()),
        listen_host: "127.0.0.1".into(),
        listen_port: 1080,
        target_host: None,
        target_port: None,
        status: "active".into(),
        error: None,
    };
    let json = serde_json::to_string(&state).unwrap();
    assert!(json.contains("\"sshId\":\"ssh-1\""));
    assert!(json.contains("\"ruleId\":\"rule-1\""));
    assert!(json.contains("\"kind\":\"dynamic\""));
    assert!(json.contains("\"listenPort\":1080"));
}

#[test]
fn registry_register_and_unregister_by_port() {
    let registry = ForwardRegistry::default();
    let (sender, _receiver) = mpsc::channel(4);
    registry.register("ssh-1", 8080, sender);

    // dispatch 无法在单测构造 RemoteChannel（需真实 channel），
    // 这里锁定路由表形状：按 (ssh_id, port) 命中/未命中
    let routes = registry.routes.lock().unwrap();
    assert!(routes.get("ssh-1").unwrap().contains_key(&8080));
    assert!(!routes.get("ssh-1").unwrap().contains_key(&9999));
    assert!(routes.get("ssh-2").is_none());
    drop(routes);

    registry.unregister("ssh-1", 8080);
    assert!(registry.routes.lock().unwrap().get("ssh-1").is_none());
}

#[test]
fn registry_unregister_cleans_empty_ssh_bucket() {
    let registry = ForwardRegistry::default();
    let (sender_a, _receiver_a) = mpsc::channel(1);
    let (sender_b, _receiver_b) = mpsc::channel(1);
    registry.register("ssh-1", 100, sender_a);
    registry.register("ssh-1", 200, sender_b);
    registry.unregister("ssh-1", 100);
    {
        let routes = registry.routes.lock().unwrap();
        assert!(routes.get("ssh-1").unwrap().contains_key(&200));
    }
    registry.unregister("ssh-1", 200);
    assert!(registry.routes.lock().unwrap().get("ssh-1").is_none());
}
