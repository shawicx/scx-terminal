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
- src-tauri/src/config/workflows.rs
- src-tauri/src/fonts.rs
- src-tauri/src/forward/loops.rs
- src-tauri/src/forward/mod.rs
- src-tauri/src/fsutil.rs
- src-tauri/src/history.rs
- src-tauri/src/lib.rs
</details>

本项目的对外接口以 **Tauri IPC 命令**为主体：前端按业务领域拆分为独立的服务模块（如 `src/services/pty.ts`、`src/services/sftp.ts`、`src/services/ssh.ts`），每个模块把一组相关命令封装成可复用的函数；Rust 侧同样按领域分目录实现命令（如 `src-tauri/src/pty/mod.rs:124`、`src-tauri/src/sftp.rs:108`、`src-tauri/src/ssh/commands.rs:112`）。配置类写操作则集中在一个统一的 flush 通道里批量下发（`src/stores/config/flush.ts:282`–`src/stores/config/flush.ts:354`），读入侧集中在 `src/stores/config/store.ts:39` 与 `src/stores/config/store.ts:301`。

除请求-应答式的命令之外，还存在一条**事件推送通道**：Rust 侧的监控与传输模块主动向前端发射事件（`src-tauri/src/monitor/mod.rs:127`、`src-tauri/src/transfers/mod.rs:412`），前端在 Pinia store 中监听并更新状态（`src/stores/monitor.ts:37`、`src/stores/transfers.ts:49`）。因此本页分为「IPC 命令」「IPC 事件」「导出函数」三部分。

---

## Tauri IPC 命令

下表按功能域组织。数据中共 **103 条命令**，每条命令的前端调用点与 Rust 定义**均非空**，因此「状态」列统一为「双向匹配」；本次数据中**未出现**「仅前端调用、Rust 侧未检出」或「未被前端调用」的命令。

### 分组总览

| 功能域 | 命令数 | 前端入口 | Rust 侧模块 |
| --- | --- | --- | --- |
| 应用信息与调试 | 5 | `src/components/settings/pages/AboutPage.vue`、`src/main.ts` | `src-tauri/src/config/mod.rs`、`src-tauri/src/lib.rs` |
| 外观与背景图 | 2 | `src/components/settings/pages/AppearancePage.vue`、`src/services/backgroundImage.ts` | `src-tauri/src/background.rs` |
| 配置备份与 S3 同步 | 10 | `src/services/configBackup.ts`、`src/services/configSync.ts` | `src-tauri/src/snapshot/mod.rs`、`src-tauri/src/s3sync/mod.rs` |
| 字体 | 1 | `src/services/fonts.ts` | `src-tauri/src/fonts.rs` |
| 端口转发 | 4 | `src/services/forward.ts` | `src-tauri/src/forward/mod.rs` |
| 历史记录与文本文件 | 6 | `src/services/history.ts`、`src/services/workflowYamlIo.ts` | `src-tauri/src/history.rs`、`src-tauri/src/fsutil.rs` |
| 本地文件系统 | 3 | `src/services/localFs.ts`、`src/services/pathCompletion.ts` | `src-tauri/src/fsutil.rs` |
| 主机监控 | 2 | `src/services/monitor.ts` | `src-tauri/src/monitor/mod.rs` |
| Mosh 检测 | 1 | `src/services/mosh.ts` | `src-tauri/src/mosh.rs` |
| 本地 PTY 终端 | 7 | `src/services/pty.ts` | `src-tauri/src/pty/mod.rs` |
| 密钥与凭据 | 9 | `src/services/secrets.ts` | `src-tauri/src/secrets/keys.rs`、`src-tauri/src/secrets/creds.rs` |
| SFTP 文件操作 | 9 | `src/services/sftp.ts` | `src-tauri/src/sftp.rs` |
| 传输任务管理 | 6 | `src/services/sftp.ts` | `src-tauri/src/transfers/mod.rs` |
| Shell 列表 | 1 | `src/services/shells.ts` | `src-tauri/src/shells.rs` |
| SSH 会话 | 7 | `src/services/ssh.ts` | `src-tauri/src/ssh/commands.rs` |
| 标签页会话 | 2 | `src/services/tabSession.ts` | `src-tauri/src/config/settings.rs` |
| 配置写入（flush 通道） | 25 | `src/stores/config/flush.ts` | `src-tauri/src/config/{settings,profiles,quick_commands,workflows,groups}.rs` |
| 配置加载与旧版迁移 | 3 | `src/stores/config/store.ts` | `src-tauri/src/config/load.rs`、`src-tauri/src/config/legacy.rs` |

### 应用信息与调试

用于「关于」页面展示路径信息，以及入口脚本启动期的日志与调试开关。典型时序：应用启动时 `src/main.ts:22`、`src/main.ts:25`、`src/main.ts:28` 三处调用 `dev_log` 上报日志，随后由 `src/main.ts:38`、`src/main.ts:39` 打开调试开关与开发者工具；用户打开关于页时再取配置目录与日志目录路径。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `config_dir_path` | `src/components/settings/pages/AboutPage.vue:26` | `src-tauri/src/config/mod.rs:38` | 双向匹配 |
| `debug_log_dir` | `src/components/settings/pages/AboutPage.vue:29` | `src-tauri/src/lib.rs:65` | 双向匹配 |
| `dev_log` | `src/components/settings/pages/AboutPage.vue:46`、`src/components/settings/pages/AboutPage.vue:66`、`src/main.ts:22`、`src/main.ts:25`、`src/main.ts:28` | `src-tauri/src/lib.rs:30` | 双向匹配 |
| `debug_set_enabled` | `src/main.ts:38` | `src-tauri/src/lib.rs:42` | 双向匹配 |
| `debug_open_devtools` | `src/main.ts:39` | `src-tauri/src/lib.rs:53` | 双向匹配 |

