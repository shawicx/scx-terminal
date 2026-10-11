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

本页聚焦项目的对外接口面：Tauri IPC 命令、IPC 事件，以及数据中可确认的导出函数。所有条目均给出源码锚点。

项目的对外交互采用「前端服务层 → IPC 命令 → Rust 实现」的三段式结构：前端把每个能力封装在 `src/services/*.ts`（以及 `src/stores/config/flush.ts`）中，通过命令名调用 Rust 侧同名 `#[tauri::command]`；Rust 侧除响应式命令外，还通过事件向下推送监控采样与传输进度。命令命名呈现明显的成对/成组特征（`*_start`/`*_stop`、`*_get`/`*_set`、`create`/`update`/`delete`），这构成命令族划分与协作关系描述的依据。

> **推断声明（全文唯一）**：本页「命令分组」与各组内的协作关系描述，依据为命令名前缀 + Rust 定义所在文件/目录（如 `frontendCalls` 与 `rustDef` 的成组对应）；数据未提供调用顺序、参数 schema 或返回值定义，故不给出带时序的调用序列。

---

## Tauri IPC 命令

下表为本次扫描确认的全部 IPC 命令，共 **95** 条。每组的「前端调用点」为扫描到的 `invoke` 调用位置，「Rust 定义」为命令实现所在文件与行号，「状态」表示两侧是否均检出。

### 应用信息与调试

面向设置页「关于」与启动期调试的少量基础设施命令：既有读取应用目录（配置目录、日志目录）的只读查询，也有在 `main.ts` 启动路径上打开调试能力的开关，以及外观页使用的背景图读写。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
|---|---|---|---|
| `config_dir_path` | `src/components/settings/pages/AboutPage.vue:26` | `src-tauri/src/config/mod.rs:37` | 双向匹配 |
| `debug_log_dir` | `src/components/settings/pages/AboutPage.vue:29` | `src-tauri/src/lib.rs:64` | 双向匹配 |
| `dev_log` | `src/components/settings/pages/AboutPage.vue:46`、`AboutPage.vue:66`、`src/main.ts:22`、`src/main.ts:25`、`src/main.ts:28` | `src-tauri/src/lib.rs:29` | 双向匹配 |
| `debug_set_enabled` | `src/main.ts:38` | `src-tauri/src/lib.rs:41` | 双向匹配 |
| `debug_open_devtools` | `src/main.ts:39` | `src-tauri/src/lib.rs:52` | 双向匹配 |
| `background_image_set` | `src/components/settings/pages/AppearancePage.vue:54`、`AppearancePage.vue:71` | `src-tauri/src/background.rs:116` | 双向匹配 |
| `background_image_load` | `src/services/backgroundImage.ts:63` | `src-tauri/src/background.rs:140` | 双向匹配 |

说明：`config_dir_path` 与 `debug_log_dir` 均为只读路径查询，调用点集中在 `AboutPage.vue` 一处组件内；`dev_log` 是唯一同时被页面组件（`AboutPage.vue:46`、`AboutPage.vue:66`）与入口模块（`src/main.ts:22`、`:25`、`:28`）调用的命令，表明其被用作启动期与设置页共用的日志出口。`background_image_set` / `background_image_load` 构成本组唯一的写/读对，写在 `AppearancePage.vue`（两处调用点）、读封装在 `src/services/backgroundImage.ts`。

### 配置备份与 S3 同步

配置的备份导入导出与远端（S3）同步能力，前端分别封装在 `src/services/configBackup.ts` 与 `src/services/configSync.ts`。`s3_sync_*` 形成较完整的一组：读取/写入/清空同步配置，测试连通性，查询状态，推送到远端、列远端对象、从远端拉取。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
|---|---|---|---|
| `config_export` | `src/services/configBackup.ts:24` | `src-tauri/src/snapshot/mod.rs:138` | 双向匹配 |
| `config_import` | `src/services/configBackup.ts:37` | `src-tauri/src/snapshot/mod.rs:161` | 双向匹配 |
| `s3_sync_get` | `src/services/configSync.ts:56` | `src-tauri/src/s3sync/mod.rs:138` | 双向匹配 |
| `s3_sync_set` | `src/services/configSync.ts:68` | `src-tauri/src/s3sync/mod.rs:155` | 双向匹配 |
| `s3_sync_clear` | `src/services/configSync.ts:79` | `src-tauri/src/s3sync/mod.rs:165` | 双向匹配 |
| `s3_sync_test` | `src/services/configSync.ts:91` | `src-tauri/src/s3sync/mod.rs:175` | 双向匹配 |
| `s3_sync_status` | `src/services/configSync.ts:102` | `src-tauri/src/s3sync/mod.rs:217` | 双向匹配 |
| `s3_sync_push` | `src/services/configSync.ts:114` | `src-tauri/src/s3sync/mod.rs:185` | 双向匹配 |
| `s3_sync_list_remote` | `src/services/configSync.ts:125` | `src-tauri/src/s3sync/mod.rs:236` | 双向匹配 |
| `s3_sync_pull` | `src/services/configSync.ts:138` | `src-tauri/src/s3sync/mod.rs:247` | 双向匹配 |

