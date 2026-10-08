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
- src/lib/frontends/xterm/search.ts
- src/lib/monitorOrchestrator.ts
- src/lib/sshConnectionRegistry.ts
</details>

## 关键概念（第1批·lib/stores）

本节收录 `lib/` 与 `stores/` 两个模块下的关键类型与函数。它们构成了前端侧的状态与能力契约：`lib/` 下的符号偏「能力接口与协调器」（终端前端附加器、监控编排、SSH 连接注册、建议菜单控制），`stores/` 下的符号偏「响应式状态写入口」（标签、传输、主题、监控）。理解这些符号的签名与写入语义，是理解 UI 状态从何处产生、由谁修改的前提。

### lib/frontends/xterm —— 终端前端接口与附加器

该组符号定义终端渲染层的两个挂载点：键盘侧的热键状态机接口（结构兼容 `services/hotkeys` 的 `HotkeysManager`（待确认）），以及搜索附加器的挂载入口。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| HotkeyTarget | interface | — | 热键状态机接口（结构兼容 services/hotkeys 的 HotkeysManager） | src/lib/frontends/xterm/keyboard.ts:9 |
| attach | method | `(xterm: Terminal)` | 挂载搜索附加器并订阅结果计数（attach 阶段调用一次） | src/lib/frontends/xterm/search.ts:14 |

### lib/monitorOrchestrator —— 监控采样编排

该组符号是监控采样的编排入口：`RetryState` 描述重连挂起态，`bindDetail` 在绑定详情面板时把采样级别提升为 full。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| RetryState | interface | — | 重连挂起态 | src/lib/monitorOrchestrator.ts:31 |
| bindDetail | method | `(profileId: string)` | 绑定详情面板：升级为 full 级采样；示例 `await orchestrator.bindDetail('p1')` | src/lib/monitorOrchestrator.ts:118 |

### lib/suggestions —— 建议菜单控制

该组符号承担建议菜单条目的接受入口，负责把点击目标项设为选中后再执行接受动作。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| acceptAt | method | `(index: number, execute: boolean)` | 鼠标点击菜单条目的接受入口：先把目标项设为选中再接受；`index` 越界时忽略；`execute` 为 false 时只补全不执行；示例 `acceptAt(2, false)` = 点击第 3 项补全不执行 | src/lib/suggestions/controller.ts:179 |

### lib/sshConnectionRegistry —— SSH 连接注册表

该组符号管理 SSH 连接的生命周期与消费者登记：按档案获取连接（窗格会话优先复用，否则建立/复用 headless 连接），并提供当前全部活跃连接 id 的枚举，用于按连接订阅转发事件。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| acquire | method | `(profileId: string, consumerId: string)` | 获取该档案的连接：窗格会话优先复用（不计数，生命周期归窗格）；否则复用/建立 headless 连接并登记消费者；返回 `Promise<string>` sshId；`consumerId`（SFTP 标签/隧道）与 release 对称使用 | src/lib/sshConnectionRegistry.ts:97 |
| allSshIds | method | `()` | 当前全部活跃连接 id（窗格 + headless；转发事件按连接订阅用）；返回 `string[]`；示例 `for (const id of registry.allSshIds()) { subscribe(id) }` | src/lib/sshConnectionRegistry.ts:226 |

### stores/transfers —— 传输任务状态

该组符号处理传输任务的展示态：`SpeedTracker` 保存每任务速度跟踪态（展示派生，不入持久化），`apply` 接收 Rust 推送的全量快照并更新速度跟踪。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| SpeedTracker | interface | — | 每任务速度跟踪态（展示派生，不入持久化） | src/stores/transfers.ts:12 |
| apply | function | `(snapshots: TransferSnapshot[])` | 应用一份全量快照：更新速度跟踪（running 任务的相邻样本差值 + EMA）；入参为 Rust 推送的任务快照数组 | src/stores/transfers.ts:61 |

### stores/tabs —— 标签与分组状态

该组符号维护标签的激活顺序与分组归属：激活时记录 MRU（最近使用）顺序，分组归属支持置空清除。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| activate | function | `(id: string)` | 激活标签并记录最近使用顺序；无效 id 被忽略，未知 MRU 引用会同步清理；示例 `activate('tab-1')` | src/stores/tabs.ts:240 |
| assignTabToGroup | function | `(tabId: string, groupId: string \| null)` | 设置标签归属分组；`groupId` 为 null 清除归属，组不存在时忽略（防悬空）；示例 `assignTabToGroup('tab-1', 'g1')` | src/stores/tabs.ts:258 |