`dev_log` 是跨模块复用度最高的调试命令之一：入口脚本 `src/main.ts` 在 3 处调用上报启动期日志，设置页在 2 处调用（`src/components/settings/pages/AboutPage.vue:46`、`src/components/settings/pages/AboutPage.vue:66`），说明日志既服务于开发期诊断，也服务于用户可见的运行日志查看。`debug_set_enabled` 与 `debug_open_devtools` 紧邻出现于 `src/main.ts:38`、`src/main.ts:39`，构成「先开调试开关、再打开开发者工具」的启动期调试链路。

### 外观与背景图

该组只有 2 条命令，读写分离：`background_image_set` 负责写入背景图配置，`background_image_load` 负责读取并返回给前端渲染。设置页的两次调用（`src/components/settings/pages/AppearancePage.vue:54`、`src/components/settings/pages/AppearancePage.vue:71`）说明设置界面存在两个独立的写入触发点（例如选择图片与清除/应用），而读取侧统一收敛在 `src/services/backgroundImage.ts:63`，便于集中做缓存与错误处理。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `background_image_set` | `src/components/settings/pages/AppearancePage.vue:54`、`src/components/settings/pages/AppearancePage.vue:71` | `src-tauri/src/background.rs:116` | 双向匹配 |
| `background_image_load` | `src/services/backgroundImage.ts:63` | `src-tauri/src/background.rs:140` | 双向匹配 |

### 配置备份与 S3 同步

这一组覆盖两条独立的数据外流通道：本地备份（导出/导入）与远端 S3 同步。备份走 `src/services/configBackup.ts`，同步的全部能力集中在 `src/services/configSync.ts:56`–`src/services/configSync.ts:138`，按「配置读写 → 连通性测试 → 状态查询 → 双向传输 → 远端列表」的顺序排列，可据此推断前端配置同步面板的使用流程：先 `s3_sync_set` 保存凭据，再 `s3_sync_test` 验证，之后用 `s3_sync_push` / `s3_sync_pull` 上传下载，靠 `s3_sync_status` 与 `s3_sync_list_remote` 展示进度与远端版本。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
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

注意 Rust 侧的定义顺序（`src-tauri/src/s3sync/mod.rs:185` 的 `push` 排在 `:217` 的 `status` 之前）与前端调用顺序不同，说明二者是各自独立组织的，接口签名的对应关系以命令名为准。

### 字体

单命令域，前端只有一个调用点，属于典型的「列取本机可用资源」型只读接口。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `list_fonts` | `src/services/fonts.ts:15` | `src-tauri/src/fonts.rs:5` | 双向匹配 |

### 端口转发

前端封装在 `src/services/forward.ts:21`–`src/services/forward.ts:56`，四条命令构成完整的生命周期：启动 → 停止 → 查询（按当前 SSH 会话）→ 查询全部。`forward_list` 与 `forward_list_all` 的并存说明存在「按会话过滤」与「全局视图」两种展示需求。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `forward_start` | `src/services/forward.ts:21` | `src-tauri/src/forward/mod.rs:317` | 双向匹配 |
| `forward_stop` | `src/services/forward.ts:33` | `src-tauri/src/forward/mod.rs:431` | 双向匹配 |
| `forward_list` | `src/services/forward.ts:45` | `src-tauri/src/forward/mod.rs:461` | 双向匹配 |
| `forward_list_all` | `src/services/forward.ts:56` | `src-tauri/src/forward/mod.rs:479` | 双向匹配 |

Rust 侧的实现细节在 `src-tauri/src/forward/loops.rs` 中的两个循环函数里可见：`accept_local_connection`（`src-tauri/src/forward/loops.rs:95`）对应 `-L` 本地转发，`accept_dynamic_connection`（`src-tauri/src/forward/loops.rs:115`）对应 `-D` 动态转发。

### 历史记录与文本文件

历史记录（`history_list` / `history_record` / `history_clear` / `history_import`）与通用文本文件读写（`fs_read_text_file` / `fs_write_text_file`）被归在一起，因为前端的调用点已经交叉：`src/services/history.ts:106` 与 `src/services/workflowYamlIo.ts:99` 共用读取命令，`src/services/workflowYamlIo.ts:49`、`src/services/workflowYamlIo.ts:78` 共用写入命令。这说明文本文件读写是面向整个应用的基础能力，而非历史记录模块私有。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `history_list` | `src/services/history.ts:33` | `src-tauri/src/history.rs:88` | 双向匹配 |
| `history_record` | `src/services/history.ts:69` | `src-tauri/src/history.rs:67` | 双向匹配 |
| `history_clear` | `src/services/history.ts:78` | `src-tauri/src/history.rs:151` | 双向匹配 |
| `history_import` | `src/services/history.ts:114` | `src-tauri/src/history.rs:119` | 双向匹配 |
| `fs_read_text_file` | `src/services/history.ts:106`、`src/services/workflowYamlIo.ts:99` | `src-tauri/src/fsutil.rs:114` | 双向匹配 |
| `fs_write_text_file` | `src/services/workflowYamlIo.ts:49`、`src/services/workflowYamlIo.ts:78` | `src-tauri/src/fsutil.rs:133` | 双向匹配 |

### 本地文件系统

