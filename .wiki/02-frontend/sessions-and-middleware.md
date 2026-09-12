# 会话层与中间件

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/lib/sessions/baseSession.ts` | `BaseSession` 抽象基类：拥有中间件栈、输出/关闭/销毁流、首屏缓冲、销毁管线（移植 tabby-terminal） |
| `src/lib/sessions/localSession.ts` | `LocalSession`：本地 shell 会话（移植 tabby-local），对接 `TauriPTYProxy` |
| `src/services/pty.ts` | `TauriPTYProxy`：Rust PTY 的前端句柄（移植 tabby-electron 的 pty 代理，Electron IPC → Tauri IPC） |
| `src/lib/middleware/middleware.ts` | `SessionMiddleware` / `SessionMiddlewareStack`：会话与前端之间的 I/O 处理链 |
| `src/lib/middleware/oscProcessing.ts` | `OSCProcessor`：拦截 OSC 1337（cwd 上报）与 OSC 52（剪贴板写入，未实现） |
| `src/lib/middleware/inputProcessing.ts`、`streamProcessing.ts` | 退格重映射 / 换行转换中间件——**已实现但未被实例化**（配置键无效） |

## 中间件栈

数据结构：栈内每个 `SessionMiddleware` 有 `outputToTerminal$` 与 `outputToSession$` 两个 Subject；`SessionMiddlewareStack.relink()` 把相邻层串成链（session→terminal 从栈底流向栈顶方向，terminal→session 反向）。当前栈内容（`BaseSession` 构造函数）：`[基础透传层, OSCProcessor]`。

`feedFromSession`（shell 输出）从 `stack[0]` 进入；`feedFromTerminal`（用户输入）从栈顶进入。

## BaseSession（`baseSession.ts`）

- `initialDataBuffer`：会话输出在 `releaseInitialDataBuffer()` 之前先攒在内存，保证 attach 完成前首屏（提示符/motd）不丢。`TerminalPane` 在 `session.start()` 返回后立即调用它。
- `destroy()` 幂等：先发 `closed`/`destroyed` → `gracefullyKillProcess()` → 关闭中间件与全部 Subject。
- `reportedCWD`：订阅 `oscProcessor.cwdReported$` 更新——目前无消费方（见项目概述"已知限制"）。

## LocalSession（`localSession.ts`）

**启动参数**：注入环境 `TERM=xterm-256color`、`COLORTERM=truecolor`、`TERM_PROGRAM=scx-terminal`；cwd 为 `null`（Rust 侧回退 `$HOME`）；**初始尺寸竞态修复**——`resize$` 是 ReplaySubject，fit 尺寸可能在 spawn 前到达，此时存入 `pendingResize`，`start()` 用它作为 spawn 尺寸（避免 PTY 固定 80×30 导致输入行第 80 列提前换行）；spawn 往返期间新到的 resize 在启动后立即补发。

**输出链**：`pty.subscribe('data')` → 每块先 `ackData(len)`（驱动 Rust 侧背压）再 `emitOutput`。

**退出处理**：监听 `pty:{id}:exit` / `pty:{id}:close` 事件；`pauseAfterExit` 模式下显示 "Press any key to close"，否则直接销毁会话。

## TauriPTYProxy（`src/services/pty.ts`）

- `start()`：先安装 `Channel.onmessage`（二进制），再 `invoke('pty_spawn', { options, channel })`，随后 `listen` exit/close 事件。
- **首屏缓冲**：channel 回调先于 spawn 安装、而 `data` 订阅者在 spawn+两次 listen 往返后才注册；这段窗口内的输出压入 `pendingChunks`，首个 `subscribe('data')` 时 `flushPendingChunks()` 回放（走同一路径保证 ack 语义一致）。这是新建标签提示符完整显示的关键之一。
- `write/resize/kill/ackData/exists` 均为对 Rust 命令的薄封装；`write` 错误被吞掉（PTY 可能在按键与送达之间退出，不是错误）。

## Related

- [terminal-rendering](terminal-rendering.md)
- [03-backend/pty-lifecycle](../03-backend/pty-lifecycle.md)
- [05-reference/ipc-reference](../05-reference/ipc-reference.md)