说明：`config_export` / `config_import` 是快照模块（`src-tauri/src/snapshot/mod.rs`）对外的一对出入口，前端调用点相邻（`configBackup.ts:24` 与 `:37`）。`s3_sync_get`/`s3_sync_set`/`s3_sync_clear` 为配置三元组，`s3_sync_test`/`s3_sync_status` 为诊断类只读调用，`s3_sync_push`/`s3_sync_list_remote`/`s3_sync_pull` 为数据搬运三元组，前端调用点在 `configSync.ts` 中按此先后排列（`:56` → `:138`）。

### 字体与 Shell 列表

两条主机环境枚举命令，用于下拉/候选数据来源。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
|---|---|---|---|
| `list_fonts` | `src/services/fonts.ts:15` | `src-tauri/src/fonts.rs:5` | 双向匹配 |
| `list_shells` | `src/services/shells.ts:12` | `src-tauri/src/shells.rs:25` | 双向匹配 |

说明：两者均为单命令对单服务文件的形态，Rust 侧实现位于顶层独立文件（`fonts.rs`、`shells.rs`），无成对命令。

### 端口转发

本地/动态端口转发的生命周期管理，前端封装在 `src/services/forward.ts`。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
|---|---|---|---|
| `forward_start` | `src/services/forward.ts:21` | `src-tauri/src/forward/mod.rs:317` | 双向匹配 |
| `forward_stop` | `src/services/forward.ts:33` | `src-tauri/src/forward/mod.rs:431` | 双向匹配 |
| `forward_list` | `src/services/forward.ts:45` | `src-tauri/src/forward/mod.rs:461` | 双向匹配 |
| `forward_list_all` | `src/services/forward.ts:56` | `src-tauri/src/forward/mod.rs:479` | 双向匹配 |

说明：`forward_start` / `forward_stop` 是同一转发实例的启停对；`forward_list` 与 `forward_list_all` 的差异（按会话过滤 vs 全量）在数据中仅体现为两个独立实现位置（`forward/mod.rs:461`、`:479`），具体语义差异**待确认**（缺参数与返回定义）。

### 历史记录

历史条目的记录、查询、清空与导入，以及读取文本文件内容（历史文件预览）的辅助命令。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
|---|---|---|---|
| `history_record` | `src/services/history.ts:69` | `src-tauri/src/history.rs:67` | 双向匹配 |
| `history_list` | `src/services/history.ts:33` | `src-tauri/src/history.rs:88` | 双向匹配 |
| `history_clear` | `src/services/history.ts:151` | `src-tauri/src/history.rs:151` | 双向匹配 |
| `history_import` | `src/services/history.ts:114` | `src-tauri/src/history.rs:119` | 双向匹配 |
| `fs_read_text_file` | `src/services/history.ts:106` | `src-tauri/src/fsutil.rs:114` | 双向匹配 |

说明：`history_list` 的调用点（`history.ts:33`）在文件中位于 `history_record`（`history.ts:69`）之前；`fs_read_text_file` 虽归入 `history.ts` 服务文件，但 Rust 实现位于 `src-tauri/src/fsutil.rs`，属跨模块复用（同一 `fsutil.rs` 还承载下方本地文件系统命令）。

### 本地文件系统

本地路径浏览与补全，前端分别封装在 `src/services/localFs.ts` 与 `src/services/pathCompletion.ts`。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
|---|---|---|---|
| `fs_browse_dir` | `src/services/localFs.ts:28` | `src-tauri/src/fsutil.rs:133` | 双向匹配 |
| `fs_home_dir` | `src/services/localFs.ts:39` | `src-tauri/src/fsutil.rs:147` | 双向匹配 |
| `fs_list_dir` | `src/services/pathCompletion.ts:26` | `src-tauri/src/fsutil.rs:108` | 双向匹配 |

