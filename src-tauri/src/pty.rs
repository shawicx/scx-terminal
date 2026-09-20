//! PTY management: spawn/write/resize/kill with an ack-based backpressure
//! protocol, ported from Tabby's Electron main-process implementation
//! (legacy/app/lib/pty.ts + utfSplitter.ts).
//!
//! Data plane: output chunks are pushed to the frontend over a raw binary
//! IPC channel (`tauri::ipc::Channel`) to avoid JSON serialization overhead.
//! The frontend acknowledges every chunk with `pty_ack_data`; while
//! unacknowledged bytes exceed `MAX_DELTA`, the reader thread stops draining
//! the pty, which makes the kernel block the child process (real backpressure).

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use portable_pty::{Child, ChildKiller, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Deserialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

const MAX_CHUNK: usize = 100 * 1024;
const MAX_DELTA: usize = MAX_CHUNK * 5;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnOptions {
    pub file: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub cwd: Option<String>,
    #[serde(default = "default_cols")]
    pub cols: u16,
    #[serde(default = "default_rows")]
    pub rows: u16,
}

fn default_cols() -> u16 {
    80
}

fn default_rows() -> u16 {
    30
}

/// Keeps trailing bytes of a (possibly) incomplete UTF-8 sequence so that
/// multibyte characters are never split across two output chunks.
struct Utf8Splitter {
    internal: Vec<u8>,
}

/// (leading-byte pattern, shift, max offset from the end to check)
const PARTIALS: [(u8, u32, usize); 3] = [(0b110, 5, 0), (0b1110, 4, 1), (0b11110, 3, 2)];

impl Utf8Splitter {
    fn new() -> Self {
        Self { internal: Vec::new() }
    }

    fn write(&mut self, data: &[u8]) -> Vec<u8> {
        self.internal.extend_from_slice(data);

        let len = self.internal.len();
        let mut keep = 0usize;
        for (pattern, shift, max_offset) in PARTIALS {
            for offset in 0..=max_offset {
                if offset >= len {
                    break;
                }
                let byte = self.internal[len - offset - 1];
                if (byte >> shift) == pattern {
                    keep = keep.max(offset + 1);
                }
            }
        }

        let split_at = len - keep;
        let result = self.internal[..split_at].to_vec();
        self.internal.drain(..split_at);
        result
    }

    fn flush(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.internal)
    }
}

struct QueueState {
    buffers: VecDeque<Vec<u8>>,
    /// bytes sent to the frontend but not yet acknowledged
    delta: usize,
    paused: bool,
    splitter: Utf8Splitter,
    last_emit: Instant,
    closed: bool,
}

/// 输出数据队列：背压（100KB 块 / 500KB 未确认窗口）+ UTF-8 安全切分 + Tauri Channel 直发。
/// pty 与 ssh 会话共用（字段/方法 crate 内可见）
pub(crate) struct PtyDataQueue {
    state: Mutex<QueueState>,
    resume: Condvar,
    channel: Channel<InvokeResponseBody>,
}

impl PtyDataQueue {
    pub(crate) fn new(channel: Channel<InvokeResponseBody>) -> Self {
        Self {
            state: Mutex::new(QueueState {
                buffers: VecDeque::new(),
                delta: 0,
                paused: false,
                splitter: Utf8Splitter::new(),
                last_emit: Instant::now(),
                closed: false,
            }),
            resume: Condvar::new(),
            channel,
        }
    }

    /// Blocks while flow is paused. Called by the reader thread before each read.
    fn wait_while_paused(&self) -> bool {
        let mut state = self.state.lock().unwrap();
        while state.paused && !state.closed {
            state = self.resume.wait(state).unwrap();
        }
        !state.closed
    }

    pub(crate) fn push(&self, data: Vec<u8>) {
        let mut state = self.state.lock().unwrap();
        state.buffers.push_back(data);
        maybe_emit(&mut state, &self.channel);
    }

    pub(crate) fn ack(&self, length: usize) {
        let mut state = self.state.lock().unwrap();
        state.delta = state.delta.saturating_sub(length);
        if state.delta <= MAX_DELTA && state.paused {
            state.paused = false;
            self.resume.notify_all();
        }
        maybe_emit(&mut state, &self.channel);
    }

