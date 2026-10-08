# API 参考

<details>
<summary>Relevant source files</summary>

- src-tauri/src/background.rs
- src-tauri/src/config/groups.rs
- src-tauri/src/config/legacy.rs
- src-tauri/src/config/load.rs
- src-tauri/src/config/mod.rs
- src-tauri/src/config/profiles.rs
- src-tauri/src/config/quick_commands.rs
- src-tauri/src/config/settings.rs
- src-tauri/src/fonts.rs
- src-tauri/src/forward/loops.rs
- src-tauri/src/forward/mod.rs
- src-tauri/src/fsutil.rs
- src-tauri/src/history.rs
- src-tauri/src/lib.rs
- src-tauri/src/monitor/mod.rs
</details>

本页基于源码扫描数据，梳理该 Tauri 桌面应用的对外接口面：**Tauri IPC 命令（主体）**、**IPC 事件**、**导出函数**，以及扫描中未检出的类别（CLI 命令、框架节点）。前端通过 `src/services/*.ts` 与 `src/stores/` 下的薄封装层调用 Rust 侧 `#[tauri::command]`，形成「Vue 组件/Store → 前端服务函数 → IPC 命令 → Rust 模块」的固定链路；Rust 侧按领域拆分为 `config`、`ssh`、`sftp`、`pty`、`forward`、`monitor`、`transfers`、`secrets`、`snapshot`、`s3sync` 等模块，每个模块内的命令定义位置与前端调用点是本页的主要事实来源。

交互方式上，绝大多数命令是**请求-响应式**（前端服务函数调用后 await 结果），另有少量**事件推送式**通道（如 `sftp-transfers-changed`、`monitor-*`）用于 Rust 侧向前端主动通知状态变化。命令的前端调用点高度集中：设置类写操作几乎全部经过 `src/stores/config/flush.ts` 统一落盘，会话/终端类操作分布在 `src/services/*.ts`。

---

## Tauri IPC 命令

下表是全部命令的三个维度对照：命令名、前端调用点（`invoke` 所在位置）、Rust 定义位置、以及两侧匹配状态。**状态列为「仅 Rust 侧定义」的条目说明该命令没有被前端检出调用**，这是两侧不匹配的重要事实，不做省略。

### 应用信息与调试

设置页「关于」需要展示配置目录、日志目录等本机路径，主入口需要在启动阶段输出日志并控制调试开关，因此这一组命令服务于应用元信息查询与调试通道。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `config_dir_path` | `src/components/settings/pages/AboutPage.vue:26` | `src-tauri/src/config/mod.rs:37` | 前端 ↔ Rust 均检出 |
| `debug_log_dir` | `src/components/settings/pages/AboutPage.vue:29` | `src-tauri/src/lib.rs:64` | 前端 ↔ Rust 均检出 |
| `dev_log` | `src/components/settings/pages/AboutPage.vue:46`、`src/components/settings/pages/AboutPage.vue:66`、`src/main.ts:22`、`src/main.ts:25`、`src/main.ts:28` | `src-tauri/src/lib.rs:29` | 前端 ↔ Rust 均检出 |
| `debug_set_enabled` | `src/main.ts:38` | `src-tauri/src/lib.rs:41` | 前端 ↔ Rust 均检出 |
| `debug_open_devtools` | `src/main.ts:39` | `src-tauri/src/lib.rs:52` | 前端 ↔ Rust 均检出 |

**典型调用形态**：应用启动阶段集中在 `src/main.ts`（22/25/28 行连续调用 `dev_log`，38/39 行调用调试开关与 DevTools 打开）；「关于」页加载时调用 `config_dir_path`（26 行）与 `debug_log_dir`（29 行）取路径，页面内再以 `dev_log`（46、66 行）输出信息。

### 外观与背景

外观设置页需要选择背景图并即时预览，因此拆为「写入设置（set）」与「读取图片内容（load）」两条命令，写操作与读取操作分离。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `background_image_set` | `src/components/settings/pages/AppearancePage.vue:54`、`src/components/settings/pages/AppearancePage.vue:71` | `src-tauri/src/background.rs:116` | 前端 ↔ Rust 均检出 |
| `background_image_load` | `src/services/backgroundImage.ts:63` | `src-tauri/src/background.rs:140` | 前端 ↔ Rust 均检出 |

**典型调用形态**：`AppearancePage.vue` 有两处设置调用点（54、71 行），对应页面上两个不同的触发位置；加载侧统一收敛到服务层 `src/services/backgroundImage.ts:63`，供 UI 获取背景图数据。

