<details>
<summary>Relevant source files</summary>

- src-tauri/src/background.rs
- src-tauri/src/config/legacy.rs
- src-tauri/src/forward/loops.rs
- src-tauri/src/monitor/parse.rs
- src-tauri/src/pty/mod.rs
- src-tauri/src/s3sync/client.rs
- src-tauri/src/s3sync/signing.rs
- src-tauri/src/snapshot/mod.rs
- src-tauri/src/ssh/auth.rs
- src-tauri/src/transfers/mod.rs
- src-tauri/src/transfers/plan.rs
- src/lib/frontends/xterm/keyboard.ts
- src/lib/frontends/xterm/renderer.ts
- src/lib/monitorOrchestrator.ts
- src/lib/sshConnectionRegistry.ts
</details>

## 关键概念（第1批·lib/stores/forward）

本页列出本批数据中的关键类型与函数，按符号实际所属模块分组：`lib` 侧覆盖终端热键/渲染器抽象、SSH 连接注册表与监控编排、建议控制器；`stores` 侧覆盖传输速度派生、主题变量注入、监控状态写入与标签分组归属；`forward` 侧覆盖 Rust 端口转发（-L / -D）的连接接入循环。这些符号共同构成"前端运行时基础设施 → 状态仓库写入 → 后端转发循环"三层的可复用契约，是理解本批模块职责边界与调用契约的入口。所有条目的说明均取自源码 docstring。

### lib —— 前端运行时基础设施

该组符号分布在 `src/lib` 下的多个子系统：终端键盘的热键状态机接口、监控编排器的重连挂起态与详情采样升级、SSH 连接注册表的复用/登记入口，以及建议控制器的鼠标接受入口和渲染器的挂载入口。整体职责是为终端界面与连接层提供可注入的抽象与生命周期入口。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| HotkeyTarget | interface | — | 热键状态机接口（结构兼容 services/hotkeys 的 HotkeysManager） | `src/lib/frontends/xterm/keyboard.ts:9` |
| RetryState | interface | — | 重连挂起态 | `src/lib/monitorOrchestrator.ts:31` |
| attach | method | `(enableWebGL: boolean)` | 按前端配置挂载初始渲染器（WebGL 优先，Canvas 兜底）并记录字体指纹 | `src/lib/frontends/xterm/renderer.ts:37` |
| bindDetail | method | `(profileId: string)` | 绑定详情面板：升级为 full 级采样；返回 `Promise<void>` | `src/lib/monitorOrchestrator.ts:118` |
| acquire | method | `(profileId: string, consumerId: string)` | 获取该档案的连接：窗格会话优先复用（不计数，生命周期归窗格）；否则复用/建立 headless 连接并登记消费者；返回 `Promise<string>` sshId | `src/lib/sshConnectionRegistry.ts:97` |
| allSshIds | method | `()` | 当前全部活跃连接 id（窗格 + headless；转发事件按连接订阅用），返回 `string[]` | `src/lib/sshConnectionRegistry.ts:226` |
| acceptAt | method | `(index: number, execute: boolean)` | 鼠标点击菜单条目的接受入口：先把目标项设为选中再接受；`index` 越界时忽略；`execute=false` 时只补全不执行 | `src/lib/suggestions/controller.ts:179` |

### stores —— Pinia 状态仓库的写入与派生逻辑

该组符号位于 `src/stores`，职责集中在状态仓库的"写入口"与派生计算：传输任务的速度跟踪态与全量快照应用、主题配色派生变量写入 `<html>`、监控采集的错误/不支持终态写入，以及标签与分组的归属关系维护。命名上统一采用 `apply*` / `assign*` 的动词语义，便于识别其为状态变更入口而非查询接口。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| SpeedTracker | interface | — | 每任务速度跟踪态（展示派生，不入持久化） | `src/stores/transfers.ts:12` |
| apply | function | `(snapshots: TransferSnapshot[])` | 应用一份全量快照：更新速度跟踪（running 任务的相邻样本差值 + EMA） | `src/stores/transfers.ts:61` |
| applyChromeTokens | function | `(scheme: TerminalColorScheme)` | 将配色派生的界面颜色变量写入 `<html>`；派生键集合恒定，切换配色时逐键覆盖即可，不会残留旧配色变量 | `src/stores/theme.ts:23` |
| applyError | function | `(profileId: string, message: string)` | 记录采集错误（原始文本；下次成功采样自动清除） | `src/stores/monitor.ts:97` |
| applyUnsupported | function | `(profileId: string)` | 标记平台不支持（终态哨兵，UI 显示「仅支持 Linux」） | `src/stores/monitor.ts:108` |
| assignTabToGroup | function | `(tabId: string, groupId: string \| null)` | 设置标签归属分组；`groupId` 为 null 清除归属，组不存在时忽略（防悬空） | `src/stores/tabs.ts:242` |