    /// Releases a partial UTF-8 sequence held by the splitter. Called ONLY at
    /// EOF (the child will never write more, so an incomplete tail renders as
    /// a replacement character instead of being dropped). Never flush while
    /// the stream is alive: a backpressure pause can park a partial for
    /// seconds while output continues later, and emitting it early splits the
    /// character — the frontend decodes each chunk independently, so both the
    /// orphaned lead bytes and the delayed continuation turn into U+FFFD tofu.
    ///
    /// # Returns
    ///
    /// true if anything was sent
    ///
    /// # Examples
    ///
    /// reader 线程读到 EOF 后调用：`queue.flush_partial(); queue.close();`
    pub(crate) fn flush_partial(&self) -> bool {
        let mut state = self.state.lock().unwrap();
        if state.closed {
            return false;
        }
        let remainder = state.splitter.flush();
        if remainder.is_empty() {
            return false;
        }
        state.last_emit = Instant::now();
        state.delta += remainder.len();
        let _ = self.channel.send(InvokeResponseBody::Raw(remainder));
        true
    }

    pub(crate) fn close(&self) {
        let mut state = self.state.lock().unwrap();
        state.closed = true;
        self.resume.notify_all();
    }
}

/// Sends at most one MAX_CHUNK-sized, UTF-8-safe chunk while flow control
/// allows it. Must be called with the queue lock held.
fn maybe_emit(state: &mut QueueState, channel: &Channel<InvokeResponseBody>) {
    if state.buffers.is_empty() {
        return;
    }
    if state.delta > MAX_DELTA && !state.paused {
        state.paused = true;
        return;
    }
    if state.delta > MAX_DELTA {
        return;
    }

    let mut total = 0usize;
    let mut chunk: Vec<u8> = Vec::new();
    while total < MAX_CHUNK {
        match state.buffers.pop_front() {
            Some(buf) => {
                total += buf.len();
                chunk.extend_from_slice(&buf);
            }
            None => break,
        }
    }
    if chunk.is_empty() {
        return;
    }
    if chunk.len() > MAX_CHUNK {
        let overflow = chunk.split_off(MAX_CHUNK);
        state.buffers.push_front(overflow);
    }

    state.last_emit = Instant::now();
    let valid = state.splitter.write(&chunk);
    if valid.is_empty() {
        return;
    }
    state.delta += valid.len();
    let _ = channel.send(InvokeResponseBody::Raw(valid));
}

pub struct Pty {
    #[allow(dead_code)]
    pub id: String,
    /// 子进程 pid：spawn 时在 child 移入 Mutex 前取出（child 锁被清理线程的
    /// wait() 长期持有，事后无法无死锁地再取），供 cwd 探测使用
    pid: Option<u32>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    /// 独立于 `child` 的杀手句柄：清理线程会在 `child.lock().wait()` 上阻塞，
    /// 若 kill 也去抢同一把锁会永久死锁（前台任务运行时 wait 永不返回）。
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    exited: Arc<AtomicBool>,
    reader_done: Arc<AtomicBool>,
    queue: Arc<PtyDataQueue>,
}

impl Pty {
    fn resize(&self, cols: u16, rows: u16) {
        let size = PtySize { rows, cols, pixel_width: 0, pixel_height: 0 };
        let _ = self.master.lock().unwrap().resize(size);
    }

    /// 读 shell 子进程当前工作目录；pid 未知或会话已退出时返回 `None`
    ///
    /// # Returns
    ///
    /// 目录绝对路径或 `None`
    ///
    /// # Examples
    ///
    /// `pty.process_cwd()` // Some("/Users/scx")
    fn process_cwd(&self) -> Option<String> {
        if self.exited.load(Ordering::Acquire) {
            return None;
        }
        crate::proc_cwd::proc_cwd(self.pid? as i32)
    }

    fn write(&self, data: &[u8]) -> std::io::Result<()> {
        let mut guard = self.writer.lock().unwrap();
        match guard.as_mut() {
            Some(writer) => writer.write_all(data),
            None => Ok(()),
        }
    }

