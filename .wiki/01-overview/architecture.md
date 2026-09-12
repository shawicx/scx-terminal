# 架构

## 三层结构

```text
┌───────────────────────────── WebView (Vue 3) ─────────────────────────────┐
│  App.vue 外壳                                                               │
│   ├── TitleBar（自定义标题栏 + 标签栏 + 设置入口）                            │
│   ├── TerminalTabContent × N（每个终端标签一棵分屏树，v-show 常驻）           │
│   │    └── SplitContainer（递归） → TerminalPane（每叶一个终端）             │
│   │         ├── XTermWebGLFrontend（xterm.js 渲染 + 输入/resize 事件流）      │
│   │         └── LocalSession（BaseSession + 中间件栈 + TauriPTYProxy）       │
│  ├── SettingsView / CommandPalette                                          │
│  └── Pinia stores：tabs / config / theme；services：commands/hotkeys/shells │
└────────────────────────────── Tauri IPC ───────────────────────────────────┘
         invoke 命令（JSON） │ Channel 二进制输出流 + ack │ emit 事件
┌───────────────────────────── Rust (src-tauri) ────────────────────────────┐
│  lib.rs：插件注册、PtyManager 状态、11 个命令                                │
│  pty.rs：portable-pty 会话（读线程 + 背压队列 + UTF-8 切分 + 清理线程）        │
│  shells.rs（/etc/shells 探测）│ config.rs（YAML 配置读写）                    │
└───────────────────────────────────────────────────────────────────────────┘
```

## 模块边界与依赖方向（来自 codebase-memory 图谱）

- `src/lib`（前端核心域：frontends / sessions / middleware / colorSchemes / hotkeys / utils）——被 `services`、`stores`、`components` 依赖，自身不反向依赖。
- `src/services`（对 Pinia 与 Tauri API 的粘合层：commands / pty / hotkeys / shells）——扇入最高。
- `src/stores`（tabs / config / theme）——依赖 `lib`，被组件消费。
- `src-tauri` 独立成层，只通过 IPC 契约与前端耦合（契约总表见 [05-reference/ipc-reference](../05-reference/ipc-reference.md)）。
- 前端**从不**直接调用 Rust crate，Rust 也从不渲染内容——一切经 IPC。

## 数据流总览

**输入（键盘 → shell）**：
`xterm onData` → `Frontend.input$` → `TerminalPane` 接线 → `BaseSession.feedFromTerminal` → 中间件栈（当前仅 OSC 处理器透传）→ `LocalSession.write` → `invoke('pty_write')` → master fd。

**输出（shell → 屏幕）**：
Rust 读线程 → `PtyDataQueue`（背压）→ `Channel<InvokeResponseBody::Raw>` 二进制 → `TauriPTYProxy`（无订阅者时先缓冲 pendingChunks）→ `LocalSession` ack + `emitOutput` → 中间件 → `BaseSession.initialDataBuffer`（attach 前暂存）→ `Frontend.write` 流控 → `xterm.write`。

**控制面**：resize/kill/exists 走 `invoke`；退出经事件 `pty:{id}:exit` / `pty:{id}:close` 通知前端销毁会话。

完整逐步调用链（含文件/函数级引用）见 [04-guides/key-flows](../04-guides/key-flows.md)。

## 关键设计决策

1. **移植而非重写**：会话/前端/中间件接口保持 Tabby 形状（`Frontend` 抽象类、`SessionMiddleware`、`BaseSession`），把 Angular DI 换成 `FrontendContext`（`src/lib/frontendContext.ts`），Electron IPC 换成 Tauri IPC。
2. **输出走二进制 Channel + ack 背压**：避免 JSON 序列化开销；Rust 在未确认字节超过 500KB 时暂停读 PTY，内核反压子进程（防 `yes` 灌爆内存）。见 `src-tauri/src/pty.rs`。
3. **首屏不丢字节**：两层缓冲——`TauriPTYProxy.pendingChunks`（订阅建立前）与 `BaseSession.initialDataBuffer`（xterm attach 前）。
4. **标签常驻**：所有标签用 `v-show` 切换（`src/App.vue`），后台 shell 继续运行，切回时 `reactivate()` 修复 WKWebView 掉 GPU 上下文的问题。
5. **主题双通道**：终端区由 `resolveColorScheme` → xterm `options.theme`；应用界面（标题栏/标签栏/设置页）由 `deriveChromeTokens` 生成 CSS 变量注入 `<html>`——Tabby 式"UI 跟随配色"。
6. **阻塞 IO 不上主线程**：`pty_spawn/pty_write/pty_kill` 为 async 命令（Tauri 线程池执行）；kill 用 `clone_killer()` 独立句柄，避免与清理线程的 `wait()` 互锁。

## Related

- [project-overview](project-overview.md)
- [02-frontend/sessions-and-middleware](../02-frontend/sessions-and-middleware.md)
- [03-backend/pty-lifecycle](../03-backend/pty-lifecycle.md)
- [04-guides/key-flows](../04-guides/key-flows.md)