### forward —— Rust 侧端口转发连接接入循环

该组符号位于 `src-tauri/src/forward/loops.rs`，负责本地监听套接字收到新 TCP 连接后的接入处理：`-L`（本地端口转发）与 `-D`（动态 SOCKS5）各有一条接入函数，均以 `Arc<ForwardHandle>` 与 `Arc<SshSession>` 为共享上下文，把本地 TCP 流与 SSH 侧 channel 对接为双向搬运。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| accept_local_connection | function | `(handle: std::sync::Arc<ForwardHandle>, session: std::sync::Arc<SshSession>, tcp: TcpStream, peer: std::net::SocketAddr)` | `-L`：每连接开 direct-tcpip channel 后双向搬运（单连接失败仅断该连接） | `src-tauri/src/forward/loops.rs:95` |
| accept_dynamic_connection | function | `(handle: std::sync::Arc<ForwardHandle>, session: std::sync::Arc<SshSession>, tcp: TcpStream, _peer: std::net::SocketAddr)` | `-D`：SOCKS5 no-auth 握手 → CONNECT 目标接管为 direct-tcpip channel → 双向搬运 | `src-tauri/src/forward/loops.rs:115` |

**待确认**：本批数据中未见 `lib` 侧 `sshConnectionRegistry`（`src/lib/sshConnectionRegistry.ts:97`）与 `src-tauri/src/forward/loops.rs` 之间的调用边或依赖使用证据，转发会话如何从注册表传递到 Rust 转发循环缺少直接佐证。

## 关键概念（第2批·transfers/pty/config/ssh/s3sync/background.rs/monitor/snapshot）

本节按符号实际所属模块分组，列出本批 8 个模块的关键函数。所有事实声明均带 `file:line` 锚点。

### transfers（传输任务）

该组符号承担文件传输任务的状态推进与传输计划构建：`base_name`/`advance` 位于 `transfers/mod.rs`，分别负责展示名提取与「变更并广播」的状态组合更新；`plan.rs` 中的两个 `build_*_plan` 负责按单文件或目录递归两种情形生成下载/上传计划。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
|---|---|---|---|---|
| advance | function | `(app: &AppHandle, manager: &TransferManager, entry: &TransferEntry, mutate: impl FnOnce(&mut TransferSnapshot))` | 变更并广播（run_task 主路径用的组合便捷函数） | src-tauri/src/transfers/mod.rs:289 |
| base_name | function | `(path: &str)` | 路径最后一段（传输任务展示名） | src-tauri/src/transfers/mod.rs:108 |
| build_download_plan | function | 见下方代码块 | 下载计划：单文件直传；目录递归 walk（远端侧收集，本地侧映射路径） | src-tauri/src/transfers/plan.rs:11 |
| build_upload_plan | function | `(local_root: &str, remote_root: &str)` | 上传计划：单文件直传；目录递归 walk（本地侧收集，远端侧映射路径） | src-tauri/src/transfers/plan.rs:71 |

```rust
// build_download_plan @ src-tauri/src/transfers/plan.rs:11
(
    sftp: &SftpSession,
    remote_root: &str,
    local_root: &str,
    entry: &TransferEntry,
)
```

### pty（伪终端会话）

该组仅一个符号，负责启动伪终端命令前对 macOS 下 locale 环境变量的处理。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
|---|---|---|---|---|
| apply_macos_locale | function | `(cmd: &mut CommandBuilder)` | locale variables, like Tabby does. (Ported from tabby-local/session.ts.) | src-tauri/src/pty/mod.rs:259 |

### config（配置迁移）