    fn ack_data(&self, length: usize) {
        self.queue.ack(length);
    }

    fn kill(&self) {
        // Close the master writer first: dropping it signals EOF/SIGHUP to the
        // session, giving the shell a chance to shut down cleanly.
        *self.writer.lock().unwrap() = None;
        // 经由 clone_killer 发送信号，绝不触碰 child 锁（见字段注释）。
        let _ = self.killer.lock().unwrap().kill();
    }
}

pub struct PtyManager {
    ptys: Arc<Mutex<HashMap<String, Arc<Pty>>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self { ptys: Arc::new(Mutex::new(HashMap::new())) }
    }
}

// spawn/write/kill 使用 async 命令：Tauri 同步命令在主线程执行，
// 阻塞 IO（pty 缓冲满时的 write、等待子进程的 kill）会冻结整个窗口。
#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    manager: State<'_, PtyManager>,
    channel: Channel<InvokeResponseBody>,
    options: SpawnOptions,
) -> Result<String, String> {
    let pty_system = NativePtySystem::default();
    let size = PtySize {
        rows: options.rows,
        cols: options.cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("failed to open pty: {e}"))?;

    let mut cmd = CommandBuilder::new(&options.file);
    cmd.args(options.args.iter().map(|s| s.as_str()));
    for (key, value) in &options.env {
        cmd.env(key, value);
    }
    apply_macos_locale(&mut cmd);

    let cwd = options
        .cwd
        .clone()
        .or_else(|| std::env::var("HOME").ok())
        .or_else(|| std::env::var("USERPROFILE").ok());
    if let Some(cwd) = cwd {
        if std::path::Path::new(&cwd).is_dir() {
            cmd.cwd(cwd);
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("could not start {}: {e}", options.file))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to clone pty reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("failed to take pty writer: {e}"))?;

    let id = Uuid::new_v4().to_string();
    let queue = Arc::new(PtyDataQueue::new(channel));

    // 在 child 移入 Mutex 前拆出独立杀手句柄，供 kill() 无死锁地发信号
    let killer = child.clone_killer();
    let pid = child.process_id();

    let pty = Arc::new(Pty {
        id: id.clone(),
        pid,
        writer: Mutex::new(Some(writer)),
        master: Mutex::new(pair.master),
        child: Mutex::new(child),
        killer: Mutex::new(killer),
        exited: Arc::new(AtomicBool::new(false)),
        reader_done: Arc::new(AtomicBool::new(false)),
        queue: queue.clone(),
    });

    // Reader thread: drains pty output into the backpressure queue.
    {
        let queue = queue.clone();
        let app = app.clone();
        let id = id.clone();
        let reader_done = pty.reader_done.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 64 * 1024];
            loop {
                if !queue.wait_while_paused() {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => queue.push(buf[..n].to_vec()),
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
            reader_done.store(true, Ordering::Release);
            // EOF：最后一段残缺序列在这里放行（存活期间绝不中途冲刷，见 flush_partial）
            queue.flush_partial();
            queue.close();
            let _ = app.emit(&format!("pty:{id}:close"), ());
        });
    }

    // Child wait thread: emits exit, then waits for the reader to drain and
    // drops the manager's reference so closed ptys cannot accumulate.
    {
        let app = app.clone();
        let id_for_event = id.clone();
        let exited = pty.exited.clone();
        let reader_done = pty.reader_done.clone();
        let ptys = manager.ptys.clone();
        let pty_for_cleanup = pty.clone();
        std::thread::spawn(move || {
            let status = pty_for_cleanup.child.lock().unwrap().wait();
            exited.store(true, Ordering::Release);
            let _ = app.emit(
                &format!("pty:{id_for_event}:exit"),
                status.as_ref().map_or(serde_json::Value::Null, |s| serde_json::json!(s.exit_code())),
            );
            // Give the reader a moment to hit EOF and flush pending output.
            for _ in 0..40 {
                if reader_done.load(Ordering::Acquire) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            let _ = pty_for_cleanup.kill();
            let mut map = ptys.lock().unwrap();
            let is_same = map.get(&id_for_event).is_some_and(|existing| Arc::ptr_eq(existing, &pty_for_cleanup));
            if is_same {
                map.remove(&id_for_event);
            }
        });
    }

    manager.ptys.lock().unwrap().insert(id.clone(), pty);
    Ok(id)
}

