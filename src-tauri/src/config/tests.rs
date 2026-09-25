//! @description config 模块单测：按原 config.rs 的测试原样迁移（幂等、级联降级、
//! 排序稳定性、initialized 语义、legacy 归档等不变量）。

use super::groups::*;
use super::legacy::archive_legacy_yaml_at;
use super::load::load_internal;
use super::model::*;
use super::profiles::*;
use super::quick_commands::*;
use super::settings::*;
use super::state::{mark_initialized, ConfigState};

fn temp_state(tag: &str) -> ConfigState {
    let dir = std::env::temp_dir().join(format!("scx-config-test-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    ConfigState::new(&dir)
}

fn profile_json(id: &str, name: &str, profile_type: &str, is_default: bool) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "type": profile_type,
        "name": name,
        "isDefault": is_default,
    })
}

fn command_json(id: &str, name: &str, group_id: Option<&str>) -> QuickCommandRecord {
    QuickCommandRecord {
        id: id.into(),
        name: name.into(),
        command: format!("echo {name}"),
        group_id: group_id.map(str::to_string),
        auto_run: false,
    }
}

#[test]
fn load_returns_none_until_first_write() {
    let state = temp_state("fresh");
    assert!(load_internal(&state).unwrap().is_none());
    hotkey_set_internal(&state, "copy", &serde_json::json!([["⌘-C"]])).unwrap();
    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.hotkeys["copy"], serde_json::json!([["⌘-C"]]));
}

#[test]
fn schema_is_versioned() {
    let state = temp_state("version");
    let conn = state.lock_conn();
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap();
    assert_eq!(version, 4);
}

#[test]
fn tab_groups_roundtrip_through_snapshot() {
    let state = temp_state("tabgroups-read");
    {
        let conn = state.lock_conn();
        conn.execute(
            "INSERT INTO tab_groups (id, name, color, sort_order, persist_tabs, collapsed) VALUES ('tg1', 'work', '#61afef', 0, 1, 0)",
            [],
        )
        .unwrap();
        // load_internal 对未写过配置的库返回 None，需先打初始化标记（等价真实写入路径）
        mark_initialized(&conn).unwrap();
    }
    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.tab_groups.len(), 1);
    assert_eq!(snapshot.tab_groups[0].name, "work");
    assert_eq!(snapshot.tab_groups[0].color.as_deref(), Some("#61afef"));
    assert!(snapshot.tab_groups[0].persist_tabs);
    assert!(!snapshot.tab_groups[0].collapsed);
}

#[test]
fn tab_group_crud_roundtrip() {
    let state = temp_state("tabgroups-crud");
    tab_group_create_internal(&state, &TabGroupRecord {
        id: "tg1".into(), name: "work".into(), color: Some("#61afef".into()),
        sort_order: 0, persist_tabs: true, collapsed: false,
    })
    .unwrap();
    tab_group_update_internal(&state, &TabGroupRecord {
        id: "tg1".into(), name: "ops".into(), color: None,
        sort_order: 0, persist_tabs: false, collapsed: true,
    })
    .unwrap();
    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.tab_groups.len(), 1);
    assert_eq!(snapshot.tab_groups[0].name, "ops");
    assert!(snapshot.tab_groups[0].color.is_none());
    assert!(!snapshot.tab_groups[0].persist_tabs);
    assert!(snapshot.tab_groups[0].collapsed);
    assert!(tab_group_update_internal(&state, &TabGroupRecord {
        id: "missing".into(), name: "x".into(), color: None, sort_order: 0, persist_tabs: false, collapsed: false,
    })
    .is_err());
    tab_group_delete_internal(&state, "tg1").unwrap();
    tab_group_delete_internal(&state, "tg1").unwrap(); // 幂等
    let snapshot = load_internal(&state).unwrap().unwrap();
    assert!(snapshot.tab_groups.is_empty());
}

#[test]
fn tab_session_roundtrip_without_initialized() {
    let state = temp_state("tabsession");
    assert!(tab_session_get_internal(&state).unwrap().is_none());
    tab_session_set_internal(&state, &serde_json::json!({ "version": 1, "entries": [] })).unwrap();
    let value = tab_session_get_internal(&state).unwrap().unwrap();
    assert_eq!(value["version"], 1);
    // 关键不变量：写快照不得置 initialized 位，否则全新库会跳过 legacy config.yaml 迁移
    assert!(load_internal(&state).unwrap().is_none());
}