### 配置备份与 S3 同步

配置的可迁移性是这一组命令的目标：本地备份走 `snapshot` 模块的导出/导入，远端同步走 `s3sync` 模块的读写、连通性测试、状态查询、推送、远端列表与拉取。S3 相关命令全部经由 `src/services/configSync.ts` 单一服务文件，形成清晰的边界。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `config_export` | `src/services/configBackup.ts:24` | `src-tauri/src/snapshot/mod.rs:138` | 前端 ↔ Rust 均检出 |
| `config_import` | `src/services/configBackup.ts:37` | `src-tauri/src/snapshot/mod.rs:161` | 前端 ↔ Rust 均检出 |
| `s3_sync_get` | `src/services/configSync.ts:56` | `src-tauri/src/s3sync/mod.rs:138` | 前端 ↔ Rust 均检出 |
| `s3_sync_set` | `src/services/configSync.ts:68` | `src-tauri/src/s3sync/mod.rs:155` | 前端 ↔ Rust 均检出 |
| `s3_sync_clear` | `src/services/configSync.ts:79` | `src-tauri/src/s3sync/mod.rs:165` | 前端 ↔ Rust 均检出 |
| `s3_sync_test` | `src/services/configSync.ts:91` | `src-tauri/src/s3sync/mod.rs:175` | 前端 ↔ Rust 均检出 |
| `s3_sync_status` | `src/services/configSync.ts:102` | `src-tauri/src/s3sync/mod.rs:217` | 前端 ↔ Rust 均检出 |
| `s3_sync_push` | `src/services/configSync.ts:114` | `src-tauri/src/s3sync/mod.rs:185` | 前端 ↔ Rust 均检出 |
| `s3_sync_list_remote` | `src/services/configSync.ts:125` | `src-tauri/src/s3sync/mod.rs:236` | 前端 ↔ Rust 均检出 |
| `s3_sync_pull` | `src/services/configSync.ts:138` | `src-tauri/src/s3sync/mod.rs:247` | 前端 ↔ Rust 均检出 |

**典型调用形态**：配置同步流程呈现清晰的先后顺序——读取当前同步配置（`s3_sync_get`，56 行）→ 修改后写回（`s3_sync_set`，68 行）→ 连通性验证（`s3_sync_test`，91 行）→ 查看状态（`s3_sync_status`，102 行）→ 上传（`s3_sync_push`，114 行）或列出远端快照（`s3_sync_list_remote`，125 行）→ 拉取（`s3_sync_pull`，138 行）；`s3_sync_clear`（79 行）用于清空同步配置。

### 字体与 Shell 探测

这两条命令都属于「枚举本机环境能力」，供设置页下拉框填充候选项。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `list_fonts` | `src/services/fonts.ts:15` | `src-tauri/src/fonts.rs:5` | 前端 ↔ Rust 均检出 |
| `list_shells` | `src/services/shells.ts:12` | `src-tauri/src/shells.rs:25` | 前端 ↔ Rust 均检出 |

### 端口转发

转发功能以「启动 → 查询 → 停止」为生命周期，`forward_list` 与 `forward_list_all` 分别提供当前实例与全量视图，便于 UI 同时展示进行中与历史/全部转发项。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `forward_start` | `src/services/forward.ts:21` | `src-tauri/src/forward/mod.rs:317` | 前端 ↔ Rust 均检出 |
| `forward_stop` | `src/services/forward.ts:33` | `src-tauri/src/forward/mod.rs:431` | 前端 ↔ Rust 均检出 |
| `forward_list` | `src/services/forward.ts:45` | `src-tauri/src/forward/mod.rs:461` | 前端 ↔ Rust 均检出 |
| `forward_list_all` | `src/services/forward.ts:56` | `src-tauri/src/forward/mod.rs:479` | 前端 ↔ Rust 均检出 |

**典型调用形态**：`src/services/forward.ts` 按 21→33→45→56 的行序封装了启动、停止、列表、全量列表四个操作，UI 侧按需调用；所有权集中在 `src-tauri/src/forward/mod.rs`（317/431/461/479）。

### 历史记录

