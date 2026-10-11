<details>
<summary>Relevant source files</summary>

- src-tauri/src/background.rs
- src-tauri/src/config/legacy.rs
- src-tauri/src/forward/loops.rs
- src-tauri/src/pty/mod.rs
- src-tauri/src/s3sync/signing.rs
- src-tauri/src/ssh/auth.rs
- src-tauri/src/transfers/mod.rs
- src/lib/frontends/xterm/keyboard.ts
- src/lib/frontends/xterm/renderer.ts
- src/lib/monitorOrchestrator.ts
- src/lib/sshConnectionRegistry.ts
- src/lib/suggestions/controller.ts
- src/services/workflowRunService.ts
- src/stores/monitor.ts
- src/stores/tabs.ts
</details>

## 关键概念：lib / services

本页汇总 `lib` 与 `services` 两层中承担跨模块协作职责的关键类型与函数。这些符号大多是"契约型"存在——接口定义边界（热键状态机、重连挂起态、运行控制块），方法则封装了 SSH 连接复用、监控采样升级、渲染器挂载、建议接受等有状态流程。理解它们有助于快速定位连接生命周期、终端渲染与自动化工作流的接入点。

### SSH 连接注册表

该组符号来自 SSH 连接注册表，负责按档案（profile）维度统一裁决连接的复用与登记：窗格会话优先复用且不占用消费者计数，headless 连接则需显式登记/释放消费者；同时对外暴露活跃连接集合，供转发事件按连接订阅。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| `acquire` | method | `(profileId: string, consumerId: string): Promise<string>` | 获取该档案的连接：窗格会话优先复用（不计数，生命周期归窗格）；否则复用/建立 headless 连接并登记消费者。与 `release` 对称使用，返回 `sshId` | `src/lib/sshConnectionRegistry.ts:97` |
| `allSshIds` | method | `(): string[]` | 当前全部活跃连接 id（窗格 + headless），用于按连接订阅转发事件 | `src/lib/sshConnectionRegistry.ts:226` |

### 监控编排器

监控编排器管理按档案维度的采样级别与重连挂起状态。本组的接口描述连接中断后的挂起态，方法则用于把某个档案升级到更细粒度的采样。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| `RetryState` | interface | — | 重连挂起态 | `src/lib/monitorOrchestrator.ts:31` |
| `bindDetail` | method | `(profileId: string): Promise<void>` | 绑定详情面板：升级为 full 级采样 | `src/lib/monitorOrchestrator.ts:118` |

### xterm 前端

xterm 前端封装终端渲染器与键盘热键两处与宿主服务的对接契约：渲染器按配置选择 WebGL/Canvas 后端并记录字体指纹，热键侧则通过一个结构兼容的接口对接热键状态机实现，避免前端直接依赖具体服务实现。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| `HotkeyTarget` | interface | — | 热键状态机接口（结构兼容 `services/hotkeys` 的 `HotkeysManager`（待确认）） | `src/lib/frontends/xterm/keyboard.ts:9` |
| `attach` | method | `(enableWebGL: boolean): void` | 按前端配置挂载初始渲染器（WebGL 优先，Canvas 兜底）并记录字体指纹 | `src/lib/frontends/xterm/renderer.ts:37` |

### 建议控制器

建议控制器负责补全建议的选中与接受流程，本组符号是其面向鼠标交互的接受入口。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| `acceptAt` | method | `(index: number, execute: boolean): void` | 鼠标点击菜单条目的接受入口：先把目标项设为选中再接受；`index` 越界时忽略；`execute` 决定是否补换行立即执行（`false` 只补全不执行） | `src/lib/suggestions/controller.ts:181` |

### 工作流运行服务

工作流运行服务承载自动化流程的执行与取消，本组符号是其运行期的内部控制块。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| `RunControl` | interface | — | 运行内部控制块，`cancelled` 标志由 `cancelWorkflowRun` 置位 | `src/services/workflowRunService.ts:43` |

## 关键概念：stores / forward / transfers / pty / config / ssh / s3sync / background.rs

以下按符号实际所属模块分组。每组先给一句整体职责，再列符号明细。

### stores（前端状态层）

这一组符号集中在 `src/stores/` 下的四个文件，分别覆盖标签与分组、监控样本缓存、界面配色变量下发、传输速度展示态。共同特征是"状态变更 + 派生展示"：速度跟踪态明确不入持久化（src/stores/transfers.ts:12），监控样本走环形缓冲、溢出丢最旧（src/stores/monitor.ts:69），主题变量按固定键集逐键覆盖以避免残留（src/stores/theme.ts:23）。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| activate | function | `(id: string)` | 激活标签并记录最近使用顺序；无效 id 被忽略，未知的最近使用引用会同步清理 | src/stores/tabs.ts:240 |
| assignTabToGroup | function | `(tabId: string, groupId: string | null)` | 设置标签归属分组；groupId 为 null 时清除归属，目标组不存在时忽略（防悬空） | src/stores/tabs.ts:258 |
| apply | function | `(profileId: string, sample: MonitorSample): void` | 应用一份样本：写最新值、追加环形缓冲（溢出丢最旧）、清除错误态 | src/stores/monitor.ts:69 |
| applyError | function | `(profileId: string, message: string): void` | 记录采集错误（原始文本；下次成功采样自动清除） | src/stores/monitor.ts:97 |
| applyUnsupported | function | `(profileId: string): void` | 标记平台不支持（终态哨兵，界面显示「仅支持 Linux」） | src/stores/monitor.ts:108 |
| applyChromeTokens | function | `(scheme: TerminalColorScheme): void` | 将配色派生的界面颜色变量写入 `<html>`；派生键集合恒定，切换配色时逐键覆盖，不会残留旧变量 | src/stores/theme.ts:23 |
| SpeedTracker | interface | 无（接口） | 每任务速度跟踪态（展示派生，不入持久化） | src/stores/transfers.ts:12 |

