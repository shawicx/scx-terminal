//! SSH 服务器监控：采样命令拼装、/proc 输出解析、样本数据结构、
//! 采样任务管理（MonitorManager）与 IPC 命令（monitor_start / monitor_stop）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, State};

use crate::ssh::SshManager;

/// 内存/交换分区用量快照
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemInfo {
    pub total_kb: u64,
    pub used_kb: u64,
    pub percent: f64,
}

/// 单网卡实时速率
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NetRate {
    pub name: String,
    pub rx_kb_s: f64,
    pub tx_kb_s: f64,
}

/// 单磁盘分区用量
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub fs: String,
    pub mount: String,
    pub total_kb: u64,
    pub used_kb: u64,
    pub percent: f64,
}

/// 单进程快照
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub command: String,
    pub cpu_percent: f64,
    pub mem_percent: f64,
}

/// 一次采样的全部指标（monitor-sample 事件 payload 内嵌）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSample {
    pub ts: u64,
    pub cpu_percent: Option<f64>,
    pub cpu_cores: u16,
    pub load: [f64; 3],
    pub mem: MemInfo,
    pub swap: MemInfo,
    pub uptime_s: u64,
    pub net_rates: Option<Vec<NetRate>>,
    pub disks: Option<Vec<DiskInfo>>,
    pub processes: Option<Vec<ProcessInfo>>,
    pub os_info: Option<String>,
}

/// 上轮差值基准（CPU jiffies 与网卡字节），不序列化
#[derive(Debug, Clone, Default)]
pub struct PrevCounters {
    pub cpu_total: u64,
    pub cpu_idle: u64,
    pub net_bytes: HashMap<String, (u64, u64)>,
    pub sampled_at_ms: u64,
}

/// 解析结果：正常样本（附下一轮差值基准）/ 非 Linux 终态
pub enum ParseOutcome {
    Sample(Box<MonitorSample>, PrevCounters),
    Unsupported,
}

const M_STAT: &str = "==SCX_STAT==";
const M_CORES: &str = "==SCX_CORES==";
const M_MEM: &str = "==SCX_MEM==";
const M_LOAD: &str = "==SCX_LOAD==";
const M_UPTIME: &str = "==SCX_UPTIME==";
const M_NET: &str = "==SCX_NET==";
const M_DF: &str = "==SCX_DF==";
const M_PS: &str = "==SCX_PS==";
const M_OS: &str = "==SCX_OS==";

/// 拼装单次采样命令（一条 POSIX sh，marker 切段）
///
/// # Arguments
///
/// * `with_low_freq` - 附带 df/ps 低频组（full 级每 3 轮一次）
/// * `with_os` - 附带 os-release/uname（仅首轮）
///
/// # Returns
///
/// String 组合命令
///
/// # Examples
///
/// `let cmd = build_command(true, true);`
pub(crate) fn build_command(with_low_freq: bool, with_os: bool) -> String {
    let mut parts = vec![
        format!("echo {M_STAT}; grep '^cpu ' /proc/stat 2>/dev/null"),
        format!("echo {M_CORES}; grep -c '^cpu[0-9]' /proc/stat 2>/dev/null"),
        format!(
            "echo {M_MEM}; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null"
        ),
        format!("echo {M_LOAD}; cat /proc/loadavg 2>/dev/null"),
        format!("echo {M_UPTIME}; cat /proc/uptime 2>/dev/null"),
        // 前导空白用 [[:space:]] 兼容；Inter/face/bytes 滤两行表头，lo/veth/br-/docker 滤无关接口
        format!(
            "echo {M_NET}; grep -vE '^[[:space:]]*(Inter|face|bytes|lo|veth|br-|docker)' /proc/net/dev 2>/dev/null"
        ),
    ];
    if with_low_freq {
        parts.push(format!("echo {M_DF}; df -kP -x tmpfs -x devtmpfs 2>/dev/null"));
        // comm 放最后：前 3 列定长数值，其余整体为命令名（可含空格）
        parts.push(format!(
            "echo {M_PS}; ps axo pid,pcpu,pmem,comm --sort=-pcpu 2>/dev/null | head -21"
        ));
    }
    if with_os {
        parts.push(format!(
            r#"echo {M_OS}; . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"; uname -rm 2>/dev/null"#
        ));
    }
    parts.join("; ")
}