历史记录模块承担记录、清空、导入与读取文本文件的能力，其中 `fs_read_text_file` 虽定义在 `fsutil` 模块，但被历史记录服务调用，用于导入前读取本地文件内容。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `history_record` | `src/services/history.ts:69` | `src-tauri/src/history.rs:67` | 前端 ↔ Rust 均检出 |
| `history_clear` | `src/services/history.ts:78` | `src-tauri/src/history.rs:151` | 前端 ↔ Rust 均检出 |
| `fs_read_text_file` | `src/services/history.ts:106` | `src-tauri/src/fsutil.rs:114` | 前端 ↔ Rust 均检出 |
| `history_import` | `src/services/history.ts:114` | `src-tauri/src/history.rs:119` | 前端 ↔ Rust 均检出 |
| `history_list` | —（无前端调用点） | `src-tauri/src/history.rs:88` | **仅 Rust 侧定义，未被前端调用** |

**典型调用形态**：`history.ts` 中 69 行记录、78 行清空、106 行读取文本文件、114 行导入，构成「读文件 → 导入 → 记录/清空」的服务层顺序。`history_list`（`src-tauri/src/history.rs:88`）在本次扫描中没有任何前端调用点，属于两侧不匹配项。

### 本地文件系统

路径补全与本地文件浏览需要枚举目录、获取用户主目录，三条命令都落在 `src-tauri/src/fsutil.rs`，由不同的前端服务按场景调用。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `fs_browse_dir` | `src/services/localFs.ts:28` | `src-tauri/src/fsutil.rs:133` | 前端 ↔ Rust 均检出 |
| `fs_home_dir` | `src/services/localFs.ts:39` | `src-tauri/src/fsutil.rs:147` | 前端 ↔ Rust 均检出 |
| `fs_list_dir` | `src/services/pathCompletion.ts:26` | `src-tauri/src/fsutil.rs:108` | 前端 ↔ Rust 均检出 |

### 系统监控

监控以会话式生命周期运行：`monitor_start` 启动采集，`monitor_stop` 结束采集；采集结果通过事件通道（见下节 `monitor-*`）推送给前端 Store。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `monitor_start` | `src/services/monitor.ts:78` | `src-tauri/src/monitor/mod.rs:87` | 前端 ↔ Rust 均检出 |
| `monitor_stop` | `src/services/monitor.ts:90` | `src-tauri/src/monitor/mod.rs:212` | 前端 ↔ Rust 均检出 |

**典型调用形态**：`src/services/monitor.ts` 中 78 行启动、90 行停止；同时该文件 164 行监听 `monitor-fatal` 事件，说明监控运行期间存在命令之外的异步错误通道。

### PTY（本地终端）

PTY 命令组覆盖终端的完整生命周期与流控：创建（`pty_spawn`）、存活探测（`pty_exists`）、读取工作目录（`pty_get_cwd`）、输入（`pty_write`）、尺寸变更（`pty_resize`）、销毁（`pty_kill`）以及数据确认（`pty_ack_data`）。所有定义集中在 `src-tauri/src/pty/mod.rs`，前端全部经由 `src/services/pty.ts`。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `pty_spawn` | `src/services/pty.ts:41` | `src-tauri/src/pty/mod.rs:124` | 前端 ↔ Rust 均检出 |
| `pty_exists` | `src/services/pty.ts:94` | `src-tauri/src/pty/mod.rs:318` | 前端 ↔ Rust 均检出 |
| `pty_get_cwd` | `src/services/pty.ts:109` | `src-tauri/src/pty/mod.rs:338` | 前端 ↔ Rust 均检出 |
| `pty_resize` | `src/services/pty.ts:117` | `src-tauri/src/pty/mod.rs:286` | 前端 ↔ Rust 均检出 |
| `pty_write` | `src/services/pty.ts:124` | `src-tauri/src/pty/mod.rs:277` | 前端 ↔ Rust 均检出 |
| `pty_kill` | `src/services/pty.ts:130` | `src-tauri/src/pty/mod.rs:298` | 前端 ↔ Rust 均检出 |
| `pty_ack_data` | `src/services/pty.ts:136` | `src-tauri/src/pty/mod.rs:310` | 前端 ↔ Rust 均检出 |

**典型调用形态**：`pty_spawn`（41 行）创建会话后，运行期高频路径为 `pty_write`（124 行）与 `pty_resize`（117 行）；`pty_ack_data`（136 行）与 Rust 侧 `ack`（`src-tauri/src/pty/queue.rs:102`）配对，构成背压/流控确认机制；结束阶段依次可能调用 `pty_get_cwd`（109 行，保存路径）、`pty_kill`（130 行）、`pty_exists`（94 行，存在性检查）。

### 密钥与凭据

