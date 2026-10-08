# 数据流（data-flow）

<details>
<summary>Relevant source files</summary>

- src-tauri/src/forward/mod.rs
- src-tauri/src/monitor/parse.rs
- src-tauri/src/pty/queue.rs
- src-tauri/src/transfers/mod.rs
- src-tauri/src/transfers/pump.rs
- src/lib/frontends/xterm/frontend.ts
- src/lib/frontends/xterm/keyboard.ts
- src/lib/frontends/xterm/renderer.ts
- src/lib/frontends/xterm/resize.ts
- src/lib/frontends/xterm/support.ts
- src/lib/sshConnectionRegistry.ts
- src/lib/utils/bytes.ts
- src/services/secrets.ts
- src/services/ssh.ts
- src/services/sshConnections.ts
</details>

本页基于执行序列数据（`sequences`）描述三条彼此独立的数据流：xterm 终端前端构造、SSH 无头连接的建立、Rust 侧传输泵（`copy_file`）的文件搬运链路。数据中未给出跨序列调用边，因此不假设三条流之间存在数据衔接。

## 核心数据流概览

**第一段（前端装配流）**：终端前端的构造过程（`constructor`，`src/lib/frontends/xterm/frontend.ts`）是一条"装配型"数据流。它并不搬运业务数据，而是把后续运行期所需的组件依次接好：先建立流控（`FlowControl`，`src/lib/frontends/xterm/support.ts:61`）与 UTF-8 编码工具（`encodeUTF8`，`src/lib/utils/bytes.ts:50`），再绑定选区读取/复制（`getSelection`，`src/lib/frontends/xterm/frontend.ts:271`；`copySelection`，`src/lib/frontends/xterm/frontend.ts:275`），随后装配键盘链路（`createKeyboardEventHandler`，`src/lib/frontends/xterm/keyboard.ts:28`；`createKeyGate`，`src/lib/frontends/xterm/keyboard.ts:82`）、尺寸调度（`ResizeScheduler`，`src/lib/frontends/xterm/resize.ts:13`）、attach 状态判定（`isAttachActive`，`src/lib/frontends/xterm/frontend.ts:51`）与渲染器管理（`XtermRendererManager`，`src/lib/frontends/xterm/renderer.ts:26`）。

**第二段（SSH 连接建立流）**：`connectHeadless`（`src/services/sshConnections.ts`）串联了"配置 → 连接 → 状态登记 → 镜像/凭据"的处理链：先取配置（`useConfigStore`，`src/stores/config/store.ts:23`），再创建 SSH 代理（`SshProxy`，`src/services/ssh.ts:57`），并把连接状态登记进注册表（`noteHeadlessDead`，`src/lib/sshConnectionRegistry.ts:165`）；同时触发镜像刷新（`refreshMirror`，`src/services/sshConnections.ts:152`）、键盘交互等待位（`pendingKbdResolver`，`src/services/sshConnections.ts:33`）与档案密码写入（`setProfilePassword`，`src/services/secrets.ts:126`）。

**第三段（Rust 传输泵流）**：`copy_file`（`src-tauri/src/transfers/pump.rs`）是唯一带有明确"状态推进"语义的流：以传输记录的状态构造为起点（`new`，`src-tauri/src/transfers/mod.rs:117），经由监控数据解析（`load`，`src-tauri/src/monitor/parse.rs:55）拿到进度信息，再通过 `advance`（`src-tauri/src/transfers/mod.rs:289`）驱动内部状态变更（`mutate`，`src-tauri/src/transfers/mod.rs:173`）并向外部广播事件（`emit_all`，`src-tauri/src/transfers/mod.rs:282`，其数据来自快照 `snapshots`，`src-tauri/src/transfers/mod.rs:190`）；收尾阶段做队列刷写（`flush`，`src-tauri/src/pty/queue.rs:50`）与转发关闭（`shutdown`，`src-tauri/src/forward/mod.rs:156`）。

> 说明：`sequences` 数据只包含调用边（调用方、被调用方、`file:line`），不包含参数/返回值类型信息。因此下方各阶段表的"输入类型""输出类型"列统一标注为「未提供」，不做推断。

## 数据阶段表

### 一、前端装配流：`constructor`