/// 解析一次采集输出为样本 + 下一轮差值基准
///
/// # Arguments
///
/// * `raw` - exec stdout 全文
/// * `prev` - 上轮基准（首轮 None）
/// * `now_ms` - 当前毫秒时间戳
///
/// # Returns
///
/// ParseOutcome::Sample；输出含 marker 但 STAT 与 MEM 段皆空视作非 Linux 返回
/// Unsupported；输出完全无 marker（命令未真正执行，传输层死亡）与段内容畸形均返回
/// Err（当轮采集中断，任务自愈）
///
/// # Examples
///
/// `match parse_sample(&raw, prev.as_ref(), now_ms)? { ... }`
pub(crate) fn parse_sample(
    raw: &str,
    prev: Option<&PrevCounters>,
    now_ms: u64,
) -> Result<ParseOutcome, String> {
    // 按 marker 切段
    let mut sections: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut current: Option<&str> = None;
    let mut saw_marker = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        let marker = [M_STAT, M_CORES, M_MEM, M_LOAD, M_UPTIME, M_NET, M_DF, M_PS, M_OS]
            .into_iter()
            .find(|m| *m == trimmed);
        match marker {
            Some(m) => {
                current = Some(m);
                saw_marker = true;
                sections.entry(m).or_default();
            }
            None => {
                if let Some(key) = current {
                    sections.entry(key).or_default().push(line);
                }
            }
        }
    }

    // build_command 无条件 echo marker：Linux/macOS shell 必产 marker 行。
    // 无任何 marker = 命令从未执行（传输层死亡）→ Err 让当轮中断自愈，不误判终态
    if !saw_marker {
        return Err("no marker output".into());
    }

    if sections.get(M_STAT).map_or(true, |v| v.is_empty())
        && sections.get(M_MEM).map_or(true, |v| v.is_empty())
    {
        return Ok(ParseOutcome::Unsupported);
    }

    // --- /proc/stat：cpu 总计行，user..steal 共 8 字段求和，idle = idle+iowait ---
    let stat_line = sections
        .get(M_STAT)
        .and_then(|v| v.iter().find(|l| l.starts_with("cpu")))
        .ok_or("missing cpu stat line")?;
    let fields: Vec<u64> = stat_line
        .split_whitespace()
        .skip(1)
        .filter_map(|t| t.parse().ok())
        .collect();
    if fields.len() < 4 {
        return Err(format!("malformed cpu stat: {stat_line}").into());
    }
    let cpu_total: u64 = fields.iter().take(8).sum();
    let cpu_idle = fields[3] + fields.get(4).copied().unwrap_or(0);

    let cpu_cores: u16 = sections
        .get(M_CORES)
        .and_then(|v| v.first())
        .and_then(|l| l.trim().parse().ok())
        .unwrap_or(0);

    // --- /proc/meminfo ---
    let mut mem_total = 0u64;
    let mut mem_available = None;
    let mut swap_total = 0u64;
    let mut swap_free = 0u64;
    for line in sections.get(M_MEM).into_iter().flatten() {
        let mut it = line.split_whitespace();
        let (Some(key), Some(value)) = (it.next(), it.next()) else {
            continue;
        };
        let kb: u64 = value.parse().unwrap_or(0);
        match key.trim_end_matches(':') {
            "MemTotal" => mem_total = kb,
            "MemAvailable" => mem_available = Some(kb),
            "SwapTotal" => swap_total = kb,
            "SwapFree" => swap_free = kb,
            _ => {}
        }
    }
    if mem_total == 0 {
        return Err("missing MemTotal".into());
    }
    let mem = mem_info(mem_total, mem_available.unwrap_or(0));
    // swap 的“可用量”即 SwapFree（used = SwapTotal - SwapFree）
    let swap = mem_info(swap_total, swap_free);

    // --- loadavg / uptime ---
    let load_line = sections
        .get(M_LOAD)
        .and_then(|v| v.first())
        .ok_or("missing loadavg")?;
    let load_values: Vec<f64> = load_line
        .split_whitespace()
        .take(3)
        .filter_map(|t| t.parse().ok())
        .collect();
    if load_values.len() < 3 {
        return Err(format!("malformed loadavg: {load_line}").into());
    }
    let load = [load_values[0], load_values[1], load_values[2]];
    let uptime_s: u64 = sections
        .get(M_UPTIME)
        .and_then(|v| v.first())
        .and_then(|l| l.split_whitespace().next())
        .and_then(|t| t.parse::<f64>().ok())
        .map(|v| v as u64)
        .unwrap_or(0);

    // --- /proc/net/dev：差值速率（首轮 None） ---
    let mut net_bytes: HashMap<String, (u64, u64)> = HashMap::new();
    let mut net_rates: Option<Vec<NetRate>> = None;
    let mut net_lines: Vec<(String, u64, u64)> = Vec::new();
    for line in sections.get(M_NET).into_iter().flatten() {
        let Some((name, rest)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim();
        // 与 build_command 的 grep 过滤对齐：回环接口不计入速率与差值基准
        if name == "lo" {
            continue;
        }
        let fields: Vec<&str> = rest.split_whitespace().collect();
        if fields.len() < 9 {
            continue;
        }
        let (Ok(rx), Ok(tx)) = (fields[0].parse(), fields[8].parse()) else {
            continue;
        };
        net_lines.push((name.to_string(), rx, tx));
        net_bytes.insert(name.to_string(), (rx, tx));
    }
    if let Some(prev) = prev {
        let elapsed_s = (now_ms.saturating_sub(prev.sampled_at_ms)).max(1) as f64 / 1000.0;
        let rates: Vec<NetRate> = net_lines
            .iter()
            .filter_map(|(name, rx, tx)| {
                prev.net_bytes.get(name).map(|(prx, ptx)| NetRate {
                    name: name.clone(),
                    rx_kb_s: (rx.saturating_sub(*prx) as f64 / elapsed_s / 1024.0).max(0.0),
                    tx_kb_s: (tx.saturating_sub(*ptx) as f64 / elapsed_s / 1024.0).max(0.0),
                })
            })
            .collect();
        net_rates = Some(rates);
    }

    // --- df（低频，尽力而为；段缺失或空 → None） ---
    let disks: Option<Vec<DiskInfo>> = sections
        .get(M_DF)
        .filter(|lines| !lines.is_empty())
        .map(|lines| {
        lines
            .iter()
            .filter_map(|l| {
                let f: Vec<&str> = l.split_whitespace().collect();
                if f.len() < 6 || f[1].parse::<u64>().is_err() {
                    return None;
                }
                let total_kb: u64 = f[1].parse().unwrap_or(0);
                let used_kb: u64 = f[2].parse().unwrap_or(0);
                Some(DiskInfo {
                    fs: f[0].to_string(),
                    mount: f[5].to_string(),
                    percent: if total_kb > 0 {
                        used_kb as f64 / total_kb as f64 * 100.0
                    } else {
                        0.0
                    },
                    total_kb,
                    used_kb,
                })
            })
            .collect()
    });

    // --- ps（低频，尽力而为；busybox 失败得空列表 → None） ---
    let processes: Option<Vec<ProcessInfo>> = sections.get(M_PS).and_then(|lines| {
        let parsed: Vec<ProcessInfo> = lines
            .iter()
            .filter_map(|l| {
                let mut it = l.split_whitespace();
                let pid: u32 = it.next()?.parse().ok()?;
                let cpu: f64 = it.next()?.parse().ok()?;
                let memp: f64 = it.next()?.parse().ok()?;
                let command = it.collect::<Vec<_>>().join(" ");
                Some(ProcessInfo { pid, command, cpu_percent: cpu, mem_percent: memp })
            })
            .collect();
        (parsed.len() > 1).then_some(parsed) // 只有 0-1 行视为解析失败/无数据
    });

    // --- os-release / uname（首轮） ---
    let os_info: Option<String> = sections.get(M_OS).and_then(|lines| {
        let pretty = lines.first()?.trim().to_string();
        if pretty.is_empty() {
            return None;
        }
        match lines.get(1).map(|l| l.trim()) {
            Some(kernel) if !kernel.is_empty() => Some(format!("{pretty} · {kernel}")),
            _ => Some(pretty),
        }
    });

    let cpu_percent = prev.and_then(|p| {
        let dt = cpu_total.saturating_sub(p.cpu_total);
        let di = cpu_idle.saturating_sub(p.cpu_idle);
        (dt > 0).then(|| (1.0 - di as f64 / dt as f64) * 100.0)
    });

    let sample = MonitorSample {
        ts: now_ms,
        cpu_percent,
        cpu_cores,
        load,
        mem,
        swap,
        uptime_s,
        net_rates,
        disks,
        processes,
        os_info,
    };
    let counters = PrevCounters {
        cpu_total,
        cpu_idle,
        net_bytes,
        sampled_at_ms: now_ms,
    };
    Ok(ParseOutcome::Sample(Box::new(sample), counters))
}