说明：`fs_list_dir` 位于 `fsutil.rs:108`，早于 `fs_read_text_file`（`:114`）与 `fs_browse_dir`（`:133`），是 `fsutil.rs` 中最靠前的目录类命令。

### 系统监控

`monitor_start` / `monitor_stop` 构成成对的生命周期控制，配套的数据推送通过同名前缀事件完成（见下节）。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
|---|---|---|---|
| `monitor_start` | `src/services/monitor.ts:78` | `src-tauri/src/monitor/mod.rs:87` | 双向匹配 |
| `monitor_stop` | `src/services/monitor.ts:90` | `src-tauri/src/monitor/mod.rs:212` | 双向匹配 |

说明：该组是「命令启动 → 事件推送」模式的代表：命令仅负责启停，采样数据不由命令返回，而由 `monitor-sample` 等事件下发。

### 本地 PTY

本地终端会话的命令族，前端封装在 `src/services/pty.ts`，Rust 实现集中在 `src-tauri/src/pty/mod.rs`。包含生命周期（spawn/kill）、状态查询（exists/get_cwd）、数据通道（write/ack_data）与窗口尺寸（resize）。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
|---|---|---|---|
| `pty_spawn` | `src/services/pty.ts:41` | `src-tauri/src/pty/mod.rs:124` | 双向匹配 |
| `pty_exists` | `src/services/pty.ts:94` | `src-tauri/src/pty/mod.rs:318` | 双向匹配 |
| `pty_get_cwd` | `src/services/pty.ts:109` | `src-tauri/src/pty/mod.rs:338` | 双向匹配 |
| `pty_resize` | `src/services/pty.ts:117` | `src-tauri/src/pty/mod.rs:286` | 双向匹配 |
| `pty_write` | `src/services/pty.ts:124` | `src-tauri/src/pty/mod.rs:277` | 双向匹配 |
| `pty_kill` | `src/services/pty.ts:130` | `src-tauri/src/pty/mod.rs:298` | 双向匹配 |
| `pty_ack_data` | `src/services/pty.ts:136` | `src-tauri/src/pty/mod.rs:310` | 双向匹配 |

说明：`pty_write` / `pty_ack_data` 与 `pty_resize` 在 `pty/mod.rs` 中相邻（`:277`、`:286`、`:310`），`pty_ack_data` 与队列侧的 `ack`（`src-tauri/src/pty/queue.rs:102`）命名对应，属确认消费（背压）机制的两端。

### 密钥与凭据

主机密钥管理与凭据口令管理，前端统一封装在 `src/services/secrets.ts`，Rust 侧分文件实现（`secrets/keys.rs`、`secrets/creds.rs`）。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
|---|---|---|---|
| `key_generate` | `src/services/secrets.ts:67` | `src-tauri/src/secrets/keys.rs:100` | 双向匹配 |
| `key_inspect` | `src/services/secrets.ts:55` | `src-tauri/src/secrets/keys.rs:153` | 双向匹配 |
| `key_import` | `src/services/secrets.ts:79` | `src-tauri/src/secrets/keys.rs:178` | 双向匹配 |
| `key_list` | `src/services/secrets.ts:90` | `src-tauri/src/secrets/keys.rs:292` | 双向匹配 |
| `key_update` | `src/services/secrets.ts:102` | `src-tauri/src/secrets/keys.rs:329` | 双向匹配 |
| `key_delete` | `src/services/secrets.ts:114` | `src-tauri/src/secrets/keys.rs:352` | 双向匹配 |
| `cred_set_password` | `src/services/secrets.ts:127` | `src-tauri/src/secrets/creds.rs:50` | 双向匹配 |
| `cred_remove` | `src/services/secrets.ts:139` | `src-tauri/src/secrets/creds.rs:73` | 双向匹配 |
| `cred_has_password` | `src/services/secrets.ts:151` | `src-tauri/src/secrets/creds.rs:105` | 双向匹配 |

说明：`key_*` 六条命令在 `secrets/keys.rs` 中按角色分区（生成/检查/导入/列举/更新/删除）；`cred_*` 三条命令在 `secrets/creds.rs` 中形成「设置 / 删除 / 存在性查询」三态接口，其中 `cred_has_password`（`creds.rs:105`）为布尔查询，用于避免直接取回口令。

### SFTP

SFTP 会话与文件操作命令，加上传输任务查询，前端封装在 `src/services/sftp.ts`；注意传输类三条命令的 Rust 实现不在 `sftp.rs` 而在 `src-tauri/src/transfers/mod.rs`。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
|---|---|---|---|
| `sftp_open` |