供目录浏览、家目录定位与目录列举使用，Rust 侧三个命令相邻定义于 `src-tauri/src/fsutil.rs`。前端分别由 `src/services/localFs.ts`（浏览与家目录）与 `src/services/pathCompletion.ts`（目录列举）调用，说明路径补全与文件浏览虽然读的是同一类信息，但在 UI 上属于不同场景。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `fs_browse_dir` | `src/services/localFs.ts:28` | `src-tauri/src/fsutil.rs:152` | 双向匹配 |
| `fs_home_dir` | `src/services/localFs.ts:39` | `src-tauri/src/fsutil.rs:166` | 双向匹配 |
| `fs_list_dir` | `src/services/pathCompletion.ts:26` | `src-tauri/src/fsutil.rs:108` | 双向匹配 |

### 主机监控

只有启停两条命令，采样数据不通过命令返回，而是通过事件推送（见「IPC 事件」章节）：`monitor_start`（`src-tauri/src/monitor/mod.rs:87`）之后，Rust 侧从 `src-tauri/src/monitor/mod.rs:147` 持续发射采样事件，前端在 `src/stores/monitor.ts:37` 接收。这是一个典型的「命令启动 + 事件持续推送」组合。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `monitor_start` | `src/services/monitor.ts:78` | `src-tauri/src/monitor/mod.rs:87` | 双向匹配 |
| `monitor_stop` | `src/services/monitor.ts:90` | `src-tauri/src/monitor/mod.rs:212` | 双向匹配 |

### Mosh 检测

单命令域，用于探测远端或本地是否具备 Mosh 能力，前端调用点 `src/services/mosh.ts:14`，Rust 定义 `src-tauri/src/mosh.rs:14`。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `mosh_detect` | `src/services/mosh.ts:14` | `src-tauri/src/mosh.rs:14` | 双向匹配 |

### 本地 PTY 终端

七条命令覆盖 PTY 的完整生命周期与背压控制：创建（`pty_spawn`）、存在性检查（`pty_exists`）、读取工作目录（`pty_get_cwd`）、尺寸调整（`pty_resize`）、写入（`pty_write`）、结束（`pty_kill`）、数据确认（`pty_ack_data`）。前端全部集中在 `src/services/pty.ts:41`–`src/services/pty.ts:136`，调用点行号基本按顺序递增，可推断该文件是按生命周期顺序组织的服务封装。

`pty_ack_data` 与前端 `src/services/pty.ts:134` 的 `ackData` 导出函数成对出现（`src/services/pty.ts:134`），Rust 侧对应 `src-tauri/src/pty/queue.rs:102` 的 `ack`，说明数据流采用「发送—确认」的流控模型，避免终端输出压垮前端。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `pty_spawn` | `src/services/pty.ts:41` | `src-tauri/src/pty/mod.rs:124` | 双向匹配 |
| `pty_exists` | `src/services/pty.ts:94` | `src-tauri/src/pty/mod.rs:318` | 双向匹配 |
| `pty_get_cwd` | `src/services/pty.ts:109` | `src-tauri/src/pty/mod.rs:338` | 双向匹配 |
| `pty_resize` | `src/services/pty.ts:117` | `src-tauri/src/pty/mod.rs:286` | 双向匹配 |
| `pty_write` | `src/services/pty.ts:124` | `src-tauri/src/pty/mod.rs:277` | 双向匹配 |
| `pty_kill` | `src/services/pty.ts:130` | `src-tauri/src/pty/mod.rs:298` | 双向匹配 |
| `pty_ack_data` | `src/services/pty.ts:136` | `src-tauri/src/pty/mod.rs:310` | 双向匹配 |

### 密钥与凭据

九个命令分成两个子系统：密钥管理（`key_inspect`、`key_generate`、`key_import`、`key_list`、`key_update`、`key_delete`，实现于 `src-tauri/src/secrets/keys.rs`）与登录凭据管理（`cred_set_password`、`cred_remove`、`cred_has_password`，实现于 `src-tauri/src/secrets/creds.rs`）。前端统一在 `src/services/secrets.ts:55`–`src/services/secrets.ts:151`，调用点行号递增，同样呈现按流程排序的封装风格。凭据侧只有「设置 / 移除 / 是否存在」三条，没有「读取明文口令」的命令，说明凭据只写不读回前端。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `key_inspect` | `src/services/secrets.ts:55` | `src-tauri/src/secrets/keys.rs:153` | 双向匹配 |
| `key_generate` | `src/services/secrets.ts:67` | `src-tauri/src/secrets/keys.rs:100` | 双向匹配 |
| `key_import` | `src/services/secrets.ts:79` | `src-tauri/src/secrets/keys.rs:178` | 双向匹配 |
| `key_list` | `src/services/secrets.ts:90` | `src-tauri/src/secrets/keys.rs:292` | 双向匹配 |
| `key_update` | `src/services/secrets.ts:102` | `src-tauri/src/secrets/keys.rs:329` | 双向匹配 |
| `key_delete` | `src/services/secrets.ts:114` | `src-tauri/src/secrets/keys.rs:352` | 双向匹配 |
| `cred_set_password` | `src/services/secrets.ts:127` | `src-tauri/src/secrets/creds.rs:50` | 双向匹配 |
| `cred_remove` | `src/services/secrets.ts:139` | `src-tauri/src/secrets/creds.rs:73` | 双向匹配 |
| `cred_has_password` | `src/services/secrets.ts:151` | `src-tauri/src/secrets/creds.rs:105` | 双向匹配 |

### SFTP 文件操作