/// 由总量与可用量构造 MemInfo
fn mem_info(total_kb: u64, available_kb: u64) -> MemInfo {
    let used_kb = total_kb.saturating_sub(available_kb);
    MemInfo {
        total_kb,
        used_kb,
        percent: if total_kb > 0 {
            used_kb as f64 / total_kb as f64 * 100.0
        } else {
            0.0
        },
    }
}

/// 采样等级：card = 5s 核心指标；full = 2s 核心 + 每 3 轮低频组
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MonitorLevel {
    Card,
    Full,
}

/// monitor-sample 事件 payload
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SampleEvent {
    profile_id: String,
    sample: MonitorSample,
}

/// monitor-sample-error / monitor-fatal / monitor-unsupported 事件 payload
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorEvent {
    profile_id: String,
    message: String,
}

/// 按档案索引的采样任务管理器（profileId → spawn 句柄 + 代次，abort 即取消）
///
/// 任务表条目携带随每次启动递增的 generation；任务自清理（fatal/unsupported）
/// 仅当表中代次与自身一致才移除，防止旧任务迟滞 remove 误删重启后的新条目。
#[derive(Default)]
pub struct MonitorManager {
    tasks: Arc<Mutex<std::collections::HashMap<String, (JoinHandle<()>, u64)>>>,
    next_gen: std::sync::atomic::AtomicU64,
}