/// macOS: GUI apps launch without locale environment variables, which makes
/// many CLI tools fall back to ASCII. Mirror the user's LC_CTYPE across the
/// locale variables, like Tabby does. (Ported from tabby-local/session.ts.)
fn apply_macos_locale(cmd: &mut CommandBuilder) {
    #[cfg(target_os = "macos")]
    {
        if std::env::var("LC_ALL").is_ok() {
            return;
        }
        let locale = std::env::var("LC_CTYPE")
            .or_else(|_| std::env::var("LANG"))
            .unwrap_or_else(|_| "en_US.UTF-8".to_string());
        for key in ["LANG", "LC_ALL", "LC_MESSAGES", "LC_NUMERIC", "LC_COLLATE", "LC_MONETARY"] {
            cmd.env(key, &locale);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = cmd;
}

#[tauri::command]
pub async fn pty_write(manager: State<'_, PtyManager>, id: String, data: Vec<u8>) -> Result<(), String> {
    let pty = manager.ptys.lock().unwrap().get(&id).cloned();
    match pty {
        Some(pty) => pty.write(&data).map_err(|e| e.to_string()),
        None => Err(format!("pty {id} not found")),
    }
}

#[tauri::command]
pub fn pty_resize(manager: State<'_, PtyManager>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let pty = manager.ptys.lock().unwrap().get(&id).cloned();
    match pty {
        Some(pty) => {
            pty.resize(cols, rows);
            Ok(())
        }
        None => Err(format!("pty {id} not found")),
    }
}

#[tauri::command]
pub async fn pty_kill(manager: State<'_, PtyManager>, id: String) -> Result<(), String> {
    let pty = manager.ptys.lock().unwrap().get(&id).cloned();
    match pty {
        Some(pty) => {
            pty.kill();
            Ok(())
        }
        None => Err(format!("pty {id} not found")),
    }
}

#[tauri::command]
pub fn pty_ack_data(manager: State<'_, PtyManager>, id: String, length: usize) {
    let pty = manager.ptys.lock().unwrap().get(&id).cloned();
    if let Some(pty) = pty {
        pty.ack_data(length);
    }
}

#[tauri::command]
pub fn pty_exists(manager: State<'_, PtyManager>, id: String) -> bool {
    let map = manager.ptys.lock().unwrap();
    map.get(&id).is_some_and(|pty| !pty.exited.load(Ordering::Acquire))
}

/// 读取会话 shell 子进程的当前工作目录（进程探测；OSC 7/1337 上报在前端中间件处理）
///
/// # Arguments
///
/// * `manager` - 全局 PTY 管理器
/// * `id` - 会话 id
///
/// # Returns
///
/// 工作目录绝对路径；会话不存在/已退出/探测失败时为 `None`
///
/// # Examples
///
/// `invoke('pty_get_cwd', { id })`
#[tauri::command]
pub fn pty_get_cwd(manager: State<'_, PtyManager>, id: String) -> Option<String> {
    let pty = manager.ptys.lock().unwrap().get(&id).cloned();
    pty.and_then(|pty| pty.process_cwd())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_splitter_keeps_partial_sequences() {
        let mut splitter = Utf8Splitter::new();
        // "你" = e4 bd a0
        let first = splitter.write(&[0x61, 0xe4, 0xbd]);
        assert_eq!(first, vec![0x61]);
        let second = splitter.write(&[0xa0, 0x62]);
        assert_eq!(second, vec![0xe4, 0xbd, 0xa0, 0x62]);
        assert!(splitter.flush().is_empty());
    }

    #[test]
    fn utf8_splitter_flush_releases_remainder() {
        let mut splitter = Utf8Splitter::new();
        let out = splitter.write(&[0x61, 0xf0]);
        assert_eq!(out, vec![0x61]);
        assert_eq!(splitter.flush(), vec![0xf0]);
    }
}
