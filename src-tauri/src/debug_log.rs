//! @description 调试日志：advanced.debugEnabled 开启时，把前后端诊断行追加写入
//!               app_data/logs/scx-terminal.log（带时间戳、按启动分隔、超过 2MB 丢弃前半）。
//!               关闭时所有写入为 no-op，stdout 行为不受影响。

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// 单文件日志上限（字节）：超过后丢弃前半、保留后半（整行对齐）
pub const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

/// 调试日志状态：enabled 标志 + 日志文件路径 + 写入互斥锁
pub struct DebugLogState {
    enabled: AtomicBool,
    log_path: PathBuf,
    io_lock: Mutex<()>,
}

impl DebugLogState {
    ///
    /// @description 构造调试日志状态（日志目录不存在则创建）；初始为关闭态
    /// @param data_dir 应用数据目录（日志写入其下 logs/ 子目录）
    /// @returns Self 日志状态实例
    ///
    /// @example DebugLogState::new(&app_data_dir)
    ///
    pub fn new (data_dir: &Path) -> Self {
        let logs_dir = data_dir.join("logs");
        let _ = std::fs::create_dir_all(&logs_dir);
        Self {
            enabled: AtomicBool::new(false),
            log_path: logs_dir.join("scx-terminal.log"),
            io_lock: Mutex::new(()),
        }
    }

    ///
    /// @description 日志文件完整路径（设置页「打开日志目录」用其所在目录）
    /// @returns &Path 日志文件路径
    ///
    pub fn log_path (&self) -> &Path {
        &self.log_path
    }

    ///
    /// @description 切换调试日志开关；开启时写入一条启动分隔行（用于区分两次运行）
    /// @param enabled 是否开启
    /// @returns void
    ///
    pub fn set_enabled (&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
        if enabled {
            self.append_raw("==== launch ====");
        }
    }

    ///
    /// @description 追加一条带时间戳的日志行；未开启时为 no-op，超过上限先截断旧内容
    /// @param message 日志内容（单行，不含换行）
    /// @returns void
    ///
    pub fn append (&self, message: &str) {
        if !self.enabled.load(Ordering::SeqCst) {
            return;
        }
        self.append_raw(message);
    }

    ///
    /// @description 追加一行（不加开关门控）：启动分隔行与业务日志共用的底层写入，
    ///              串行化写入并在写后做超限截断；磁盘失败静默忽略（日志尽力而为）
    /// @param message 日志内容（单行）
    /// @returns void
    ///
    fn append_raw (&self, message: &str) {
        let guard = match self.io_lock.lock() {
            Ok(guard) => guard,
            // 写入线程 panic 中毒后恢复互斥锁：诊断日志不能因一次 panic 永久失活
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&self.log_path) {
            let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
            let _ = writeln!(file, "[{timestamp}] {message}");
        }
        let _ = truncate_over_limit(&self.log_path, MAX_LOG_BYTES);
        drop(guard);
    }
}

///
/// @description 文件超过 max_bytes 时丢弃前半、保留后半（从后半首个换行之后起整行保留；
///              单行超限时整段丢弃）；未超限不动文件
/// @param path 目标文件路径
/// @param max_bytes 大小上限（字节）
/// @returns io::Result<bool> 是否发生了截断
///
/// @example truncate_over_limit(&path, 2048)? // 超过 2KB 则截断
///
fn truncate_over_limit (path: &Path, max_bytes: u64) -> std::io::Result<bool> {
    let len = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    if len <= max_bytes {
        return Ok(false);
    }
    let content = std::fs::read_to_string(path)?;
    let mut mid = content.len() / 2;
    while !content.is_char_boundary(mid) {
        mid += 1;
    }
    let keep_from = content[mid..].find('\n').map(|offset| mid + offset + 1).unwrap_or(content.len());
    std::fs::File::create(path)?.write_all(&content.as_bytes()[keep_from..])?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir (tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("scx-debug-log-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn append_writes_timestamped_lines_only_when_enabled() {
        let dir = temp_dir("append");
        let state = DebugLogState::new(&dir);
        state.append("early");
        assert!(!state.log_path().exists(), "关闭态不得写文件");
        state.set_enabled(true);
        state.append("hello");
        let body = std::fs::read_to_string(state.log_path()).unwrap();
        assert!(body.contains("==== launch"), "开启时应有启动分隔行");
        assert!(body.contains("] hello"), "行内容应带时间戳前缀");
    }

    #[test]
    fn truncate_over_limit_keeps_aligned_tail() {
        let path = temp_dir("tail").join("t.log");
        let big: String = (0..100).map(|i| format!("line-{i:02}-aaaaaaaaaa\n")).collect();
        std::fs::write(&path, &big).unwrap();

        let truncated = truncate_over_limit(&path, 200).unwrap();

        assert!(truncated);
        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.len() < big.len() / 2 + 32, "保留量应约为后半");
        assert!(!body.contains("line-00-"), "前半应被丢弃");
        assert!(body.trim_end().ends_with("line-99-aaaaaaaaaa"), "末行必须完整保留");
    }

    #[test]
    fn truncate_over_limit_drops_single_oversized_line() {
        let path = temp_dir("single").join("t.log");
        std::fs::write(&path, "x".repeat(500)).unwrap();
        assert!(truncate_over_limit(&path, 200).unwrap());
        assert!(std::fs::read_to_string(&path).unwrap().is_empty());
    }

    #[test]
    fn truncate_leaves_small_files_alone() {
        let path = temp_dir("small").join("t.log");
        std::fs::write(&path, "tiny\n").unwrap();
        assert!(!truncate_over_limit(&path, 200).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "tiny\n");
    }
}