#[test]
fn settings_section_upsert_and_key_validation() {
    let state = temp_state("settings");
    assert!(settings_set_section_internal(&state, "hotkeys", &serde_json::json!({})).is_err());
    settings_set_section_internal(&state, "terminal", &serde_json::json!({"fontSize": 15})).unwrap();
    settings_set_section_internal(&state, "terminal", &serde_json::json!({"fontSize": 16})).unwrap();
    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.terminal.unwrap()["fontSize"], 16);
    assert!(snapshot.appearance.is_none());
}

#[test]
fn advanced_section_round_trips() {
    let state = temp_state("advanced");
    settings_set_section_internal(&state, "advanced", &serde_json::json!({"debugEnabled": true})).unwrap();
    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.advanced.unwrap()["debugEnabled"], true);
}

#[test]
fn recents_section_round_trips() {
    let state = temp_state("recents");
    settings_set_section_internal(&state, "recents", &serde_json::json!({"ssh-1": 1700000000000_u64})).unwrap();
    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.recents.unwrap()["ssh-1"], 1700000000000_u64);
}

#[test]
fn profile_crud_round_trip_and_order_stability() {
    let state = temp_state("profiles");
    profile_create_internal(&state, &profile_json("p1", "zsh", "local", true)).unwrap();
    profile_create_internal(&state, &profile_json("p2", "build", "ssh", false)).unwrap();
    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.profiles.len(), 2);
    assert_eq!(snapshot.profiles[0]["id"], "p1");
    assert_eq!(snapshot.profiles[0]["isDefault"], true);
    assert_eq!(snapshot.profiles[1]["type"], "ssh");

    // 更新不改排序，列与 data 同步重提取
    profile_update_internal(&state, &profile_json("p1", "bash", "local", false)).unwrap();
    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.profiles[0]["name"], "bash");
    assert_eq!(snapshot.profiles[0]["isDefault"], false);
    assert_eq!(snapshot.profiles[0].as_object().unwrap().len(), 4); // data 只含传入字段

    // 删除幂等；缺 id 的档案被拒绝
    profile_delete_internal(&state, "p1").unwrap();
    profile_delete_internal(&state, "p1").unwrap();
    assert!(profile_create_internal(&state, &serde_json::json!({"name": "x"})).is_err());
    assert_eq!(load_internal(&state).unwrap().unwrap().profiles.len(), 1);
}

#[test]
fn profile_update_missing_id_fails() {
    let state = temp_state("profile-miss");
    assert!(profile_update_internal(&state, &profile_json("ghost", "x", "local", false)).is_err());
}

#[test]
fn quick_command_crud_round_trip() {
    let state = temp_state("qc");
    quick_command_create_internal(&state, &command_json("c1", "list", None)).unwrap();
    quick_command_create_internal(&state, &command_json("c2", "deploy", Some("g1"))).unwrap();

    // 更新换组 + 开 autoRun，排序不变
    let mut updated = command_json("c2", "deploy", Some("g2"));
    updated.auto_run = true;
    quick_command_update_internal(&state, &updated).unwrap();

    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.quick_commands.len(), 2);
    assert_eq!(snapshot.quick_commands[0].id, "c1");
    assert!(snapshot.quick_commands[0].group_id.is_none());
    assert_eq!(snapshot.quick_commands[1].group_id.as_deref(), Some("g2"));
    assert!(snapshot.quick_commands[1].auto_run);

    quick_command_delete_internal(&state, "c1").unwrap();
    quick_command_delete_internal(&state, "c1").unwrap();
    assert!(quick_command_update_internal(&state, &command_json("c1", "x", None)).is_err());
    assert_eq!(load_internal(&state).unwrap().unwrap().quick_commands.len(), 1);
}

#[test]
fn group_delete_cascades_ungroup() {
    let state = temp_state("qc-group");
    quick_command_group_create_internal(&state, &QuickCommandGroupRecord { id: "g1".into(), name: "ops".into() }).unwrap();
    quick_command_create_internal(&state, &command_json("c1", "list", Some("g1"))).unwrap();
    quick_command_create_internal(&state, &command_json("c2", "free", None)).unwrap();

    quick_command_group_delete_internal(&state, "g1").unwrap();

    let snapshot = load_internal(&state).unwrap().unwrap();
    assert!(snapshot.quick_command_groups.is_empty());
    assert!(snapshot.quick_commands.iter().all(|c| c.group_id.is_none()));
}