`src/services/sftp.ts:50` | `src-tauri/src/sftp.rs:108` | 双向匹配 |
| `sftp_read_dir` | `src/services/sftp.ts:63` | `src-tauri/src/sftp.rs:146` | 双向匹配 |
| `sftp_mkdir` | `src/services/sftp.ts:76` | `src-tauri/src/sftp.rs:183` | 双向匹配 |
| `sftp_rename` | `src/services/sftp.ts:90` | `src-tauri/src/sftp.rs:200` | 双向匹配 |
| `sftp_remove_file` | `src/services/sftp.ts:103` | `src-tauri/src/sftp.rs:222` | 双向匹配 |
| `sftp_remove_dir` | `src/services/sftp.ts:116` | `src-tauri/src/sftp.rs:239` | 双向匹配 |
| `sftp_close` | `src/services/sftp.ts:157` | `src-tauri/src/sftp.rs:255` | 双向匹配 |
| `sftp_download` | `src/services/sftp.ts:131` | `src-tauri/src/sftp.rs:280` | 双向匹配 |
| `sftp_upload` | `src/services/sftp.ts:145` | `src-tauri/src/sftp.rs:309` | 双向匹配 |
| `sftp_transfers` | `src/services/sftp.ts:169` | `src-tauri/src/transfers/mod.rs:440` | 双向匹配 |
| `sftp_transfer_cancel` | `src/services/sftp.ts:181` | `src-tauri/src/transfers/mod.rs:460` | 双向匹配 |
| `sftp_transfers_clear` | `src/services/sftp.ts:193` | `src-tauri/src/transfers/mod.rs:481` | 双向匹配 |

说明：`sftp_open`（`sftp.rs:108`）为会话建立入口，其后的目录/文件操作共享同一命令前缀（`sftp_*`）。`sftp_close`（`sftp.rs:255`）在实现文件中位于 `sftp_remove_dir`（`:239`）与 `sftp_download`（`:280`）之间，前端调用点（`sftp.ts:157`）也位于 `sftp_upload`（`:145`）与 `sftp_transfers`（`:169`）之间——两侧顺序一致。三条传输任务命令的 Rust 实现集中在 `src-tauri/src/transfers/mod.rs`，与文件操作所在的 `sftp.rs` 分离，其中 `sftp_transfers`/`sftp_transfer_cancel`/`sftp_transfers_clear` 在 `transfers/mod.rs` 中顺序相邻（`:440`、`:460`、`:481`），前端调用点同样相邻（`sftp.ts:169`、`:181`、`:193`）。同模块的 `sftp-transfers-changed` 事件（`transfers/mod.rs:284`）用于推送传输列表变化，构成「命令查询 + 事件推送」的组合。

### SSH 会话

SSH 连接与交互命令，前端封装在 `src/services/ssh.ts`，Rust 实现在 `src-tauri/src/ssh/commands.rs`。与本地 PTY 命令族形态高度对称：连接建立、主机密钥确认、键盘交互应答、数据读写与确认、尺寸调整、结束。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
|---|---|---|---|
| `ssh_connect` | `src/services/ssh.ts:92` | `src-tauri/src/ssh/commands.rs:39` | 双向匹配 |
| `ssh_confirm_host_key` | `src/services/ssh.ts:105` | `src-tauri/src/ssh/commands.rs:298` | 双向匹配 |
| `ssh_respond_kbd` | `src/services/ssh.ts:119` | `src-tauri/src/ssh/commands.rs:316` | 双向匹配 |
| `ssh_write` | `src/services/ssh.ts:165` | `src-tauri/src/ssh/commands.rs:201` | 双向匹配 |
| `ssh_resize` | `src/services/ssh.ts:158` | `src-tauri/src/ssh/commands.rs:232` | 双向匹配 |
| `ssh_kill` | `src/services/ssh.ts:171` | `src-tauri/src/ssh/commands.rs:261` | 双向匹配 |
| `ssh_ack_data` | `src/services/ssh.ts:177` | `src-tauri/src/ssh/commands.rs:280` | 双向匹配 |

说明：`ssh_confirm_host_key`（`commands.rs:298`）与 `ssh_respond_kbd`（`:316`）是连接期的两次交互应答入口，前端调用点相邻（`ssh.ts:105`、`:119`）；`ssh_write`/`ssh_resize`/`ssh_kill`/`ssh_ack_data` 为会话运行期命令，前端调用点集中在 `ssh.ts:158`–`:177` 的连续区间内。与 PTY 组对照，`ssh_ack_data`（`commands.rs:280`）与 `pty_ack_data`（`pty/mod.rs:310`）位置相邻、角色相同。