密钥管理（生成、导入、检查、列举、更新、删除）与凭据口令管理（设置、移除、存在性查询）分属两个 Rust 子模块，前端统一由 `src/services/secrets.ts` 暴露。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `key_inspect` | `src/services/secrets.ts:55` | `src-tauri/src/secrets/keys.rs:153` | 前端 ↔ Rust 均检出 |
| `key_generate` | `src/services/secrets.ts:67` | `src-tauri/src/secrets/keys.rs:100` | 前端 ↔ Rust 均检出 |
| `key_import` | `src/services/secrets.ts:79` | `src-tauri/src/secrets/keys.rs:178` | 前端 ↔ Rust 均检出 |
| `key_list` | `src/services/secrets.ts:90` | `src-tauri/src/secrets/keys.rs:292` | 前端 ↔ Rust 均检出 |
| `key_update` | `src/services/secrets.ts:102` | `src-tauri/src/secrets/keys.rs:329` | 前端 ↔ Rust 均检出 |
| `key_delete` | `src/services/secrets.ts:114` | `src-tauri/src/secrets/keys.rs:352` | 前端 ↔ Rust 均检出 |
| `cred_set_password` | `src/services/secrets.ts:127` | `src-tauri/src/secrets/creds.rs:50` | 前端 ↔ Rust 均检出 |
| `cred_remove` | `src/services/secrets.ts:139` | `src-tauri/src/secrets/creds.rs:73` | 前端 ↔ Rust 均检出 |
| `cred_has_password` | `src/services/secrets.ts:151` | `src-tauri/src/secrets/creds.rs:105` | 前端 ↔ Rust 均检出 |

**典型调用形态**：`secrets.ts` 按 55→67→79→90→102→114 行序组织密钥相关操作（检查、生成、导入、列举、更新、删除），随后 127→139→151 行为凭据口令操作；`key_inspect` 位于生成/导入之前，属于「先验证格式、再入库」的前置校验位。

### SFTP 与传输队列

SFTP 组覆盖会话打开/关闭、目录读取、目录与文件操作、上传下载，以及传输队列的查询、取消与清空。注意 `sftp_transfers`、`sftp_transfer_cancel`、`sftp_transfers_clear` 三条命令的 Rust 定义不在 `sftp.rs` 而在 `src-tauri/src/transfers/mod.rs`，属于跨模块复用。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `sftp_open` | `src/services/sftp.ts:50` | `src-tauri/src/sftp.rs:108` | 前端 ↔ Rust 均检出 |
| `sftp_read_dir` | `src/services/sftp.ts:63` | `src-tauri/src/sftp.rs:146` | 前端 ↔ Rust 均检出 |
| `sftp_mkdir` | `src/services/sftp.ts:76` | `src-tauri/src/sftp.rs:183` | 前端 ↔ Rust 均检出 |
| `sftp_rename` | `src/services/sftp.ts:90` | `src-tauri/src/sftp.rs:200` | 前端 ↔ Rust 均检出 |
| `sftp_remove_file` | `src/services/sftp.ts:103` | `src-tauri/src/sftp.rs:222` | 前端 ↔ Rust 均检出 |
| `sftp_remove_dir` | `src/services/sftp.ts:116` | `src-tauri/src/sftp.rs:239` | 前端 ↔ Rust 均检出 |
| `sftp_download` | `src/services/sftp.ts:131` | `src-tauri/src/sftp.rs:280` | 前端 ↔ Rust 均检出 |
| `sftp_upload` | `src/services/sftp.ts:145` | `src-tauri/src/sftp.rs:309` | 前端 ↔ Rust 均检出 |
| `sftp_close` | `src/services/sftp.ts:157` | `src-tauri/src/sftp.rs:255` | 前端 ↔ Rust 均检出 |
| `sftp_transfers` | `src/services/sftp.ts:169` | `src-tauri/src/transfers/mod.rs:440` | 前端 ↔ Rust 均检出 |
| `sftp_transfer_cancel` | `src/services/sftp.ts:181` | `src-tauri/src/transfers/mod.rs:460` | 前端 ↔ Rust 均检出 |
| `sftp_transfers_clear` | `src/services/sftp.ts:193` | `src-tauri/src/transfers/mod.rs:481` | 前端 ↔ Rust 均检出 |