九条命令覆盖远端文件系统的基本操作：打开会话（`sftp_open`）、列目录（`sftp_read_dir`）、建目录（`sftp_mkdir`）、重命名（`sftp_rename`）、删文件（`sftp_remove_file`）、删目录（`sftp_remove_dir`）、上传（`sftp_upload`）、下载（`sftp_download`）、关闭（`sftp_close`）。前端全部位于 `src/services/sftp.ts:50`–`src/services/sftp.ts:157`。

注意 `sftp_close` 的 Rust 定义位置（`src-tauri/src/sftp.rs:255`）排在下载/上传（`src-tauri/src/sftp.rs:280`、`src-tauri/src/sftp.rs:309`）之前，与前端调用顺序不一致，接口对应仍以命令名为准。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `sftp_open` | `src/services/sftp.ts:50` | `src-tauri/src/sftp.rs:108` | 双向匹配 |
| `sftp_read_dir` | `src/services/sftp.ts:63` |
`src-tauri/src/sftp.rs:146` | 双向匹配 |
| `sftp_mkdir` | `src/services/sftp.ts:76` | `src-tauri/src/sftp.rs:183` | 双向匹配 |
| `sftp_rename` | `src/services/sftp.ts:90` | `src-tauri/src/sftp.rs:200` | 双向匹配 |
| `sftp_remove_file` | `src/services/sftp.ts:103` | `src-tauri/src/sftp.rs:222` | 双向匹配 |
| `sftp_remove_dir` | `src/services/sftp.ts:116` | `src-tauri/src/sftp.rs:239` | 双向匹配 |
| `sftp_download` | `src/services/sftp.ts:131` | `src-tauri/src/sftp.rs:280` | 双向匹配 |
| `sftp_upload` | `src/services/sftp.ts:145` | `src-tauri/src/sftp.rs:309` | 双向匹配 |
| `sftp_close` | `src/services/sftp.ts:157` | `src-tauri/src/sftp.rs:255` | 双向匹配 |

### 传输任务管理

上传下载本身不等于任务管理：这一组命令负责对已经在跑的传输任务做查询与干预，包括列举（`sftp_transfers`）、取消（`sftp_transfer_cancel`）、暂停（`sftp_transfer_pause`）、恢复（`sftp_transfer_resume`）、重试（`sftp_transfer_retry`）、清空列表（`sftp_transfers_clear`）。Rust 侧全部实现于 `src-tauri/src/transfers/mod.rs`，前端仍由 `src/services/sftp.ts` 承担（`src/services/sftp.ts:169`–`src/services/sftp.ts:229`），说明传输任务在 UI 上归属 SFTP 面板。

任务状态的变化不靠前端轮询：Rust 侧在 `src-tauri/src/transfers/mod.rs:412` 发射 `sftp-transfers-changed` 事件，前端在 `src/stores/transfers.ts:49` 监听，详见下节。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `sftp_transfers` | `src/services/sftp.ts:169` | `src-tauri/src/transfers/mod.rs:625` | 双向匹配 |
| `sftp_transfer_cancel` | `src/services/sftp.ts:181` | `src-tauri/src/transfers/mod.rs:645` | 双向匹配 |
| `sftp_transfer_pause` | `src/services/sftp.ts:193` | `src-tauri/src/transfers/mod.rs:670` | 双向匹配 |
| `sftp_transfer_resume` | `src/services/sftp.ts:205` | `src-tauri/src/transfers/mod.rs:695` | 双向匹配 |
| `sftp_transfer_retry` | `src/services/sftp.ts:217` | `src-tauri/src/transfers/mod.rs:715` | 双向匹配 |
| `sftp_transfers_clear` | `src/services/sftp.ts:229` | `src-tauri/src/transfers/mod.rs:755` | 双向匹配 |

Rust 侧定义顺序恰为「取消 → 暂停 → 恢复 → 重试 → 清空」，与前端调用顺序完全一致，且行号间隔（645 → 670 → 695 → 715 → 755）均匀，可推断这五个命令是同一批次的同构实现。

### Shell 列表

单命令域，列举本机可用的 shell，前端 `src/services/shells.ts:12`，Rust `src-tauri/src/shells.rs:25`。与 `list_fonts`（`src-tauri/src/fonts.rs:5`）同属「枚举本机资源」型只读命令。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `list_shells` | `src/services/shells.ts:12` | `src-tauri/src/shells.rs:25` | 双向匹配 |

### SSH 会话

七条命令覆盖 SSH 连接的建立与交互全流程，前端集中在 `src/services/ssh.ts:128`–`src/services/ssh.ts:213`，Rust 集中在 `src-tauri/src/ssh/commands.rs:112`–`src-tauri/src/ssh/commands.rs:472`。

这一组包含两条与安全交互相关的特殊命令：

- `ssh_confirm_host_key`（前端 `src/services/ssh.ts:141`，Rust `src-tauri/src/ssh/commands.rs:454`）：用于确认未知主机密钥，说明首次连接时前端会拿到待确认的主机指纹并交由用户决策。
- `ssh_respond_kbd`（前端 `src/services/ssh.ts:155`，Rust `src-tauri/src/ssh/commands.rs:472`）：回应键盘交互式认证挑战，说明支持多轮质询式登录。