#[test]
fn group_crud_round_trip() {
    let state = temp_state("qc-group-crud");
    quick_command_group_create_internal(
        &state,
        &QuickCommandGroupRecord { id: "g1".into(), name: "ops".into() },
    )
    .unwrap();
    quick_command_group_update_internal(
        &state,
        &QuickCommandGroupRecord { id: "g1".into(), name: "运维".into() },
    )
    .unwrap();
    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.quick_command_groups[0].name, "运维");
    assert!(quick_command_group_update_internal(
        &state,
        &QuickCommandGroupRecord { id: "ghost".into(), name: "x".into() }
    )
    .is_err());
    quick_command_group_delete_internal(&state, "g1").unwrap();
    assert!(load_internal(&state).unwrap().unwrap().quick_command_groups.is_empty());
}

#[test]
fn ssh_group_crud_round_trip() {
    let state = temp_state("ssh-group");
    ssh_group_create_internal(&state, &SshGroupRecord { id: "sg1".into(), name: "生产".into() }).unwrap();
    ssh_group_create_internal(&state, &SshGroupRecord { id: "sg2".into(), name: "测试".into() }).unwrap();
    ssh_group_update_internal(&state, &SshGroupRecord { id: "sg1".into(), name: "prod".into() }).unwrap();

    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.ssh_groups.len(), 2);
    assert_eq!(snapshot.ssh_groups[0].name, "prod");
    assert_eq!(snapshot.ssh_groups[1].name, "测试");
    assert!(ssh_group_update_internal(&state, &SshGroupRecord { id: "ghost".into(), name: "x".into() }).is_err());

    ssh_group_delete_internal(&state, "sg1").unwrap();
    ssh_group_delete_internal(&state, "sg1").unwrap(); // 幂等
    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.ssh_groups.len(), 1);
    assert_eq!(snapshot.ssh_groups[0].id, "sg2");
}

#[test]
fn ssh_group_delete_cascades_ungroup() {
    let state = temp_state("ssh-group-cascade");
    ssh_group_create_internal(&state, &SshGroupRecord { id: "sg1".into(), name: "prod".into() }).unwrap();
    profile_create_internal(&state, &serde_json::json!({
        "id": "s1", "type": "ssh", "name": "web", "host": "h", "port": 22,
        "user": "root", "auth": "auto", "keyId": null, "colorScheme": null,
        "isDefault": false, "groupId": "sg1",
    }))
    .unwrap();
    profile_create_internal(&state, &serde_json::json!({
        "id": "s2", "type": "ssh", "name": "db", "host": "h2", "port": 22,
        "user": "root", "auth": "auto", "keyId": null, "colorScheme": null,
        "isDefault": false,
    }))
    .unwrap();
    profile_create_internal(&state, &profile_json("l1", "zsh", "local", false)).unwrap();

    ssh_group_delete_internal(&state, "sg1").unwrap();

    let snapshot = load_internal(&state).unwrap().unwrap();
    assert!(snapshot.ssh_groups.is_empty());
    for profile in &snapshot.profiles {
        assert!(profile.get("groupId").is_none(), "groupId must be dropped: {profile}");
    }
    // 其余字段原样保留（仅移除 groupId 键）
    assert_eq!(snapshot.profiles[0]["name"], "web");
    assert_eq!(snapshot.profiles[0]["host"], "h");
}

#[test]
fn local_group_crud_round_trip() {
    let state = temp_state("local-group");
    local_group_create_internal(
        &state,
        &LocalGroupRecord { id: "lg1".into(), name: "zsh".into(), is_default: true },
    )
    .unwrap();
    local_group_create_internal(
        &state,
        &LocalGroupRecord { id: "lg2".into(), name: "工作".into(), is_default: false },
    )
    .unwrap();
    local_group_update_internal(
        &state,
        &LocalGroupRecord { id: "lg1".into(), name: "Zsh".into(), is_default: true },
    )
    .unwrap();

    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.local_groups.len(), 2);
    assert_eq!(snapshot.local_groups[0].name, "Zsh");
    assert!(snapshot.local_groups[0].is_default);
    assert!(!snapshot.local_groups[1].is_default);
    assert!(local_group_update_internal(
        &state,
        &LocalGroupRecord { id: "ghost".into(), name: "x".into(), is_default: false },
    )
    .is_err());

    local_group_delete_internal(&state, "lg1").unwrap();
    local_group_delete_internal(&state, "lg1").unwrap(); // 幂等
    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.local_groups.len(), 1);
    assert_eq!(snapshot.local_groups[0].id, "lg2");
}