**典型调用形态**：`sftp_open`（50 行）建立会话 → `sftp_read_dir`（63 行）浏览 → 目录/文件增删改（76、90、103、116 行）→ 传输（131 或 145 行）→ 队列查看/取消/清空（169、181、193 行）→ `sftp_close`（157 行）收尾。传输进度不靠轮询命令，而由 `sftp-transfers-changed` 事件推送（见下节）。

### SSH 会话

SSH 组包含连接建立、连接期交互（写入、改变尺寸、终止、数据确认）、主机密钥确认与键盘交互式认证应答。定义集中在 `src-tauri/src/ssh/commands.rs`，前端全部经由 `src/services/ssh.ts`。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `ssh_connect` | `src/services/ssh.ts:92` | `src-tauri/src/ssh/commands.rs:39` | 前端 ↔ Rust 均检出 |
| `ssh_confirm_host_key` | `src/services/ssh.ts:105` | `src-tauri/src/ssh/commands.rs:298` | 前端 ↔ Rust 均检出 |
| `ssh_respond_kbd` | `src/services/ssh.ts:119` | `src-tauri/src/ssh/commands.rs:316` | 前端 ↔ Rust 均检出 |
| `ssh_resize` | `src/services/ssh.ts:158` | `src-tauri/src/ssh/commands.rs:232` | 前端 ↔ Rust 均检出 |
| `ssh_write` | `src/services/ssh.ts:165` | `src-tauri/src/ssh/commands.rs:201` | 前端 ↔ Rust 均检出 |
| `ssh_kill` | `src/services/ssh.ts:171` | `src-tauri/src/ssh/commands.rs:261` | 前端 ↔ Rust 均检出 |
| `ssh_ack_data` | `src/services/ssh.ts:177` | `src-tauri/src/ssh/commands.rs:280` | 前端 ↔ Rust 均检出 |

**典型调用形态**：连接建立阶段先 `ssh_connect`（92 行），若遇到主机密钥校验则 `ssh_confirm_host_key`（105 行），若遇到键盘交互认证则 `ssh_respond_kbd`（119 行）——这三条构成连接期的握手链路；连接成功后进入运行期，`ssh_write`（165 行）与 `ssh_resize`（158 行）为高频调用，`ssh_ack_data`（177 行）负责数据确认流控，`ssh_kill`（171 行）结束会话。

### 配置持久化（会话、设置、Profile、快捷命令、分组、配色）

这一组命令的共同特征是**全部由 `src/stores/config/flush.ts` 统一发起**（266 行至 329 行连续排布），即前端配置 Store 在 flush 阶段把各类变更分别落盘到对应的 Rust 配置模块。这也解释了命令数量虽多但调用点高度集中的现象。

**会话与通用设置**

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `tab_session_get` | `src/services/tabSession.ts:85` | `src-tauri/src/config/settings.rs:134` | 前端 ↔ Rust 均检出 |
| `tab_session_set` | `src/services/tabSession.ts:123`、`src/services/tabSession.ts:146` | `src-tauri/src/config/settings.rs:145` | 前端 ↔ Rust 均检出 |
| `settings_set_section` | `src/stores/config/flush.ts:266` | `src-tauri/src/config/settings.rs:108` | 前端 ↔ Rust 均检出 |
| `hotkey_set` | `src/stores/config/flush.ts:269` | `src-tauri/src/config/settings.rs:124` | 前端 ↔ Rust 均检出 |
| `color_scheme_save` | `src/stores/config/flush.ts:326` | `src-tauri/src/config/settings.rs:157` | 前端 ↔ Rust 均检出 |
| `color_scheme_delete` | `src/stores/config/flush.ts:329` | `src-tauri/src/config/settings.rs:168` | 前端 ↔ Rust 均检出 |

**连接配置（Profile）**

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `profile_create` | `src/stores/config/flush.ts:272` | `src-tauri/src/config/profiles.rs:80` | 前端 ↔ Rust 均检出 |
| `profile_update` | `src/stores/config/flush.ts:275` | `src-tauri/src/config/profiles.rs:91` | 前端 ↔ Rust 均检出 |
| `profile_delete` | `src/stores/config/flush.ts:278` | `src-tauri/src/config/profiles.rs:102` | 前端 ↔ Rust 均检出 |

**快捷命令**

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `quick_command_create` | `src/stores/config/flush.ts:281` | `src-tauri/src/config/quick_commands.rs:115` | 前端 ↔ Rust 均检出 |

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `quick_command_update` | `src/stores/config/flush.ts:284` | `src-tauri/src/config/quick_commands.rs:126` | 前端 ↔ Rust 均检出 |
| `quick_command_delete` | `src/stores/config/flush.ts:287` | `src-tauri/src/config/quick_commands.rs:137` | 前端 ↔ Rust 均检出 |