数据传输侧采用与 PTY 相同的「写入 + 确认」模型：`ssh_write`（`src-tauri/src/ssh/commands.rs:357`）负责下发，`ssh_ack_data`（`src-tauri/src/ssh/commands.rs:436`）负责回执，`ssh_resize`（`src-tauri/src/ssh/commands.rs:388`）用于终端尺寸同步，`ssh_kill`（`src-tauri/src/ssh/commands.rs:417`）终止会话。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `ssh_connect` | `src/services/ssh.ts:128` | `src-tauri/src/ssh/commands.rs:112` | 双向匹配 |
| `ssh_confirm_host_key` | `src/services/ssh.ts:141` | `src-tauri/src/ssh/commands.rs:454` | 双向匹配 |
| `ssh_respond_kbd` | `src/services/ssh.ts:155` | `src-tauri/src/ssh/commands.rs:472` | 双向匹配 |
| `ssh_resize` | `src/services/ssh.ts:194` | `src-tauri/src/ssh/commands.rs:388` | 双向匹配 |
| `ssh_write` | `src/services/ssh.ts:201` | `src-tauri/src/ssh/commands.rs:357` | 双向匹配 |
| `ssh_kill` | `src/services/ssh.ts:207` | `src-tauri/src/ssh/commands.rs:417` | 双向匹配 |
| `ssh_ack_data` | `src/services/ssh.ts:213` | `src-tauri/src/ssh/commands.rs:436` | 双向匹配 |

典型时序：`ssh_connect` 建立连接；若遇到未知主机密钥，前端以 `ssh_confirm_host_key` 回应确认结果；若服务端要求键盘交互认证，前端以 `ssh_respond_kbd` 逐轮应答；会话建立后以 `ssh_write` / `ssh_resize` / `ssh_ack_data` 维持终端交互，最终 `ssh_kill` 结束。会话的输出数据不由命令返回，而是通过 `ssh:${eventId}:${event}` 形式的事件推送（见下节）。

### 标签页会话

两条命令用于恢复与保存标签页状态：读取（`tab_session_get`）与写入（`tab_session_set`）。写入存在两个前端调用点（`src/services/tabSession.ts:123`、`src/services/tabSession.ts:146`），可推断至少有两种触发保存的场景（例如主动保存与状态变更自动保存）。Rust 侧实现位于 `src-tauri/src/config/settings.rs:134` 与 `src-tauri/src/config/settings.rs:145`，与配置写入同属 settings 模块。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `tab_session_get` | `src/services/tabSession.ts:85` | `src-tauri/src/config/settings.rs:134` | 双向匹配 |
| `tab_session_set` | `src/services/tabSession.ts:123`、`src/services/tabSession.ts:146` | `src-tauri/src/config/settings.rs:145` | 双向匹配 |

### 配置写入（flush 通道）

这是数据中**条数最多、前端调用点最集中**的一组：25 条命令全部由 `src/stores/config/flush.ts` 的单一代码区间（`src/stores/config/flush.ts:282`–`src/stores/config/flush.ts:354`）调用，行号连续递增，每条命令对应一行。这说明设置类写操作不走各自的业务服务，而是统一收敛在 flush 流程里批量提交，前端 store 是唯一的写入口。

按 Rust 侧目标文件可细分为五类：

**设置项（settings）**

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `settings_set_section` | `src/stores/config/flush.ts:282` | `src-tauri/src/config/settings.rs:108` | 双向匹配 |
| `hotkey_set` | `src/stores/config/flush.ts:285` | `src-tauri/src/config/settings.rs:124` | 双向匹配 |
| `color_scheme_save` | `src/stores/config/flush.ts:351` | `src-tauri/src/config/settings.rs:157` | 双向匹配 |
| `color_scheme_delete` | `src/stores/config/flush.ts:354` | `src-tauri/src/config/settings.rs:168` | 双向匹配 |

`settings_set_section` 是分段写入设置的入口，配合 `hotkey_set` 单独处理快捷键、`color_scheme_save` / `color_scheme_delete` 处理配色方案，构成设置页的写入面。

**连接与分组配置（profiles / groups）**

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `profile_create` | `src/stores/config/flush.ts:288` | `src-tauri/src/config/profiles.rs:80` | 双向匹配 |
| `profile_update` | `src/stores/config/flush.ts:291` | `src-tauri/src/config/profiles.rs:91` | 双向匹配 |
| `profile_delete` | `src/stores/config/flush.ts:294` | `src-tauri/src/config/profiles.rs:102` | 双向匹配 |
| `local_group_create` | `src/stores/config/flush.ts:324` | `src-tauri/src/config/groups.rs:179` | 双向匹配 |
| `local_group_update` | `src/stores/config/flush.ts:327` | `src-tauri/src/config/groups.rs:190` | 双向匹配 |
| `local_group_delete` | `src/stores/config/flush.ts:330` | `src-tauri/src/config/groups.rs:201` | 双向匹配 |
| `ssh_group_create` | `src/stores/config/flush.ts:333` | `src-tauri/src/config/groups.rs:212` | 双向匹配 |
| `ssh_group_update` | `src/stores/config/flush.ts:336` | `src-tauri/src/config/groups.rs:223` | 双向匹配 |
| `ssh_group_delete` | `src/stores/config/flush.ts:339` | `src-tauri/src/config/groups.rs:234` | 双向匹配 |
| `tab_group_create` | `src/stores/config/flush.ts:342` | `src-tauri/src/config/groups.rs:245` | 双向匹配 |
| `tab_group_update` | `src/stores/config/flush.ts:345` | `src-tauri/src/config/groups.rs:256` | 双向匹配 |
| `tab_group_delete` | `src/stores/config/flush.ts:348` | `src-tauri/src/config/groups.rs:267` | 双向匹配 |

