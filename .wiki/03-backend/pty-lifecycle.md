# PTY 生命周期（Rust 侧）

文件：`src-tauri/src/pty.rs`（唯一 PTY 实现，`PtyManager { ptys: HashMap<String, Arc<Pty>> }` 由 `lib.rs` `manage` 注入；会话 id 为 UUID 字符串）。

## spawn（`pty_spawn`，**async 命令**）

1. `NativePtySystem.openpty(PtySize)`——尺寸来自 `SpawnOptions { file, args, env, cwd?, cols(默认80), rows(默认30) }`（serde camelCase，前端 `PTYSpawnOptions` 一一对应）。
2. `CommandBuilder`：叠加 env → `apply_macos_locale`（GUI 应用无 locale 时镜像 `LC_CTYPE`/`LANG` 到全部 LC_*，默认 `en_US.UTF-8`）→ cwd（`options.cwd` → `$HOME` → `$USERPROFILE`，须是存在的目录）。TERM/COLORTERM/TERM_PROGRAM 由前端注入，Rust 不负责。
3. spawn → drop slave → `try_clone_reader` + `take_writer` → 构造 `Pty` 存入 map。
4. 起三个线程（见下）。

`Pty` 字段：`writer: Mutex<Option<…>>`、`master`、`child: Mutex<Box<dyn Child>>`、`killer: Mutex<Box<dyn ChildKiller>>`、`exited/reader_done: AtomicBool`、`queue: Arc<PtyDataQueue>`。

## 三个线程

1. **读线程**：循环 `wait_while_paused()`（背压）→ `read(64KB)` → `queue.push`。EOF/错误 → 置 `reader_done`、`queue.close()`、emit `pty:{id}:close`。
2. **UTF-8 flush 线程**：每 250ms 检查，`Utf8Splitter` 中滞留超过 500ms 的不完整多字节序列被强制下发（`flush_stale_partial`）。
3. **子进程等待线程**：`child.lock().wait()`（**持锁阻塞等待**——因此 `kill` 绝不能碰这把锁）→ emit `pty:{id}:exit`（携带退出码 JSON）→ 最多等读线程 2s 排空 → `kill()` → 从 map 移除（指针相等校验防误删新会话）。

## 输出背压（`PtyDataQueue`）

- `maybe_emit`：每次最多发一个 `MAX_CHUNK`（100KB）、UTF-8 安全的块，经 `Channel<InvokeResponseBody::Raw>` 二进制直达前端；`delta`（已发未确认字节）超过 `MAX_DELTA`（500KB）时置 `paused`，读线程在 `wait_while_paused` 阻塞——内核随即反压子进程（真实流控，防 `yes` 类洪水）。
- 前端每块回 `pty_ack_data(length)`，`delta` 回落即恢复。`Utf8Splitter` 保证多字节字符不跨块（单测见文件尾部 tests 模块）。

## kill 与死锁修复（重要）

`Pty::kill()`：先 `writer = None`（drop master writer → 向会话发 EOF/SIGHUP，shell 有机会干净退出），再经 **`killer`（`clone_killer()` 拆出的独立杀手句柄）** 发信号。

**为什么必须用 killer**：清理线程持有 `child` Mutex 阻塞在 `wait()`；若 kill 去抢同一把锁，当前台程序（vim/less/sleep）运行时 `wait()` 永不返回 → kill 永久阻塞。历史上这里死锁过：kill 是同步命令（跑在主线程）时整个窗口冻结。

**主线程阻塞防护**：`pty_spawn` / `pty_write` / `pty_resize` 中的 spawn/write/kill 三个**阻塞 IO 命令为 async**（Tauri v2 移到线程池执行）——大段粘贴给不读 stdin 的程序时 `write_all` 阻塞不再冻结 UI。

## resize / exists

`pty_resize(cols, rows)` → `master.resize(PtySize)`；`pty_exists` = 在 map 且 `exited` 为 false。

## Related

- [02-frontend/sessions-and-middleware](../02-frontend/sessions-and-middleware.md)
- [05-reference/ipc-reference](../05-reference/ipc-reference.md)