| 阶段 | 输入类型 | 输出类型 | 关键函数 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| S1 流控组件建立 | 未提供 | 未提供 | `FlowControl`（构造） | src/lib/frontends/xterm/support.ts:61 |
| S2 UTF-8 编码工具接入 | 未提供 | 未提供 | `encodeUTF8` | src/lib/utils/bytes.ts:50 |
| S3 选区读取绑定 | 未提供 | 未提供 | `getSelection` | src/lib/frontends/xterm/frontend.ts:271 |
| S4 选区复制绑定 | 未提供 | 未提供 | `copySelection` | src/lib/frontends/xterm/frontend.ts:275 |
| S5 键盘事件处理器装配 | 未提供 | 未提供 | `createKeyboardEventHandler` | src/lib/frontends/xterm/keyboard.ts:28 |
| S6 按键闸门装配 | 未提供 | 未提供 | `createKeyGate` | src/lib/frontends/xterm/keyboard.ts:82 |
| S7 IME 文本键判定（闸门内部） | 未提供 | 未提供 | `isIMETextKey` | src/lib/frontends/xterm/support.ts:35 |
| S8 键盘链路中的编码调用 | 未提供 | 未提供 | `encodeUTF8` | src/lib/utils/bytes.ts:50 |
| S9 尺寸调度器装配 | 未提供 | 未提供 | `ResizeScheduler`（构造） | src/lib/frontends/xterm/resize.ts:13 |
| S10 attach 活跃状态判定 | 未提供 | 未提供 | `isAttachActive` | src/lib/frontends/xterm/frontend.ts:51 |
| S11 渲染器管理器装配 | 未提供 | 未提供 | `XtermRendererManager`（构造） | src/lib/frontends/xterm/renderer.ts:26 |

阶段间数据传递的链路特征：S5 装配出的键盘处理器内部会走 S8 的编码路径（`createKeyboardEventHandler` → `encodeUTF8`，`src/lib/utils/bytes.ts:50`）；S6 装配出的按键闸门内部会走 S7 的 IME 判定（`createKeyGate` → `isIMETextKey`，`src/lib/frontends/xterm/support.ts:35`）；S4 的复制动作在调用点上直连 S3 的选区读取（`copySelection` → `getSelection`，`src/lib/frontends/xterm/frontend.ts:271`）。

### 二、SSH 连接建立流：`connectHeadless`

| 阶段 | 输入类型 | 输出类型 | 关键函数 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| S1 读取配置 | 未提供 | 未提供 | `useConfigStore` | src/stores/config/store.ts:23 |
| S2 创建 SSH 代理 | 未提供 | 未提供 | `SshProxy` | src/services/ssh.ts:57 |
| S3 连接失效登记 | 未提供 | 未提供 | `noteHeadlessDead` | src/lib/sshConnectionRegistry.ts:165 |
| S4 镜像刷新 | 未提供 | 未提供 | `refreshMirror` | src/services/sshConnections.ts:152 |
| S5 键盘交互等待位 | 未提供 | 未提供 | `pendingKbdResolver` | src/services/sshConnections.ts:33 |
| S6 档案密码写入 | 未提供 | 未提供 | `setProfilePassword` | src/services/secrets.ts:126 |

### 三、传输泵流：`copy_file`

| 阶段 | 输入类型 | 输出类型 | 关键函数 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| S1 新建传输记录状态 | 未提供 | 未提供 | `new` | src-tauri/src/transfers/mod.rs:117 |
| S2 监控数据解析 | 未提供 | 未提供 | `load` | src-tauri/src/monitor/parse.rs:55 |
| S3 传输推进 | 未提供 | 未提供 | `advance` | src-tauri/src/transfers/mod.rs:289 |
| S4 状态变更（S3 内部） | 未提供 | 未提供 | `mutate` | src-tauri/src/transfers/mod.rs:173 |
| S5 事件广播（S3 内部） | 未提供 | 未提供 | `emit_all` | src-tauri/src/transfers/mod.rs:282 |
| S6 快照读取（S5 内部） | 未提供 | 未提供 | `snapshots` | src-tauri/src/transfers/mod.rs:190 |
| S7 队列刷写 | 未提供 | 未提供 | `flush` | src-tauri/src/pty/queue.rs:50 |
| S8 转发关闭 | 未提供 | 未提供 | `shutdown` | src-tauri/src/forward/mod.rs:156 |

## 调用边表（调用方 → 被调用方）

> 调用关系以本表为准，不使用时序图表达。更完整的调用关系见 `calls.md`。

### 前端装配流（`constructor`，src/lib/frontends/xterm/frontend.ts）