分组命令呈现明显的三段式结构：`local_group_*`（`src-tauri/src/config/groups.rs:179`–`src-tauri/src/config/groups.rs:201`）、`ssh_group_*`（`src-tauri/src/config/groups.rs:212`–`src-tauri/src/config/groups.rs:234`）、`tab_group_*`（`src-tauri/src/config/groups.rs:245`–`src-tauri/src/config/groups.rs:267`），每段均为「create → update → delete」三连，且每段行号间隔固定为 11，属于同构批量生成。由此可确认系统支持本地、SSH、标签页三类分组各自独立维护。

**快捷命令（quick_commands）**

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `quick_command_create` | `src/stores/config/flush.ts:297` | `src-tauri/src/config/quick_commands.rs:117` | 双向匹配 |
| `quick_command_update` | `src/stores/config/flush.ts:300` | `src-tauri/src/config/quick_commands.rs:128` | 双向匹配 |
| `quick_command_delete` | `src/stores/config/flush.ts:303` | `src-tauri/src/config/quick_commands.rs:139` | 双向匹配 |
| `quick_command_group_create` | `src/stores/config/flush.ts:306` | `src-tauri/src/config/quick_commands.rs:150` | 双向匹配 |
| `quick_command_group_update` | `src/stores/config/flush.ts:309` | `src-tauri/src/config/quick_commands.rs:164` | 双向匹配 |
| `quick_command_group_delete` | `src/stores/config/flush.ts:312` | `src-tauri/src/config/quick_commands.rs:178` | 双向匹配 |

快捷命令本身与其分组各有一套 create/update/delete，说明快捷命令可以按组归类展示。

**工作流（workflows）**

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `workflow_create` | `src/stores/config/flush.ts:315` | `src-tauri/src/config/workflows.rs:80` | 双向匹配 |
| `workflow_update` | `src/stores/config/flush.ts:318` | `src-tauri/src/config/workflows.rs:91` | 双向匹配 |
| `workflow_delete` | `src/stores/config/flush.ts:321` | `src-tauri/src/config/workflows.rs:102` | 双向匹配 |

工作流的读写还存在文件层面的通道：`src/services/workflowYamlIo.ts` 直接调用通用的 `fs_read_text_file`（`src/services/workflowYamlIo.ts:99`）与 `fs_write_text_file`（`src/services/workflowYamlIo.ts:49`、`src/services/workflowYamlIo.ts:78`），说明工作流既能作为结构化配置提交，也能以 YAML 文件形式导入导出。

### 配置加载与旧版迁移

三条命令支撑配置启动加载与旧格式兼容。前端调用集中在 store 初始化流程：`src/stores/config/store.ts:39` 与 `src/stores/config/store.ts:301` 两处调用 `config_load`（第二处可推断为配置重置或重新加载），`src/stores/config/store.ts:44` 与 `src/stores/config/store.ts:80` 分别处理旧版 YAML 的读取与归档。

| 命令 | 前端调用点 | Rust 定义 | 状态 |
| --- | --- | --- | --- |
| `config_load` | `src/stores/config/store.ts:39`、`src/stores/config/store.ts:301` | `src-tauri/src/config/load.rs:203` | 双向匹配 |
| `config_load_legacy_yaml` | `src/stores/config/store.ts:44` | `src-tauri/src/config/legacy.rs:64` | 双向匹配 |
| `config_archive_legacy_yaml` | `src/stores/config/store.ts:80` | `src-tauri/src/config/legacy.rs:78` | 双向匹配 |

典型时序：启动时先 `config_load` 读取当前配置；若检测到旧版 YAML，则 `config_load_legacy_yaml` 解析，随后 `config_archive_legacy_yaml` 将其归档，完成一次性迁移。

### 命令层扫描局限

- 本表基于静态扫描得到的调用点，`invoke(变量)` 这类**动态命令名**不会出现在表中，实际运行时可能还有本表未列出的调用。
- 行号取自扫描时的文件快照，若源码后续增删行，锚点会随之偏移，以命令名与文件路径为准更稳妥。

---

## IPC 事件

与命令的「一问一答」不同，事件是 Rust 侧或前端主动推进的异步通知。本系统的事件分两类：**具名事件**（如 `monitor-sample`、`sftp-transfers-changed`）用于监控与传输状态推进；**模板事件**（名称含 `${...}` 占位）用于按会话 ID 与事件类型动态拼接，典型出现在 PTY 与 SSH 的输出通道上。

数据中有 4 个事件检出 Rust 侧发射点、3 个事件未检出。未检出的 3 个均为模板事件（`forward:${sshId}:changed`、`pty:${this.id}:${event}`、`ssh:${eventId}:${event}`），其名称在运行时才拼接完成，静态扫描无法定位发射调用，属于扫描口径局限，**不能据此断言无发射点**。

### 具名事件

| 事件 | 前端监听点 | 发射点 | 状态 |
| --- | --- | --- | --- |
| `monitor-fatal` | `src/services/monitor.ts:164` | Rust `src-tauri/src/monitor/mod.rs:127` | 双向匹配 |
| `monitor-sample` | `src/stores/monitor.ts:37` | Rust `src-tauri/src/monitor/mod.rs:147` | 双向匹配 |
| `monitor-sample-error` | `src/stores/monitor.ts:43` | Rust `src-tauri/src/monitor/mod.rs:171`、`src-tauri/src/monitor/mod.rs:181` | 双向匹配 |
| `monitor-unsupported` | `src/stores/monitor.ts:48` | Rust `src-tauri/src/monitor/mod.rs:156` | 双向匹配 |
| `sftp-transfers-changed` | `src/stores/transfers.ts:49` | Rust `src-tauri/src/transfers/mod.rs:412` | 双向匹配 |