**快捷命令分组**

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `quick_command_group_create` | `src/stores/config/flush.ts:290` | `src-tauri/src/config/quick_commands.rs:148` | 前端 ↔ Rust 均检出 |
| `quick_command_group_update` | `src/stores/config/flush.ts:293` | `src-tauri/src/config/quick_commands.rs:162` | 前端 ↔ Rust 均检出 |
| `quick_command_group_delete` | `src/stores/config/flush.ts:296` | `src-tauri/src/config/quick_commands.rs:176` | 前端 ↔ Rust 均检出 |

**分组（本地 / SSH / 标签页）**

三类分组命令在 `src-tauri/src/config/groups.rs` 中按「本地 179–201、SSH 212–234、标签页 245–267」的连续区块定义，前端则严格按 flush.ts 中 299–323 的行序依次发起，说明分组落盘是配置变更中的独立阶段。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `local_group_create` | `src/stores/config/flush.ts:299` | `src-tauri/src/config/groups.rs:179` | 前端 ↔ Rust 均检出 |
| `local_group_update` | `src/stores/config/flush.ts:302` | `src-tauri/src/config/groups.rs:190` | 前端 ↔ Rust 均检出 |
| `local_group_delete` | `src/stores/config/flush.ts:305` | `src-tauri/src/config/groups.rs:201` | 前端 ↔ Rust 均检出 |
| `ssh_group_create` | `src/stores/config/flush.ts:308` | `src-tauri/src/config/groups.rs:212` | 前端 ↔ Rust 均检出 |
| `ssh_group_update` | `src/stores/config/flush.ts:311` | `src-tauri/src/config/groups.rs:223` | 前端 ↔ Rust 均检出 |
| `ssh_group_delete` | `src/stores/config/flush.ts:314` | `src-tauri/src/config/groups.rs:234` | 前端 ↔ Rust 均检出 |
| `tab_group_create` | `src/stores/config/flush.ts:317` | `src-tauri/src/config/groups.rs:245` | 前端 ↔ Rust 均检出 |
| `tab_group_update` | `src/stores/config/flush.ts:320` | `src-tauri/src/config/groups.rs:256` | 前端 ↔ Rust 均检出 |
| `tab_group_delete` | `src/stores/config/flush.ts:323` | `src-tauri/src/config/groups.rs:267` | 前端 ↔ Rust 均检出 |

### 配置加载与旧版迁移

配置读取发生在 Store 初始化阶段，因此调用点落在 `src/stores/config/store.ts` 而非 flush.ts。三个命令构成「新版加载 → 旧版 YAML 探测 → 旧版归档」的迁移链，分别定义在 `config/load.rs` 与 `config/legacy.rs`。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `config_load` | `src/stores/config/store.ts:39`、`src/stores/config/store.ts:274` | `src-tauri/src/config/load.rs:166` | 前端 ↔ Rust 均检出 |
| `config_load_legacy_yaml` | `src/stores/config/store.ts:44` | `src-tauri/src/config/legacy.rs:64` | 前端 ↔ Rust 均检出 |
| `config_archive_legacy_yaml` | `src/stores/config/store.ts:76` | `src-tauri/src/config/legacy.rs:78` | 前端 ↔ Rust 均检出 |

**典型调用形态**：`store.ts` 39 行先加载当前配置（274 行为另一处再次加载，如重置后重读），44 行尝试读取旧版 YAML，76 行将旧版文件归档，形成一次性的版本迁移路径。

### 两侧匹配情况汇总

在全部检出命令中：

- **前端与 Rust 均检出**：上表除下列条目外的全部命令，构成应用正常运行所需的完整接口面。
- **仅 Rust 侧定义（未被前端调用）**：`history_list`（`src-tauri/src/history.rs:88`）。
- **仅前端调用，Rust 侧未检出**：本次数据中无此类条目。

### 扫描局限

命令表基于对 `invoke(...)` 静态调用点的扫描，因此 **以变量或表达式作为命令名的动态 `invoke`（例如 `invoke(cmdName, ...)` 形式）不会被纳入本表**；若项目存在按配置或路由拼接命令名的调用方式，其命令不会出现在上述前端调用点列中。同样，Rust 侧命令的检出依赖 `#[tauri::command]` 宏定义位置，通过其他方式注册的处理函数不在统计范围内。因此「仅 Rust 侧定义」的结论应理解为「在扫描到的前端文件中未发现该命令名的字面调用」，而非绝对不可达。