### 配置持久化（设置/分组/快捷命令）

配置写入类命令，前端统一由 `src/stores/config/flush.ts` 的连续调用点（`:266`–`:329`）触发，Rust 侧按实体分文件：`settings.rs`（设置、配色、会话）、`profiles.rs`、`quick_commands.rs`、`groups.rs`。这组命令呈现出严格的「每个实体三个命令」的 CRUD 形态。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
|---|---|---|---|
| `settings_set_section` | `src/stores/config/flush.ts:266` | `src-tauri/src/config/settings.rs:108` | 双向匹配 |
| `hotkey_set` | `src/stores/config/flush.ts:269` | `src-tauri/src/config/settings.rs:124` | 双向匹配 |
| `tab_session_get` | `src/services/tabSession.ts:85` | `src-tauri/src/config/settings.rs:134` | 双向匹配 |
| `tab_session_set` | `src/services/tabSession.ts:123`、`tabSession.ts:146` | `src-tauri/src/config/settings.rs:145` | 双向匹配 |
| `color_scheme_save` | `src/stores/config/flush.ts:326` | `src-tauri/src/config/settings.rs:157` | 双向匹配 |
| `color_scheme_delete` | `src/stores/config/flush.ts:329` | `src-tauri/src/config/settings.rs:168` | 双向匹配 |
| `profile_create` | `src/stores/config/flush.ts:272` | `src-tauri/src/config/profiles.rs:80` | 双向匹配 |
| `profile_update` | `src/stores/config/flush.ts:275` | `src-tauri/src/config/profiles.rs:91` | 双向匹配 |
| `profile_delete` | `src/stores/config/flush.ts:278` | `src-tauri/src/config/profiles.rs:102` | 双向匹配 |
| `quick_command_create` | `src/stores/config/flush.ts:281` | `src-tauri/src/config/quick_commands.rs:117` | 双向匹配 |
| `quick_command_update` | `src/stores/config/flush.ts:284` | `src-tauri/src/config/quick_commands.rs:128` | 双向匹配 |
| `quick_command_delete` | `src/stores/config/flush.ts:287` | `src-tauri/src/config/quick_commands.rs:139` | 双向匹配 |
| `quick_command_group_create` | `src/stores/config/flush.ts:290` | `src-tauri/src/config/quick_commands.rs:150` | 双向匹配 |
| `quick_command_group_update` | `src/stores/config/flush.ts:293` | `src-tauri/src/config/quick_commands.rs:164` | 双向匹配 |
| `quick_command_group_delete` | `src/stores/config/flush.ts:296` | `src-tauri/src/config/quick_commands.rs:178` | 双向匹配 |
| `local_group_create` | `src/stores/config/flush.ts:299` | `src-tauri/src/config/groups.rs:179` | 双向匹配 |
| `local_group_update` | `src/stores/config/flush.ts:302` | `src-tauri/src/config/groups.rs:190` | 双向匹配 |
| `local_group_delete` | `src/stores/config/flush.ts:305` | `src-tauri/src/config/groups.rs:201` | 双向匹配 |
| `ssh_group_create` | `src/stores/config/flush.ts:308` | `src-tauri/src/config/groups.rs:212` | 双向匹配 |
| `ssh_group_update` | `src/stores/config/flush.ts:311` | `src-tauri/src/config/groups.rs:223` | 双向匹配 |
| `ssh_group_delete` | `src/stores/config/flush.ts:314` | `src-tauri/src/config/groups.rs:234` | 双向匹配 |
| `tab_group_create` | `src/stores/config/flush.ts:317` | `src-tauri/src/config/groups.rs:245` | 双向匹配 |
| `tab_group_update` | `src/stores/config/flush.ts:320` | `src-tauri/src/config/groups.rs:256` | 双向匹配 |
| `tab_group_delete` | `src/stores/config/flush.ts:323` | `src-tauri/src/config/groups.rs:267` | 双向匹配 |