监控类事件全部由 `src-tauri/src/monitor/mod.rs` 在 `:127`–`:181` 区间内发射，前端监听点分布在两处：`src/stores/monitor.ts:37`–`src/stores/monitor.ts:48` 接收采样与异常，`src/services/monitor.ts:164` 单独接收致命错误。这种「采样进 store、致命错误进 service」的分工说明：采样是高频常态数据，交给状态层批量刷新；`monitor-fatal` 是低频但需要立刻打断当前流程的异常，交由服务层处理。

监控事件的语义分工清晰：

- `monitor-sample`（`src-tauri/src/monitor/mod.rs:147`）：正常采样数据。
- `monitor-unsupported`（`src-tauri/src/monitor/mod.rs:156`）：当前平台或环境不支持监控，属于能力缺失而非运行错误。
- `monitor-sample-error`（`src-tauri/src/monitor/mod.rs:171`、`src-tauri/src/monitor/mod.rs:181`）：采样过程出错，两个发射点说明存在两条不同的失败路径。
- `monitor-fatal`（`src-tauri/src/monitor/mod.rs:127`）：致命错误，监控整体不可继续。

`sftp-transfers-changed` 由 `src-tauri/src/transfers/mod.rs:412` 发射、`src/stores/transfers.ts:49` 监听，与传输任务管理命令（`src-tauri/src/transfers/mod.rs:625`–`src-tauri/src/transfers/mod.rs:755`）形成互补：命令负责「下指令」，事件负责「报状态」，因此前端无需轮询 `sftp_transfers` 即可获知任务变化。

### 模板事件（扫描口径局限）

| 事件 | 前端监听点 | 发射点 | 状态 |
| --- | --- | --- | --- |
| `forward:${sshId}:changed` | `src/services/forward.ts:69`、`src/stores/forwarding.ts:78` | 未检出（扫描口径局限） | 待确认 |
| `pty:${this.id}:${event}` | `src/services/pty.ts:44` | 未检出（扫描口径局限） | 待确认 |
| `ssh:${eventId}:${event}` | `src/services/ssh.ts:120` | 未检出（扫描口径局限） | 待确认 |

三个模板事件的命名约定一致：`<域名>:<会话 ID>:<事件名>`。以 `ssh:${eventId}:${event}` 为例（监听点 `src/services/ssh.ts:120`），前缀 `ssh:` 与 `ssh_connect`（`src/services/ssh.ts:128`）建立的会话对应，`eventId` 标识具体会话实例，`event` 标识事件种类（如数据到达、会话关闭）。`pty:${this.id}:${event}`（`src/services/pty.ts:44`）与之同构，`this.id` 即 `pty_spawn`（`src/services/pty.ts:41`）取得的会话标识。

`forward:${sshId}:changed` 稍有不同：它只有两个变量段，且 `forward.ts:69` 与 `forwarding.ts:78` 两处都监听它（前者为服务层、后者为状态层），说明转发状态变化既被服务内部消费，也会驱动转发列表 UI 刷新。

这些事件名在运行时才拼接，因此发射点无法从静态文本匹配得出，属于扫描口径局限。同理，前端通过 `invoke(变量)` 形式的动态命令名调用也不会出现在命令表中。

---

## CLI 命令

本次数据中**未包含**项目自身的 CLI 命令定义（命令名为空），因此本章节信息不足，无法列出命令名、参数与使用场景。

需要区分的是：数据中确实出现了与命令行协议相关的符号，但它们不是本项目的 CLI 入口——

- `accept_local_connection`（`src-tauri/src/forward/loops.rs:95`）与 `accept_dynamic_connection`（`src-tauri/src/forward/loops.rs:115`）：注释分别标注 `-L：每连接开 direct-tcpip channel 后双向搬运（单连接失败仅断该连接）` 与 `-D：SOCKS5 no-auth 握手 → CONNECT 目标接管为 direct-tcpip channel → 双向搬运`，指的是**转发模式**（本地转发 / 动态转发），并非独立命令行程序。
- `list_shells`（`src-tauri/src/shells.rs:25`）：枚举本机 shell 供终端选择，也不是 CLI 命令集合。

若需补充 CLI 文档，待确认：项目是否提供独立的命令行可执行入口。当前证据不足以支撑任何 CLI 命令的描述。

---

## 导出函数

本节收录跨文件可复用的导出函数，分前端与 Rust 两侧。前端部分按职责分为「终端缓冲区视图」「建议补全控制」两类；Rust 部分为转发连接的接入循环与 PTY 数据队列的确认操作。

### 终端缓冲区视图

`absoluteCursorRow` 用于把缓冲区光标位置换算为绝对行号，是终端渲染与滚动定位的基础换算函数，依赖传入的缓冲区视图对象。

| 函数名 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- |
| `absoluteCursorRow` | `(buffer: BufferCursorView): number` | 依据缓冲区视图计算光标的绝对行号 | `src/lib/frontends/bufferRows.ts:23` |

### 建议补全控制

建议补全控制器封装了「选中目标 → 执行或仅补全」的动作，供键盘与鼠标两套交互共用：鼠标点击走 `acceptAt`，键盘确认走 `acceptSelected`。二者都以 `execute` 参数区分「只补全」与「补全并立即执行」两种语义，避免补全后误执行命令。