#[test]
fn local_group_delete_cascades_ungroup() {
    let state = temp_state("local-group-cascade");
    local_group_create_internal(
        &state,
        &LocalGroupRecord { id: "lg1".into(), name: "zsh".into(), is_default: true },
    )
    .unwrap();
    profile_create_internal(&state, &serde_json::json!({
        "id": "l1", "type": "local", "name": "zsh", "command": "/bin/zsh",
        "isDefault": false, "builtin": true, "groupId": "lg1",
    }))
    .unwrap();
    profile_create_internal(&state, &serde_json::json!({
        "id": "s1", "type": "ssh", "name": "web", "isDefault": false, "groupId": "lg1",
    }))
    .unwrap();

    local_group_delete_internal(&state, "lg1").unwrap();

    let snapshot = load_internal(&state).unwrap().unwrap();
    assert!(snapshot.local_groups.is_empty());
    // local 档案被降级（groupId 键移除），builtin 等其余字段原样保留
    let local = snapshot.profiles.iter().find(|p| p["id"] == "l1").unwrap();
    assert!(local.get("groupId").is_none(), "groupId must be dropped: {local}");
    assert_eq!(local["builtin"], true);
    // ssh 档案的 groupId 不受 local 分组删除影响（分组空间互不相干）
    let ssh = snapshot.profiles.iter().find(|p| p["id"] == "s1").unwrap();
    assert_eq!(ssh["groupId"], "lg1");
}

#[test]
fn color_scheme_upsert_overwrites_same_name() {
    let state = temp_state("schemes");
    color_scheme_save_internal(&state, "solarized", &serde_json::json!({"background": "#000"})).unwrap();
    color_scheme_save_internal(&state, "solarized", &serde_json::json!({"background": "#fff"})).unwrap();
    color_scheme_save_internal(&state, "gruvbox", &serde_json::json!({"background": "#222"})).unwrap();
    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.color_schemes.len(), 2);
    assert_eq!(snapshot.color_schemes[0]["background"], "#fff");
    assert!(color_scheme_save_internal(&state, "", &serde_json::json!({})).is_err());
    color_scheme_delete_internal(&state, "gruvbox").unwrap();
    color_scheme_delete_internal(&state, "gruvbox").unwrap();
    assert_eq!(load_internal(&state).unwrap().unwrap().color_schemes.len(), 1);
}

#[test]
fn hotkey_set_upsert() {
    let state = temp_state("hotkeys");
    hotkey_set_internal(&state, "copy", &serde_json::json!([["⌘-C"]])).unwrap();
    hotkey_set_internal(&state, "copy", &serde_json::json!([["⌘-⇧-C"]])).unwrap();
    hotkey_set_internal(&state, "copy", &serde_json::json!([])).unwrap();
    assert!(hotkey_set_internal(&state, "", &serde_json::json!([])).is_err());
    let snapshot = load_internal(&state).unwrap().unwrap();
    assert_eq!(snapshot.hotkeys.len(), 1);
    assert_eq!(snapshot.hotkeys["copy"], serde_json::json!([]));
}

#[test]
fn legacy_archive_renames_once() {
    let dir = std::env::temp_dir().join(format!("scx-config-legacy-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let yaml = dir.join("config.yaml");
    std::fs::write(&yaml, "terminal: {}").unwrap();

    assert!(archive_legacy_yaml_at(&yaml).unwrap());
    assert!(!yaml.exists());
    assert!(dir.join("config.yaml.migrated").exists());
    // 二次归档（已迁移过的库）返回 false 不报错
    assert!(!archive_legacy_yaml_at(&yaml).unwrap());
    let _ = std::fs::remove_dir_all(&dir);
}