### stores/theme —— 主题变量派生

该组符号把配色派生的界面颜色变量写入 DOM 根节点，是配色方案生效到界面外壳的通道。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| applyChromeTokens | function | `(scheme: TerminalColorScheme)` | 将配色派生的界面颜色变量写入 `<html>`；派生键集合恒定，切换配色时逐键覆盖即可，不会残留旧配色变量 | src/stores/theme.ts:23 |

### stores/monitor —— 监控状态写入口

该组符号提供监控状态的两个写入分支：记录采集错误文本（下次成功采样自动清除），以及标记平台不支持这一终态哨兵。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| applyError | function | `(profileId: string, message: string)` | 记录采集错误（原始文本；下次成功采样自动清除）；示例 `store.applyError('ssh-1', 'timeout')` | src/stores/monitor.ts:97 |
| applyUnsupported | function | `(profileId: string)` | 标记平台不支持（终态哨兵，UI 显示「仅支持 Linux」）；示例 `store.applyUnsupported('ssh-1')` | src/stores/monitor.ts:108 |

### 待确认

- `HotkeyTarget` 与 `RetryState` 的字段构成：数据仅给出接口名称与用途注释，未提供成员列表，无法说明其具体结构。

## 关键概念（第2批·forward/transfers/pty/config/ssh/s3sync/background.rs/monitor/snapshot）

本节收录 9 个模块/文件中的 16 个符号，按所属模块分组；每组给出该组符号的整体职责，逐符号列出类型、签名与语义。

### forward（端口转发连接处理）

本组是端口转发接受连接后的两条处理路径：`-L` 本地转发与 `-D` 动态（SOCKS5）转发，均位于 `src-tauri/src/forward/loops.rs`，负责把本地 TCP 连接接管为 SSH channel 并双向搬运数据。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| `accept_dynamic_connection` | function | `(handle: std::sync::Arc<ForwardHandle>, session: std::sync::Arc<SshSession>, tcp: TcpStream, _peer: std::net::SocketAddr)` | `-D`：SOCKS5 no-auth 握手 → CONNECT 目标接管为 direct-tcpip channel → 双向搬运（环形复杂度 13） | `src-tauri/src/forward/loops.rs:115` |
| `accept_local_connection` | function | `(handle: std::sync::Arc<ForwardHandle>, session: std::sync::Arc<SshSession>, tcp: TcpStream, peer: std::net::SocketAddr)` | `-L`：每连接开 direct-tcpip channel 后双向搬运（单连接失败仅断该连接） | `src-tauri/src/forward/loops.rs:95` |

### transfers（文件传输任务）

本组覆盖传输任务的三类职责：路径展示名提取（`base_name`）、状态变更并广播（`advance`）、下载计划构建（`build_download_plan`）。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| `base_name` | function | `(path: &str)` | 路径最后一段（传输任务展示名） | `src-tauri/src/transfers/mod.rs:108` |
| `advance` | function | `(app: &AppHandle, manager: &TransferManager, entry: &TransferEntry, mutate: impl FnOnce(&mut TransferSnapshot))` | 变更并广播（`run_task` 主路径用的组合便捷函数） | `src-tauri/src/transfers/mod.rs:289` |
| `build_download_plan` | function | `(sftp: &SftpSession, remote_root: &str, local_root: &str, entry: &TransferEntry)` | 下载计划：单文件直传；目录递归 walk（远端侧收集，本地侧映射路径） | `src-tauri/src/transfers/plan.rs:11` |

### pty（本地终端会话）

本组仅一个符号，负责为本地 PTY 启动的命令补齐 macOS 上的 locale 相关环境变量。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| `apply_macos_locale` | function | `(cmd: &mut CommandBuilder)` | 设置 locale 变量，做法同 Tabby（自 `tabby-local/session.ts` 移植而来） | `src-tauri/src/pty/mod.rs:259` |

### config（配置迁移）

本组仅一个符号，承担旧版 YAML 配置向新配置体系迁移时的归档动作。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| `archive_legacy_yaml_at` | function | `(path: &Path)` | 把旧 `config.yaml` 改名为 `config.yaml.migrated`（迁移完成标记 + 天然备份）；文件不存在返回 `false` | `src-tauri/src/config/legacy.rs:48` |

