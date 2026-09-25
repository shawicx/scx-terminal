//! 采样命令拼装与 /proc 输出解析（纯函数，可独立单测）：
//! marker 切段 → stat/meminfo/loadavg/uptime/net/dev/df/ps/os-release 逐段解析，
//! CPU 与网卡速率按上轮差值基准计算。

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

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