### forward（SSH 端口转发）

位于 `src-tauri/src/forward/loops.rs`，处理两类转发接入：本地转发与动态转发，两者都在拿到 TCP 连接后接管为 SSH channel 并做双向搬运。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| accept_local_connection | function | `(handle: Arc<ForwardHandle>, session: Arc<SshSession>, tcp: TcpStream, peer: SocketAddr)` | -L：每连接开 direct-tcpip channel 后双向搬运（单连接失败仅断该连接） | src-tauri/src/forward/loops.rs:95 |
| accept_dynamic_connection | function | `(handle: Arc<ForwardHandle>, session: Arc<SshSession>, tcp: TcpStream, _peer: SocketAddr)` | -D：SOCKS5 no-auth 握手 → CONNECT 目标接管为 direct-tcpip channel → 双向搬运 | src-tauri/src/forward/loops.rs:115 |

### transfers（传输任务）

位于 `src-tauri/src/transfers/mod.rs`，提供任务快照的"变更并广播"组合入口，以及从路径派生展示名的小工具。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| advance | function | `(app: &AppHandle, manager: &TransferManager, entry: &TransferEntry, mutate: impl FnOnce(&mut TransferSnapshot))` | 变更并广播（run_task 主路径用的组合便捷函数） | src-tauri/src/transfers/mod.rs:417 |
| base_name | function | `(path: &str) -> String` | 取路径最后一段，作为传输任务展示名 | src-tauri/src/transfers/mod.rs:150 |

### pty（伪终端会话）

位于 `src-tauri/src/pty/mod.rs`，本批数据中仅涉及会话命令构建阶段的环境变量处理。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| apply_macos_locale | function | `(cmd: &mut CommandBuilder)` | 为 macOS 会话补齐 locale 变量，做法对齐 Tabby（移植自 tabby-local/session.ts） | src-tauri/src/pty/mod.rs:259 |

### config（配置迁移）

位于 `src-tauri/src/config/legacy.rs`，处理旧格式配置的迁移收尾。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| archive_legacy_yaml_at | function | `(path: &Path) -> Result<bool, String>` | 把旧 config.yaml 改名为 config.yaml.migrated（迁移完成标记 + 天然备份）；文件不存在返回 false | src-tauri/src/config/legacy.rs:48 |

### ssh（认证）

位于 `src-tauri/src/ssh/auth.rs`，覆盖交互式认证链路：既包含向界面询问键盘交互应答的前端问答，也包含整体的认证编排。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| ask_frontend | function | `(app: &AppHandle, kbd_waiters: &KbdWaiters, id: &str, name: &str, instructions: &str, prompts: &[russh::client::Prompt]) -> KbdFrontendReply` | 向界面发起键盘交互问答，返回三类结果：用户应答 / 取消或通道关闭（连接断开）/ 超过等待上限 | src-tauri/src/ssh/auth.rs:178 |
| authenticate | function | `(handle: &mut client::Handle<ScxHandler>, secrets: &SecretsState, options: &SshConnectOptions, app: &AppHandle, kbd_waiters: &KbdWaiters) -> Result<(), String>` | 执行认证流程：`Ok(())` 认证成功，`Err` 为失败文本 | src-tauri/src/ssh/auth.rs:328 |

### s3sync（对象存储签名）

位于 `src-tauri/src/s3sync/signing.rs`，负责请求签名材料到请求头的组装。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| authorization_header | function | `(access_key: &str, scope: &str, signed_headers: &str, key: &[u8], string_to_sign: &str) -> String` | 组装 Authorization 头；从 access_key / scope / signed_headers / string_to_sign / key 这几个入参看，属于签名串与派生密钥的最终拼装步骤【推断】 | src-tauri/src/s3sync/signing.rs:82 |

### background.rs（背景图）

位于 `src-tauri/src/background.rs`，管住背景图的落盘位置、写入与读取。

| 名称 | 类型 | 签名 | 说明 | 所属文件 |
| --- | --- | --- | --- | --- |
| backgrounds_dir | function | `(app: &tauri::AppHandle) -> Option<PathBuf>` | backgrounds 目录（位于 app_data_dir 之下） | src-tauri/src/background.rs:15 |
| background_image_set_inner | function | `(dir: &Path, path: Option<String>) -> Result<Option<String>, String>` | 按 docstring 给出的示例，接收一个可选的源文件路径并返回落盘文件名（如 background.png）；据此推断为设置背景图并回报实际保存的文件名【推断】 | src-tauri/src/background.rs:47 |
| background_image_load_inner | function | `(dir: &Path) -> Option<Vec<u8>>` | 读取背景图内容：`Some(Vec<u8>)` 为图片内容；`None` 表示未设置或不可读 | src-tauri/src/background.rs:85 |

**待确认**：本批数据未给出 pty、config、s3sync、forward 四个模块的其余符号与相互调用关系，上述分组只能反映这些模块在本批数据中出现的部分。
## Related

- 同目录：[calls.md](calls.md) · [classes.md](classes.md)
- 互补职责：[calls.md](../07-reference/calls.md)
- 共享 3 个源文件、共享 10 个符号：[api.md](../03-interface/api.md)
- 共享 4 个源文件、共享 5 个符号：[constraints.md](../06-constraints/constraints.md)
- 共享 1 个源文件、共享 7 个符号：[topic:ci-keypress-cmd-t-double-open.md](../08-topics/ci-keypress-cmd-t-double-open.md)
- 总入口：[README](../README.md)

<!-- wiki:source: llm -->