---

## IPC 事件

事件通道用于 Rust 侧或前端侧向前端 Store 主动推送状态，与命令的请求-响应模型互补：命令负责「我要它做什么」，事件负责「它发生了什么」。下表列出全部检出事件及其监听与发射点。

| 事件 | 前端监听点 | 发射点（前端 / Rust） |
| --- | --- | --- |
| `monitor-fatal` | `src/services/monitor.ts:164` | 本次数据未检出 |
| `monitor-sample` | `src/stores/monitor.ts:37` | 本次数据未检出 |
| `monitor-sample-error` | `src/stores/monitor.ts:43` | 本次数据未检出 |
| `monitor-unsupported` | `src/stores/monitor.ts:48` | 本次数据未检出 |
| `sftp-transfers-changed` | `src/stores/transfers.ts:49` | Rust：`src-tauri/src/transfers/mod.rs:284` |

**事件驱动的交互模式**：监控模块采用「命令启动采集 + 事件回传数据」的模式——`monitor_start`（`src/services/monitor.ts:78`）开启采集后，采样数据经 `monitor-sample` 推送到 `src/stores/monitor.ts:37`，异常与不支持场景分别走 `monitor-sample-error`（43 行）与 `monitor-unsupported`（48 行）；`monitor-fatal`（164 行）在服务层监听，用于处理致命错误。这一分层说明监控的失败语义被拆成「致命 / 采样错误 / 平台不支持」三类，前端可分别呈现。

传输模块则是「Rust 主动通知 + 前端拉取」的组合：`sftp-transfers-changed` 由 `src-tauri/src/transfers/mod.rs:284` 发射，前端在 `src/stores/transfers.ts:49` 监听；收到变更通知后，前端可通过 `sftp_transfers`（`src/services/sftp.ts:169`）获取队列明细，也可用 `sftp_transfer_cancel`（181 行）、`sftp_transfers_clear`（193 行）干预。事件与命令在此形成闭合回路，避免高频轮询。

需要说明的是，`monitor-*` 四个事件在本次扫描结果中**未检出对应发射点**，其发射位置待确认。

---

## CLI 命令

本次数据中 `commands` 数组为空，**未检出任何 CLI 命令定义**，因此无命令名、说明或源文件位置可列。项目的对外接口以 Tauri IPC 命令为主体，不包含命令行入口。

---

## 导出函数

以下函数为扫描检出的导出符号，涵盖前端终端渲染/补全逻辑与 Rust 侧转发、PTY 队列等实现细节。按所属模块分组列出。

### 前端：终端缓冲区与建议控制器

这一组函数服务于终端渲染的行定位与补全菜单的接受动作，`acceptAt` / `acceptSelected` 是补全控制器对外的两个操作入口，`absoluteCursorRow` 为缓冲区行号换算工具。

| 函数名 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- |
| `absoluteCursorRow` | `(buffer: BufferCursorView)` | 依据缓冲区视图计算光标绝对行号 | `src/lib/frontends/bufferRows.ts:23` |
| `acceptAt` | `(index: number, execute: boolean)` | 鼠标点击菜单条目的接受入口：先把目标项设为选中再接受；`index` 越界时忽略，`execute=false` 时只补全不执行 | `src/lib/suggestions/controller.ts:179` |
| `acceptSelected` | `(execute: boolean)` | 接受当前已选中的建议项，`execute` 控制是否补换行立即执行 | `src/lib/suggestions/controller.ts:194` |

`acceptAt` 与 `acceptSelected` 的分工在于触发来源不同：前者对应鼠标点击（需要先用 `index` 定位并同步选中态），后者对应键盘确认（选中态已存在）。二者共享 `execute` 参数语义，即「补全」与「补全并执行」的区分。`acceptAt` 的文档注释给出了调用示例 `acceptAt(2, false) // 点击第 3 项 = 补全不执行`，明确下标从 0 起算。

### Rust：转发连接处理

`src-tauri/src/forward/loops.rs` 中两个函数分别实现本地转发与动态转发的单连接处理，二者的 docstring 直接标明了所属转发模式。