impl MonitorManager {
    pub fn new() -> Self {
        Self::default()
    }
}

/// 当前毫秒时间戳
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 启动（或重启）档案的采样任务
///
/// # Arguments
///
/// * `app` - AppHandle（事件发射）
/// * `ssh` - SSH 会话管理器
/// * `manager` - 监控任务管理器
/// * `profile_id` - 档案 id
/// * `ssh_id` - 采样的 SSH 连接 id
/// * `level` - 采样等级
///
/// # Returns
///
/// Ok(())；档案不存在连接返回 Err
///
/// # Examples
///
/// `invoke('monitor_start', { profileId, sshId, level: 'full' })`
#[tauri::command]
pub async fn monitor_start(
    app: AppHandle,
    ssh: State<'_, SshManager>,
    manager: State<'_, MonitorManager>,
    profile_id: String,
    ssh_id: String,
    level: MonitorLevel,
) -> Result<(), String> {
    if ssh.session(&ssh_id).is_none() {
        return Err(format!("ssh session {ssh_id} not found"));
    }
    let sessions = ssh.sessions_arc();
    let tasks = manager.tasks.clone();
    let interval = match level {
        MonitorLevel::Card => Duration::from_secs(5),
        MonitorLevel::Full => Duration::from_secs(2),
    };
    // spawn 闭包按 move 捕获 profile_id；任务表键需在 move 前克隆
    let task_key = profile_id.clone();
    // 已有任务先取消（升级/降级统一走重启）；remove→abort→分配代次→spawn→insert
    // 全程单一临界区（spawn 同步不阻塞，持 std Mutex 守卫安全；守卫在返回前
    // 显式释放，不跨任何 await），防止并发 start 交错覆盖句柄或旧任务迟滞
    // remove 误删新条目
    let mut tasks_map = manager.tasks.lock().unwrap();
    if let Some((old, _)) = tasks_map.remove(&profile_id) {
        old.abort();
    }
    let my_gen = manager
        .next_gen
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let handle = tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        ticker.tick().await; // interval 首个 tick 立即返回，跳过后进入节奏
        let mut prev: Option<PrevCounters> = None;
        let mut round: u32 = 0;
        loop {
            ticker.tick().await;
            let Some(session) = sessions.lock().unwrap().get(&ssh_id).cloned() else {
                let _ = app.emit(
                    "monitor-fatal",
                    MonitorEvent {
                        profile_id: profile_id.clone(),
                        message: "ssh session closed".into(),
                    },
                );
                // 代次守卫：仅当表中仍是本任务代次才移除，防误删重启后的新条目
                let mut tasks = tasks.lock().unwrap();
                if tasks.get(&profile_id).map(|(_, g)| *g == my_gen).unwrap_or(false) {
                    tasks.remove(&profile_id);
                }
                return;
            };
            let with_low = level == MonitorLevel::Full && round % 3 == 0;
            let cmd = build_command(with_low, round == 0);
            match session.exec_command(&cmd, Duration::from_secs(10)).await {
                Ok(raw) => match parse_sample(&raw, prev.as_ref(), now_ms()) {
                    Ok(ParseOutcome::Sample(sample, counters)) => {
                        prev = Some(counters);
                        let _ = app.emit(
                            "monitor-sample",
                            SampleEvent {
                                profile_id: profile_id.clone(),
                                sample: *sample,
                            },
                        );
                    }
                    Ok(ParseOutcome::Unsupported) => {
                        let _ = app.emit(
                            "monitor-unsupported",
                            MonitorEvent {
                                profile_id: profile_id.clone(),
                                message: "unsupported platform".into(),
                            },
                        );
                        // 代次守卫：仅当表中仍是本任务代次才移除，防误删重启后的新条目
                        let mut tasks = tasks.lock().unwrap();
                        if tasks.get(&profile_id).map(|(_, g)| *g == my_gen).unwrap_or(false) {
                            tasks.remove(&profile_id);
                        }
                        return;
                    }
                    Err(e) => {
                        let _ = app.emit(
                            "monitor-sample-error",
                            MonitorEvent {
                                profile_id: profile_id.clone(),
                                message: e,
                            },
                        );
                    }
                },
                Err(e) => {
                    let _ = app.emit(
                        "monitor-sample-error",
                        MonitorEvent {
                            profile_id: profile_id.clone(),
                            message: e,
                        },
                    );
                }
            }
            round += 1;
        }
    });
    tasks_map.insert(task_key, (handle, my_gen));
    drop(tasks_map);
    Ok(())
}

/// 停止档案的采样任务
///
/// # Arguments
///
/// * `manager` - 监控任务管理器
/// * `profile_id` - 档案 id
///
/// # Returns
///
/// Ok(())（无任务为幂等 no-op）
///
/// # Examples
///
/// `invoke('monitor_stop', { profileId })`
#[tauri::command]
pub fn monitor_stop(manager: State<'_, MonitorManager>, profile_id: String) -> Result<(), String> {
    if let Some((task, _)) = manager.tasks.lock().unwrap().remove(&profile_id) {
        task.abort();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