| 调用方 | 被调用方 | 锚点 |
| --- | --- | --- |
| `constructor` | `FlowControl` | src/lib/frontends/xterm/support.ts:61 |
| `constructor` | `encodeUTF8` | src/lib/utils/bytes.ts:50 |
| `constructor` | `getSelection` | src/lib/frontends/xterm/frontend.ts:271 |
| `constructor` | `copySelection` | src/lib/frontends/xterm/frontend.ts:275 |
| `constructor` | `createKeyboardEventHandler` | src/lib/frontends/xterm/keyboard.ts:28 |
| `constructor` | `createKeyGate` | src/lib/frontends/xterm/keyboard.ts:82 |
| `constructor` | `ResizeScheduler` | src/lib/frontends/xterm/resize.ts:13 |
| `constructor` | `isAttachActive` | src/lib/frontends/xterm/frontend.ts:51 |
| `constructor` | `XtermRendererManager` | src/lib/frontends/xterm/renderer.ts:26 |
| `copySelection` | `getSelection` | src/lib/frontends/xterm/frontend.ts:271 |
| `createKeyGate` | `isIMETextKey` | src/lib/frontends/xterm/support.ts:35 |
| `createKeyboardEventHandler` | `encodeUTF8` | src/lib/utils/bytes.ts:50 |

### SSH 连接建立流（`connectHeadless`，src/services/sshConnections.ts）

| 调用方 | 被调用方 | 锚点 |
| --- | --- | --- |
| `connectHeadless` | `useConfigStore` | src/stores/config/store.ts:23 |
| `connectHeadless` | `SshProxy` | src/services/ssh.ts:57 |
| `connectHeadless` | `noteHeadlessDead` | src/lib/sshConnectionRegistry.ts:165 |
| `connectHeadless` | `refreshMirror` | src/services/sshConnections.ts:152 |
| `connectHeadless` | `pendingKbdResolver` | src/services/sshConnections.ts:33 |
| `connectHeadless` | `setProfilePassword` | src/services/secrets.ts:126 |

### 传输泵流（`copy_file`，src-tauri/src/transfers/pump.rs）

| 调用方 | 被调用方 | 锚点 |
| --- | --- | --- |
| `copy_file` | `new` | src-tauri/src/transfers/mod.rs:117 |
| `copy_file` | `load` | src-tauri/src/monitor/parse.rs:55 |
| `copy_file` | `advance` | src-tauri/src/transfers/mod.rs:289 |
| `copy_file` | `flush` | src-tauri/src/pty/queue.rs:50 |
| `copy_file` | `shutdown` | src-tauri/src/forward/mod.rs:156 |
| `advance` | `mutate` | src-tauri/src/transfers/mod.rs:173 |
| `advance` | `emit_all` | src-tauri/src/transfers/mod.rs:282 |
| `emit_all` | `snapshots` | src-tauri/src/transfers/mod.rs:190 |

## 错误路径

以下调用边**不属于主成功流程**，单独列出：

| 触发方 | 错误路径调用 | 锚点 | 数据可确认的程度 |
| --- | --- | --- | --- |
| `copy_file` | `failed`（失败态构造，`src-tauri/src/transfers/mod.rs`） | src-tauri/src/transfers/mod.rs:112 | 仅可确认存在该调用边与函数名；具体触发条件、返回/中断行为数据未提供 → 待确认 |

除 `failed`（src-tauri/src/transfers/mod.rs:112）外，`sequences` 中未给出其他以错误处理命名的调用边；`connectHeadless` 中的 `noteHeadlessDead`（src/lib/sshConnectionRegistry.ts:165）虽与"连接失效"语义相关，但数据中它是 `connectHeadless` 的直接调用边，归属分支（成功/失败）无法从数据判定 → 待确认。

## 待确认

1. **三条序列之间的数据衔接**：数据中未给出任何跨序列调用边（`constructor`、`connectHeadless`、`copy_file` 分属前端/服务层/Rust 侧），三者是否存在上下游数据传递缺证据。
2. **各阶段的输入/输出类型**：`sequences` 不含参数与返回类型，阶段表的类型列全部为「未提供」。
3. **`failed`（src-tauri/src/transfers/mod.rs:112）的触发条件**：仅知调用边存在，何时走该错误路径缺证据。
4. **`pendingKbdResolver`（src/services/sshConnections.ts:33）与 `refreshMirror`（src/services/sshConnections.ts:152）的触发时机**：是连接建立即触发还是异步回调，数据未提供。
## Related

- 同目录：[architecture.md](architecture.md) · [modules.md](modules.md)
- 总入口：[README](../README.md)