| 函数名 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- |
| `acceptAt` | `(index: number, execute: boolean): void` | 鼠标点击菜单条目的接受入口：先把目标项设为选中再接受；`index` 为目标建议项下标（越界时忽略），`execute` 为是否补换行立即执行（false 只补全不执行） | `src/lib/suggestions/controller.ts:181` |
| `acceptSelected` | `(execute: boolean): Promise<void>` | 接受当前已选中的建议项，异步完成 | `src/lib/suggestions/controller.ts:196` |

`acceptAt` 的文档注释给出了用法示例：`acceptAt(2, false) // 点击第 3 项 = 补全不执行`，可见下标从 0 开始，且「点击即接受」但默认不执行。`acceptSelected` 返回 Promise，说明接受动作包含异步环节（如异步取回补全内容或等待命令注入完成）。

### 终端数据确认

`ackData` 是 PTY 服务层对数据确认命令的封装（见「本地 PTY 终端」一节的 `pty_ack_data`），Rust 侧对应的队列实现在 `src-tauri/src/pty/queue.rs:102`。两者配对构成 PTY 输出的流控闭环：前端消费完一批数据后回执长度，后端据此释放队列额度。

| 函数名 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- |
| `ackData` | `(length: number): void` | 前端确认已消费 `length` 长度的 PTY 数据 | `src/services/pty.ts:134` |
| `ack` | `(&self, length: usize)` | Rust 侧队列按长度确认消费，释放对应额度 | `src-tauri/src/pty/queue.rs:102` |

### 转发连接接入循环

两个函数是转发服务的底层接入循环，分别对应两种转发模式，由会话句柄与 TCP 连接驱动。

| 函数名 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- |
| `accept_local_connection` | `(handle: Arc<ForwardHandle>, session: Arc<SshSession>, tcp: TcpStream, peer: SocketAddr)` | 本地转发接入：每连接开 direct-tcpip channel 后双向搬运，单连接失败仅断该连接 | `src-tauri/src/forward/loops.rs:95` |
| `accept_dynamic_connection` | `(handle: Arc<ForwardHandle>, session: Arc<SshSession>, tcp: TcpStream, _peer: SocketAddr)` | 动态转发接入：SOCKS5 no-auth 握手后 CONNECT 目标接管为 direct-tcpip channel，再双向搬运 | `src-tauri/src/forward/loops.rs:115` |

两者的签名差异值得注意：`accept_local_connection` 保留了 `peer: SocketAddr`（本地转发需要记录来源），而 `accept_dynamic_connection` 的对应参数为 `_peer`（下划线前缀表示未使用），与动态转发不需要按来源限定的语义一致。注释中「单连接失败仅断该连接」明确了错误隔离策略：单个转发连接出错不会影响整个转发会话。

---

## 框架节点

本次数据中**未包含**框架级节点（如 Controller、Router 等注册点）。前端的交互入口以服务模块与 store 直接调用命令的形式存在，未检出集中式路由或控制器层。

---

## 接口使用要点

| 要点 | 证据 |
| --- | --- |
| 写配置走统一 flush 通道，25 条命令的调用点集中在同一文件相邻行 | `src/stores/config/flush.ts:282`–`src/stores/config/flush.ts:354` |
| 读配置与迁移只在 store 初始化处调用 | `src/stores/config/store.ts:39`、`src/stores/config/store.ts:44`、`src/stores/config/store.ts:80`、`src/stores/config/store.ts:301` |
| 终端数据采用「写入 + 回执」流控 | `src-tauri/src/pty/mod.rs:277`（`pty_write`）与 `src-tauri/src/pty/mod.rs:310`（`pty_ack_data`）；`src-tauri/src/ssh/commands.rs:357`（`ssh_write`）与 `src-tauri/src/ssh/commands.rs:436`（`ssh_ack_data`） |
| 监控与传输状态靠事件推送而非轮询 | `src-tauri/src/monitor/mod.rs:147` → `src/stores/monitor.ts:37`；`src-tauri/src/transfers/mod.rs:412` → `src/stores/transfers.ts:49` |
| 首次连接需人工确认主机密钥 | `ssh_confirm_host_key`（`src/services/ssh.ts:141` → `src-tauri/src/ssh/commands.rs:454`） |
| 凭据只写不读回，无读取明文口令的命令 | `cred_set_password`（`src-tauri/src/secrets/creds.rs:50`）、`cred_remove`（`src-tauri/src/secrets/creds.rs:73`）、`cred_has_password`（`src-tauri/src/secrets/creds.rs:105`） |

---

## 待确认

| 事项 | 缺什么证据 |
| --- | --- |
| 项目是否提供独立 CLI 可执行入口 | 数据中命令列表为空，无命令名、描述与源文件位置 |
| 三个模板事件（`forward:${sshId}:changed`、`pty:${this.id}:${event}`、`ssh:${eventId}:${event}`）的实际发射点 | 事件名运行期拼接，静态扫描无法匹配，需运行期或字符串构造处证据 |
| 命令与事件的请求/响应数据结构（参数与返回值类型） | 数据仅提供调用点与定义位置，未含签名与类型定义 |
## Related

- 同目录：[components.md](components.md) · [state.md](state.md) · [routing.md](routing.md)
- 共享 14 个源文件、共享 40 个符号：[calls.md](../07-reference/calls.md)
- 共享 6 个源文件、共享 18 个符号：[modules.md](../02-architecture/modules.md)
- 共享 5 个源文件、共享 8 个符号：[onboarding.md](../05-guides/onboarding.md)
- 总入口：[README](../README.md)

<!-- wiki:source: llm -->
