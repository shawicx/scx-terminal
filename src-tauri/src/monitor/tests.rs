//! monitor 解析单测（从 parse.rs 外移，保持 `use super::*` 语义改为显式导入）。

use super::parse::{build_command, parse_sample, ParseOutcome};


const STAT_LINE: &str = "cpu  100 0 50 800 20 0 0 30 0 0";
const STAT_LINE2: &str = "cpu  200 0 100 1600 40 0 0 60 0 0";

fn mem_section() -> String {
    concat!(
        "MemTotal:       1000 kB\n",
        "MemFree:         100 kB\n",
        "MemAvailable:    400 kB\n",
        "Buffers:          50 kB\n",
        "Cached:          250 kB\n",
        "SwapTotal:      2000 kB\n",
        "SwapFree:        500 kB\n",
    )
    .to_string()
}

fn net_section() -> String {
    concat!(
        "Inter-|   Receive                                                |  Transmit\n",
        " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets\n",
        "  eth0: 1024000    100    0    0    0     0          0         0  2048000    200\n",
        "    lo: 999        999    0    0    0     0          0         0  999        999\n",
    )
    .to_string()
}

// 第二轮：eth0 计数翻倍（rx +1024000 / tx +2048000），对应测试注释中的差值期望
fn net_section2() -> String {
    concat!(
        "Inter-|   Receive                                                |  Transmit\n",
        " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets\n",
        "  eth0: 2048000    200    0    0    0     0          0         0  4096000    400\n",
        "    lo: 999        999    0    0    0     0          0         0  999        999\n",
    )
    .to_string()
}

fn full_raw(stat: &str) -> String {
    full_raw_with(stat, &net_section())
}

fn full_raw_with(stat: &str, net: &str) -> String {
    format!(
        "==SCX_STAT==\n{stat}\n==SCX_CORES==\n4\n==SCX_MEM==\n{}==SCX_LOAD==\n0.10 0.20 0.30 1/100 123\n==SCX_UPTIME==\n123456.78 0.00\n==SCX_NET==\n{net}",
        mem_section(),
    )
}

#[test]
fn parse_first_round_without_prev() {
    let outcome = parse_sample(&full_raw(STAT_LINE), None, 1_000).unwrap();
    let ParseOutcome::Sample(sample, counters) = outcome else {
        panic!("expected sample")
    };
    assert_eq!(sample.cpu_percent, None); // 首轮无差值基准
    assert_eq!(sample.cpu_cores, 4);
    assert_eq!(sample.load, [0.10, 0.20, 0.30]);
    assert_eq!(sample.mem.total_kb, 1000);
    assert_eq!(sample.mem.used_kb, 600); // total - available
    assert!((sample.mem.percent - 60.0).abs() < 0.01);
    assert_eq!(sample.swap.total_kb, 2000);
    assert_eq!(sample.swap.used_kb, 1500);
    assert_eq!(sample.uptime_s, 123456);
    assert_eq!(sample.net_rates, None); // 首轮无速率
    assert_eq!(counters.cpu_total, 1000); // 100+0+50+800+20+0+0+30
    assert_eq!(counters.cpu_idle, 820); // idle+iowait
    assert_eq!(counters.net_bytes.get("eth0"), Some(&(1024000, 2048000)));
    assert!(counters.net_bytes.get("lo").is_none()); // lo 已滤
}

#[test]
fn parse_second_round_computes_rates() {
    let (_, counters) = match parse_sample(&full_raw(STAT_LINE), None, 1_000).unwrap() {
        ParseOutcome::Sample(s, c) => (*s, c),
        _ => panic!(),
    };
    let outcome = parse_sample(
        &full_raw_with(STAT_LINE2, &net_section2()),
        Some(&counters),
        3_000,
    )
    .unwrap();
    let ParseOutcome::Sample(sample, _) = outcome else { panic!() };
    // cpu: delta_total=1000, delta_idle=820 → busy 18%
    assert!((sample.cpu_percent.unwrap() - 18.0).abs() < 0.01);
    let rates = sample.net_rates.unwrap();
    assert_eq!(rates.len(), 1);
    assert_eq!(rates[0].name, "eth0");
    // rx: (2048000-1024000)/2s/1024 = 500 KB/s
    assert!((rates[0].rx_kb_s - 500.0).abs() < 0.01);
    assert!((rates[0].tx_kb_s - 1000.0).abs() < 0.01);
}