该组仅一个符号，属于 legacy 配置迁移逻辑，用于把旧版 `config.yaml` 改名归档作为迁移完成标记与备份。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
|---|---|---|---|---|
| archive_legacy_yaml_at | function | `(path: &Path)` | 把旧 config.yaml 改名为 config.yaml.migrated（迁移完成标记 + 天然备份）；文件不存在返回 false | src-tauri/src/config/legacy.rs:48 |

### ssh（SSH 认证）

该组符号均位于 `ssh/auth.rs`，处理 SSH 连接认证流程：`ask_frontend` 负责把键盘交互（keyboard-interactive）提示转发到前端并收集应答；`authenticate` 执行完整认证并返回结果与失败文本。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
|---|---|---|---|---|
| ask_frontend | function | 见下方代码块 | `Responses` 用户应答；`Cancelled` 取消或通道关闭（连接断开）；`TimedOut` 超过等待上限 | src-tauri/src/ssh/auth.rs:178 |
| authenticate | function | 见下方代码块 | `Ok(())` 认证成功；`Err` 失败文本 | src-tauri/src/ssh/auth.rs:328 |

```rust
// ask_frontend @ src-tauri/src/ssh/auth.rs:178
(
    app: &AppHandle,
    kbd_waiters: &KbdWaiters,
    id: &str,
    name: &str,
    instructions: &str,
    prompts: &[russh::client::Prompt],
)

// authenticate @ src-tauri/src/ssh/auth.rs:328
(
    handle: &mut client::Handle<ScxHandler>,
    secrets: &SecretsState,
    options: &SshConnectOptions,
    app: &AppHandle,
    kbd_waiters: &KbdWaiters,
)
```

### s3sync（S3 同步）

该组覆盖 S3 兼容对象的请求签名与目标地址构建：`build_target` 划分 path-style 与 virtual-host 两种寻址方式并计算签名要素；`authorization_header` 依据签名结果组装 `Authorization` 头。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
|---|---|---|---|---|
| build_target | function | `(config: &S3SyncConfig, key_path: &str)` | 计算目标 URL / 签名 host 头 / 规范路径与日期要素（path-style 与 virtual-host 二选一） | src-tauri/src/s3sync/client.rs:32 |
| authorization_header | function | 见下方代码块 | 组装 Authorization 头 | src-tauri/src/s3sync/signing.rs:82 |

```rust
// authorization_header @ src-tauri/src/s3sync/signing.rs:82
(
    access_key: &str,
    scope: &str,
    signed_headers: &str,
    key: &[u8],
    string_to_sign: &str,
)
```

### background.rs（背景图）

该组符号位于 `src-tauri/src/background.rs` 顶层，管理应用背景图的目录定位、设置与读取：`backgrounds_dir` 返回 `app_data_dir` 下的 backgrounds 目录，`background_image_set_inner` 负责写入背景图，`background_image_load_inner` 负责读回图片内容。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
|---|---|---|---|---|
| backgrounds_dir | function | `(app: &tauri::AppHandle)` | backgrounds 目录（app_data_dir 之下） | src-tauri/src/background.rs:15 |
| background_image_set_inner | function | `(dir: &Path, path: Option<String>)` | `background_image_set_inner(&dir, Some("/Users/x/pic.png".into())) // Ok(Some("background.png"))` | src-tauri/src/background.rs:47 |
| background_image_load_inner | function | `(dir: &Path)` | `Some(Vec<u8>)` 图片内容；`None` 未设置或不可读 | src-tauri/src/background.rs:85 |

### monitor（系统监控）

该组仅一个符号，位于 `monitor/parse.rs`，用于按开关项构建采集所用的命令。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
|---|---|---|---|---|
| build_command | function | `(with_low_freq: bool, with_os: bool)` | `let cmd = build_command(true, true);` | src-tauri/src/monitor/parse.rs:104 |

### snapshot（快照导出）

该组仅一个符号，构建包含密文段的快照并返回导出摘要。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
|---|---|---|---|---|
| build_snapshot | function | 见下方代码块 | (快照, 导出摘要)——摘要需在包裹前统计（密文段不可回推条数） | src-tauri/src/snapshot/mod.rs:40 |

```rust
// build_snapshot @ src-tauri/src/snapshot/mod.rs:40
(
    config: &ConfigState,
    secrets: &SecretsState,
    passphrase: &str,
    app_version: &str,
)
```
## Related

- 同目录：[calls.md](calls.md) · [classes.md](classes.md)
- 总入口：[README](../README.md)