| 函数名 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- |
| `accept_local_connection` | `(handle: std::sync::Arc<ForwardHandle>, session: std::sync::Arc<SshSession>, tcp: TcpStream, peer: std::net::SocketAddr)` | -L 本地转发：每连接开 direct-tcpip channel 后双向搬运，单连接失败仅断该连接 | `src-tauri/src/forward/loops.rs:95` |
| `accept_dynamic_connection` | `(handle: std::sync::Arc<ForwardHandle>, session: std::sync::Arc<SshSession>, tcp: TcpStream, _peer: std::net::SocketAddr)` | -D 动态转发：SOCKS5 no-auth 握手 → CONNECT 目标接管为 direct-tcpip channel → 双向搬运 | `src-tauri/src/forward/loops.rs:115` |

签名形态揭示了共同的并发模型：函数接收 `Arc<ForwardHandle>` 与 `Arc<SshSession>`（共享句柄与会话），说明每个连接处理逻辑运行在转发任务的并发上下文中；`TcpStream` 为本地接入连接，`peer` 为对端地址（动态转发中以 `_peer` 命名，表示当前实现未使用该参数）。两个函数的 docstring 都强调「单连接失败仅断该连接」或逐连接独立处理，表明失败隔离发生在单连接粒度，不会波及整个转发实例。这两个函数由前文的 `forward_start`（`src-tauri/src/forward/mod.rs:317`）所启动的转发流程调用，与 `forward_stop`（431 行）构成启停闭环。

### Rust：PTY 数据确认

| 函数名 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- |
| `ack` | `(&self, length: usize)` | 按长度推进队列确认位置 | `src-tauri/src/pty/queue.rs:102` |

`ack` 是 PTY 数据队列的确认方法，接收 `length` 参数，与 IPC 命令 `pty_ack_data`（`src-tauri/src/pty/mod.rs:310`，前端调用点 `src/services/pty.ts:136`）对应。其存在说明 PTY 输出采用「发送—确认」的流控模型：Rust 侧产出数据后不无限制堆积，而需前端确认已消费的长度后继续推进。SSH 侧存在对称的确认路径，即前端 `ackData`（见下）与命令 `ssh_ack_data`（`src-tauri/src/ssh/commands.rs:280`）。

### 前端：SSH 数据确认

| 函数名 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- |
| `ackData` | `(length: number)` | 上报已消费的数据长度，触发后续数据下发 | `src/services/ssh.ts:175` |

`ackData` 位于 `src/services/ssh.ts`，其行号 175 与同文件中命令 `ssh_ack_data` 的调用点（177 行）相邻，可视为对该 IPC 命令的薄封装：前端调用 `ackData(length)` 后经 `ssh_ack_data` 通知 Rust 侧。它与 PTY 侧的 `pty_ack_data`（`src/services/pty.ts:136`）在语义上一致，分别是 SSH 会话与本地终端两条数据通路的流控确认入口。

---

## 框架相关节点

本次数据中 `frameworkNodes` 与 `supplementalSymbols` 均为空，**未检出 Controller、Router、中间件等框架级节点**。这与项目形态一致：对外接口由 Tauri IPC 命令注册表承载，而非 Web 框架的路由表；前端经由 `src/services/*.ts` 与 `src/stores/` 直接调用命令，不存在服务端路由分发层。

---

## 附：接口面速查

| 维度 | 事实 | 依据 |
| --- | --- | --- |
| 命令总数（检出） | 90 条，覆盖调试、外观、配置同步、转发、历史、文件系统、监控、PTY、密钥、SFTP、SSH、配置持久化、配置加载 | `ipc.commands` 列表 |
| 两侧均匹配 | 89 条 | 上表状态列 |
| 仅 Rust 侧定义 | 1 条：`history_list`（`src-tauri/src/history.rs:88`） | `ipc.commands` |
| 事件总数（检出） | 5 条，其中仅 `sftp-transfers-changed` 检出发射点 | `ipc.events` |
| CLI 命令 | 无 | `commands` 为空 |
| 框架节点 | 无 | `frameworkNodes` 为空 |
| 前端调用最密集的单文件 | `src/stores/config/flush.ts`（266–329 行连续发起 22 条配置类命令） | `ipc.commands` 前端调用点 |
| 后端定义最密集的单文件 | `src-tauri/src/sftp.rs`（108–309 行定义 9 条命令） | `ipc.commands` rustDef |

**待确认**：`monitor-fatal`、`monitor-sample`、`monitor-sample-error`、`monitor-unsupported` 四个事件的发射点未在本次数据中检出，需补充 Rust 侧 `emit` 调用点证据以确认其产生位置与触发条件。
## Related

- 总入口：[README](../README.md)