#[test]
fn net_counter_reset_clamps_to_zero() {
    // 网卡计数器重置（rx/tx 回落）不得下溢：速率钳制为 0
    let (_, counters) =
        match parse_sample(&full_raw_with(STAT_LINE, &net_section()), None, 1_000).unwrap() {
            ParseOutcome::Sample(s, c) => (*s, c),
            _ => panic!(),
        };
    // 第二轮计数器回落（重置）
    let reset =
        "  eth0: 100    1    0    0    0     0          0         0  200    1\n".to_string();
    let outcome =
        parse_sample(&full_raw_with(STAT_LINE2, &reset), Some(&counters), 3_000).unwrap();
    let ParseOutcome::Sample(sample, _) = outcome else { panic!() };
    let rates = sample.net_rates.unwrap();
    assert_eq!(rates[0].rx_kb_s, 0.0);
    assert_eq!(rates[0].tx_kb_s, 0.0);
}

#[test]
fn parse_low_freq_sections() {
    let raw = format!(
        "{}==SCX_DF==\nFilesystem     1024-blocks      Used Available Capacity Mounted on\n/dev/sda1           1000000    400000     600000      40% /\n==SCX_PS==\n  PID %CPU %MEM COMMAND\n    1  5.0  1.0 systemd\n   42  2.5  0.5 sshd\n==SCX_OS==\nUbuntu 22.04.3 LTS\n5.15.0-91-generic x86_64\n",
        full_raw(STAT_LINE)
    );
    let outcome = parse_sample(&raw, None, 1_000).unwrap();
    let ParseOutcome::Sample(sample, _) = outcome else { panic!() };
    let disks = sample.disks.unwrap();
    assert_eq!(disks.len(), 1);
    assert_eq!(disks[0].mount, "/");
    assert_eq!(disks[0].total_kb, 1000000);
    assert_eq!(disks[0].used_kb, 400000);
    assert!((disks[0].percent - 40.0).abs() < 0.01);
    let procs = sample.processes.unwrap();
    assert_eq!(procs.len(), 2);
    assert_eq!(procs[0].pid, 1);
    assert_eq!(procs[0].command, "systemd");
    assert!((procs[0].cpu_percent - 5.0).abs() < 0.001);
    assert_eq!(
        sample.os_info.as_deref(),
        Some("Ubuntu 22.04.3 LTS · 5.15.0-91-generic x86_64")
    );
}

#[test]
fn busybox_garbage_low_freq_degrades_to_none() {
    // busybox ps 不支持 axo：段内容无法解析 → processes None，核心指标不受影响
    let raw = format!(
        "{}==SCX_DF==\n==SCX_PS==\nps: unrecognized option: axo\n",
        full_raw(STAT_LINE)
    );
    let ParseOutcome::Sample(sample, _) =
        parse_sample(&raw, None, 1_000).unwrap() else { panic!() };
    assert_eq!(sample.processes, None);
    assert_eq!(sample.disks, None);
    assert!(sample.mem.total_kb > 0);
}

#[test]
fn missing_proc_marks_unsupported() {
    // macOS 等：/proc 不存在，grep 全空 → STAT 与 MEM 段皆缺失 → Unsupported
    let raw = "==SCX_STAT==\n==SCX_CORES==\n0\n==SCX_MEM==\n==SCX_LOAD==\n==SCX_UPTIME==\n==SCX_NET==\n";
    assert!(matches!(
        parse_sample(raw, None, 1_000).unwrap(),
        ParseOutcome::Unsupported
    ));
}

#[test]
fn no_markers_is_transient_error_not_unsupported() {
    // 传输层死亡时 exec 无任何 marker 输出：应 Err（自愈）而非 Unsupported 终态
    let raw = ""; // 或完全无关的输出
    assert!(parse_sample(raw, None, 1_000).is_err());
}

#[test]
fn build_command_includes_sections_by_flags() {
    let high = build_command(false, false);
    assert!(high.contains("grep '^cpu ' /proc/stat"));
    assert!(high.contains("==SCX_DF==") == false);
    assert!(high.contains("==SCX_OS==") == false);
    let full_first = build_command(true, true);
    assert!(full_first.contains("==SCX_DF=="));
    assert!(full_first.contains("==SCX_PS=="));
    assert!(full_first.contains("==SCX_OS=="));
}
