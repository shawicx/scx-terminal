//! PTY 输出数据队列：背压（100KB 块 / 500KB 未确认窗口）+ UTF-8 安全切分 +
//! Tauri Channel 二进制直发。pty 与 ssh 会话共用（字段/方法 crate 内可见）。

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};
use std::time::Instant;

use tauri::ipc::{Channel, InvokeResponseBody};

const MAX_CHUNK: usize = 100 * 1024;
const MAX_DELTA: usize = MAX_CHUNK * 5;

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
    pub(crate) fn wait_while_paused(&self) -> bool {
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