### ssh（认证流程）

本组是 SSH 认证链上的两个环节：`ask_frontend` 处理键盘交互式认证的问答往返，`authenticate` 是整体认证入口。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| `ask_frontend` | function | `(app: &AppHandle, kbd_waiters: &KbdWaiters, id: &str, name: &str, instructions: &str, prompts: &[russh::client::Prompt])` | 返回 `Responses` 表示用户应答；`Cancelled` 表示取消或通道关闭（连接断开）；`TimedOut` 表示超过等待上限 | `src-tauri/src/ssh/auth.rs:178` |
| `authenticate` | function | `(handle: &mut client::Handle<ScxHandler>, secrets: &SecretsState, options: &SshConnectOptions, app: &AppHandle, kbd_waiters: &KbdWaiters)` | `Ok(())` 认证成功；`Err` 为失败文本（环形复杂度 16） | `src-tauri/src/ssh/auth.rs:328` |

### s3sync（S3 兼容对象存储同步）

本组是 S3 请求构造与 SigV4 签名的两个环节：先由 `build_target` 计算目标地址与规范化要素，再由 `authorization_header` 组装签名头。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| `build_target` | function | `(config: &S3SyncConfig, key_path: &str)` | 计算目标 URL / 签名 host 头 / 规范路径与日期要素（path-style 与 virtual-host 二选一） | `src-tauri/src/s3sync/client.rs:32` |
| `authorization_header` | function | `(access_key: &str, scope: &str, signed_headers: &str, key: &[u8], string_to_sign: &str)` | 组装 `Authorization`（待确认） 头 | `src-tauri/src/s3sync/signing.rs:82` |

### background.rs（背景图存取）

本组负责应用背景图的文件级管理：定位 `backgrounds` 目录、设置背景图（写入）、读取背景图字节。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| `backgrounds_dir` | function | `(app: &tauri::AppHandle)` | `backgrounds` 目录（位于 `app_data_dir` 之下） | `src-tauri/src/background.rs:15` |
| `background_image_set_inner` | function | `(dir: &Path, path: Option<String>)` | 设置背景图；docstring 给出用例 `background_image_set_inner(&dir, Some("/Users/x/pic.png".into())) // Ok(Some("background.png"))`，即返回落盘后的文件名 | `src-tauri/src/background.rs:47` |
| `background_image_load_inner` | function | `(dir: &Path)` | 返回 `Some(Vec<u8>)` 为图片内容；`None` 表示未设置或不可读 | `src-tauri/src/background.rs:85` |

### monitor（远程监控采集）

本组符号用于按需拼装远端信息采集命令。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| `build_command` | function | `(with_low_freq: bool, with_os: bool)` | docstring 仅给出调用示例 `let cmd = build_command(true, true);`，未描述语义；**推断**：按模块 `monitor` 与两个布尔开关（`with_low_freq`、`with_os`）判断，用于按采集层级拼装系统信息命令（推断依据：符号名 `build_command` 与布尔开关参数命名） | `src-tauri/src/monitor/parse.rs:104` |

### snapshot（配置快照）

本组仅一个符号，负责把配置与密钥打包为可导出快照。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| `build_snapshot` | function | `(config: &ConfigState, secrets: &SecretsState, passphrase: &str, app_version: &str)` | 返回 `(快照, 导出摘要)`——摘要需在包裹前统计（密文段不可回推条数） | `src-tauri/src/snapshot/mod.rs:40` |

**待确认**：本节数据仅含符号级信息（名称、类型、签名、docstring、圈复杂度），未包含调用边；因此 `authenticate` 与 `ask_frontend`、`build_target` 与 `authorization_header` 之间的实际调用关系无法在本节给出，需以调用边数据补充。
## Related

- 同目录：[calls.md](calls.md) · [classes.md](classes.md)
- 互补职责：[calls.md](../07-reference/calls.md)
- 共享 3 个源文件、共享 9 个符号：[api.md](../03-interface/api.md)
- 共享 5 个源文件、共享 2 个符号：[constraints.md](../06-constraints/constraints.md)
- 共享 2 个源文件、共享 1 个符号：[overview.md](../01-overview/overview.md)
- 总入口：[README](../README.md)