说明：`groups.rs` 中三组分组命令按 `local_group_*`（`:179`/`:190`/`:201`）、`ssh_group_*`（`:212`/`:223`/`:234`）、`tab_group_*`（`:245`/`:256`/`:267`）依次排列，每组内部固定为 create → update → delete 且步长 11 行，`quick_command_group_*`（`quick_commands.rs:150`/`:164`/`:178`）呈相同的三段式，说明四类分组实体共享同一套操作契约。`tab_session_get`/`tab_session_set` 是唯一不由 `flush.ts` 触发的一对（前端封装在 `src/services/tabSession.ts`），且 `tab_session_set` 有两个前端调用点（`tabSession.ts:123`、`:146`）。`color_scheme_save`/`color_scheme_delete` 在 `settings.rs` 中位于 `tab_session_set`（`:145`）之后；`tab_session_get`（`:134`）与 `tab_session_set`（`:145`）夹在 `hotkey_set`（`:124`）与 `color_scheme_save`（`:157`）之间，`settings.rs` 的这段区间（`:108`–`:168`）即设置写入命令的集中定义区。

### 配置加载与旧版迁移

启动期的配置读取与 YAML 旧版迁移命令，前端封装在 `src/stores/config/store.ts`。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
|---|---|---|---|
| `config_load` | `src/stores/config/store.ts:39`、`store.ts:277` | `src-tauri/src/config/load.rs:177` | 双向匹配 |
| `config_load_legacy_yaml` | `src/stores/config/store.ts:44` | `src-tauri/src/config/legacy.rs:64` | 双向匹配 |
| `config_archive_legacy_yaml` | `src/stores/config/store.ts:79` | `src-tauri/src/config/legacy.rs:78` | 双向匹配 |

说明：`config_load` 是全部命令中前端调用点跨度最大的之一（`store.ts:39` 与 `:277`），表明其在初始化与重载路径上各被调用一次。`config_load_legacy_yaml` 与 `config_archive_legacy_yaml` 构成迁移对：先加载旧版（`legacy.rs:64`）再归档（`legacy.rs:78`），两者在 `legacy.rs` 中相邻，前端调用点在 `store.ts` 中亦相邻（`:44`、`:79`）。

### 命令扫描口径与缺口

- **扫描局限**：本次命令发现基于静态文本匹配，`invoke(变量)` 形式的动态命令名不在表内；若命令名由变量拼接或经统一封装层间接传入，则不会出现在 `frontendCalls` 中。因此「未被前端调用」的判定仅适用于静态字面量调用场景。
- 本数据中 **全部 95 条命令均双向匹配**：`frontendCalls` 与 `rustDef` 均非空，不存在「仅前端调用，Rust 侧未检出」或「未被前端调用」的条目，也无 `rustMissSuspect`（待确认） / `frontendMissSuspect`（待确认） 标注项。
- 命令总数按表中条目计（95 条），分组为 11 组。

---

## IPC 事件

事件共 **5** 条，全部由 Rust 侧发射、前端监听，无一为前端发射。它们在形态上分为两类：`monitor-*` 四件套构成监控采样数据与控制信号的下行通道；`sftp-transfers-changed` 构成传输列表变化的变更通知。

这种设计把「高频/异步产生的数据」与「命令的请求-响应」分离：命令只负责启停与查询，持续产生的数据由事件推送，避免前端轮询。

| 事件 | 前端监听点 | 发射点（前端/Rust） |
|---|---|---|
| `monitor-fatal` | `src/services/monitor.ts:164` | Rust：`src-tauri/src/monitor/mod.rs:127` |
| `monitor-sample` | `src/stores/monitor.ts:37` | Rust：`src-tauri/src/monitor/mod.rs:147` |
| `monitor-sample-error` | `src/stores/monitor.ts:43` | Rust：`src-tauri/src/monitor/mod.rs:171`、`src-tauri/src/monitor/mod.rs:181` |
| `monitor-unsupported` | `src/stores/monitor.ts:48` | Rust：`src-tauri/src/monitor/mod.rs:156` |
| `sftp-transfers-changed` | `src/stores/transfers.ts:49` | Rust：`src-tauri/src/transfers/mod.rs:284` |

说明：

- **监控事件族**：发射点全部位于 `src-tauri/src/monitor/mod.rs`，且分布在同一区间（`:127`–`:181`）。按行号顺序为 `monitor-fatal`（`:127`）→ `monitor-sample`（`:147`）→ `monitor-unsupported`（`:156`）→ `monitor-sample-error`（两处，`:171`、`:181`）。`monitor-sample-error` 是唯一有多个发射点的事件，表明采样错误在模块内有两个不同的触发位置。前端侧，`monitor-fatal` 的监听点在服务层 `src/services/monitor.ts:164`，其余三个（`monitor-sample`、`monitor-sample-error`、`monitor-unsupported`）的监听点在状态层 `src/stores/monitor.ts:37`、`:43`、`:48` 连续三行——服务体系接收致命错误，状态仓库接收采样与降级信息，这是一条可确证的分工事实（依据：`listeners` 所属文件不同）。
- **传输变更事件**：`sftp-transfers-changed` 的发射点为 `src-tauri/src/transfers/mod.rs:284`，恰在该模块三条传输命令定义（`:440`、`:460`、`:481`）之前，前端监听点在 `src/stores/transfers.ts:49`。该事件与 `sftp_transfers` / `sftp_transfer_cancel` / `sftp_transfers_clear` 命令共享同一 Rust 模块，说明传输状态的读取既可主动查询也可被动接收通知。
- 本数据中所有事件均有 `emits`，不存在 `emitMissSuspect`（待确认） 标注项；亦无前端发射点（两种事件的 `emits` 均标注为 `rust`）。
- **扫描局限**：与命令一致，动态事件名（如由变量拼接的 `listen(name, ...)` / `emit(name, ...)`）不在本表内。

---

## CLI 命令

数据中 `commands` 为空，未提供任何命令行子命令、参数或说明，本页不列 CLI 章节。项目是否提供 CLI 入口**待确认**（缺 CLI 命令定义数据；`merged` 数据中 `commands` 数组为空）。

---

## 导出函数

数据提供的导出函数共 **7** 条，覆盖两条主线：前端终端渲染与建议交互（`bufferRows.ts`、`suggestions/controller.ts`），以及 Rust 侧端口转发的连接接管循环（`forward/loops.rs`）与 PTY 队列确认（`pty/queue.rs`）。另有两条 SSH/PTY 服务层的薄封装（`ackData`，`src/services/ssh.ts`）。其中有 docstring 的仅 3 条（`acceptAt`、`accept_dynamic_connection`、`accept_local_connection`），其余标注为「无 docstring」。

### 前端：终端缓冲行与建议交互

这组函数位于前端库层，承担光标行定位与命令建议的接受（补全/执行）动作，是交互中最贴近用户输入的两个环节。

| 函数名 | 签名 | 说明 | 源文件:行号 |
|---|---|---|---|
| `absoluteCursorRow` | `(buffer: BufferCursorView): number` | 无 docstring；入参为 `BufferCursorView`，返回光标所在绝对行号 | `src/lib/frontends/bufferRows.ts:23` |
| `acceptAt` | `(index: number, execute: boolean): void` | 鼠标点击菜单条目的接受入口：先把目标项设为选中再接受；`index` 越界时忽略，`execute` 控制是否补换行立即执行 | `src/lib/suggestions/controller.ts:179` |
| `acceptSelected` | `(execute: boolean): Promise<void>` | 无 docstring；返回 Promise，推测为接受当前选中项，`execute` 语义与 `acceptAt` 同名参数一致 | `src/lib/suggestions/controller.ts:194` |

`acceptAt` 的 docstring 明确了两点契约：其一，调用它会先改变选中状态（「先把目标项设为选中再接受」），因此它是状态副作用式的入口而非纯查询；其二，越界下标被静默忽略而非报错。docstring 给出的示例为 `acceptAt(2, false) // 点击第 3 项 = 补全不执行`（`src/lib/suggestions/controller.ts:179`），说明 `index` 为从 0 开始的下标。`acceptSelected`（`:194`）紧接其后定义，是键盘路径对应的入口，与 `acceptAt` 共用 `execute: boolean` 参数名，两者构成「鼠标点击 / 键盘选中」双入口。

`absoluteCursorRow` 仅有签名无 docstring（`src/lib/frontends/bufferRows.ts:23`），其参数类型 `BufferCursorView` 表明依赖缓冲区视图对象，返回 `number`。

### 前端：SSH/PTY 服务层确认封装

| 函数名 | 签名 | 说明 | 源文件:行号 |
|---|---|---|---|
| `ackData` | `(length: number): void` | 无 docstring；按长度确认已消费数据，对应 `ssh_ack_data` 命令（`src/services/ssh.ts:177`） | `src/services/ssh.ts:175` |

`ackData` 定义在 `src/services/ssh.ts:175`，其后两行即 `ssh_ack_data` 的 `invoke` 调用点（`ssh.ts:177`），可确证它是该 IPC 命令的服务层薄封装；参数 `length` 与 Rust 侧 PTY 队列的 `ack(&self, length: usize)`（`src-tauri/src/pty/queue.rs:102`）参数同名同义，构成同一背压机制的前后端两端。

### Rust：端口转发连接接管

这组函数位于 `src-tauri/src/forward/loops.rs`，是端口转发生效后的每连接处理逻辑。两条函数共享相同的参数骨架（`ForwardHandle` + `SshSession` + `TcpStream`），区别在于本地转发与动态（SOCKS5）转发的接管方式，以及是否使用 `peer` 地址。

| 函数名 | 签名 | 说明 | 源文件:行号 |
|---|---|---|---|
| `accept_local_connection` | `(handle: Arc<ForwardHandle>, session: Arc<SshSession>, tcp: TcpStream, peer: SocketAddr)` | `-L`：每连接开 direct-tcpip channel 后双向搬运（单连接失败仅断该连接） | `src-tauri/src/forward/loops.rs:95` |
| `accept_dynamic_connection` | `(handle: Arc<ForwardHandle>, session: Arc<SshSession>, tcp: TcpStream, _peer: SocketAddr)` | `-D`：SOCKS5 no-auth 握手 → CONNECT 目标接管为 direct-tcpip channel → 双向搬运 | `src-tauri/src/forward/loops.rs:115` |

两者的 docstring 直接标注了对应的转发模式（`-L` / `-D`），是本项目中动机与语义证据最充分的两条函数。`accept_local_connection`（`:95`）的 docstring 还明确了失败隔离策略：「单连接失败仅断该连接」。`accept_dynamic_connection`（`:115`）的第四参数为 `_peer`（下划线前缀），与 `accept_local_connection` 的 `peer` 形成对照——动态转发路径不使用对端地址，这是签名层面的可证事实。

两者在 `loops.rs` 中相距 20 行（`:95` → `:115`），顺序为本地在前后动态在后。Rust 侧同样存在一对 `accept_*` 函数的事实，与命令层 `forward_start`（`src-tauri/src/forward/mod.rs:317`）所在的同一 `forward` 模块共同构成转发功能域：命令启停转发、`loops.rs` 逐连接接管

---

### Rust：PTY 数据队列确认

| 函数名 | 签名 | 说明 | 源文件:行号 |
|---|---|---|---|
| `ack` | `(&self, length: usize): void` | 无 docstring；按 `length` 确认已消费的数据量 | `src-tauri/src/pty/queue.rs:102` |

`ack` 是 `src-tauri/src/pty/queue.rs` 中带 `&self` 的方法，参数 `length: usize`。它与 `pty_ack_data`（`src-tauri/src/pty/mod.rs:310`）及前端 `ackData`（`src/services/ssh.ts:175`）在参数名与语义上一致，构成「前端确认 → IPC 命令 → 队列方法」的完整链路。

---

## 框架节点

数据中 `frameworkNodes` 为空，未检出 Controller、Router 等框架级节点。本项目的对外接口不含框架路由层：前端以模块化服务函数直接调用 IPC（如 `src/services/*.ts`），Rust 侧以 `#[tauri::command]`（由 `rustDef` 位置推知）注册命令，两侧均无中间路由注册表数据。**待确认**：命令注册清单（`invoke_handler` 的 `generate_handler!` 列表）未在数据中给出，无法确认是否存在已定义但未注册的孤岛命令。

---

## 补充符号

数据中 `supplementalSymbols` 为空，无补充说明。

---

## 数据缺口汇总

| 缺口项 | 缺什么证据 | 影响 |
|---|---|---|
| `forward_list` 与 `forward_list_all` 的语义差异 | 缺参数与返回定义 | 无法说明两者的过滤维度 |
| 命令注册清单 | 缺 `invoke_handler` / `generate_handler!` 数据 | 无法判断已定义命令是否全部注册可用 |
| 命令参数与返回值 schema | 数据仅含名称级锚点 | 无法给出逐命令的参数说明与返回值结构 |
| CLI 入口 | `commands` 为空 | 不列 CLI 章节，是否提供 CLI 待确认 |
| 事件 payload 结构 | 数据仅含事件名与发射/监听点 | 无法说明事件负载字段 |

以上 5 项为影响接口使用决策的关键缺口；命令各自的参数说明均受限于第 3 项，故各分组仅描述协作关系而不给出参数表。
## Related

- 同目录：[components.md](components.md) · [state.md](state.md) · [routing.md](routing.md)
- 共享 15 个源文件、共享 40 个符号：[calls.md](../07-reference/calls.md)
- 共享 3 个源文件、共享 15 个符号：[architecture.md](../02-architecture/architecture.md)
- 共享 3 个源文件、共享 9 个符号：[glossary.md](../07-reference/glossary.md)
- 总入口：[README](../README.md)
