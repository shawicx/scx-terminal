# IPC 契约总表（前端 ↔ Rust）

注册处：`src-tauri/src/lib.rs` `invoke_handler`。前端调用方：`src/services/pty.ts`（pty_*）、`src/services/ssh.ts`（ssh_*）、`src/services/secrets.ts`（key_*/cred_*）、`src/services/sftp.ts`（sftp_*）、`src/services/forward.ts`（forward_*）、`src/services/history.ts`（history_*）、`src/services/pathCompletion.ts`（fs_list_dir）、`src/components/sftp/SftpBrowserPane.vue`（fs_browse_dir/fs_home_dir）、`src/services/shells.ts`（list_shells）、`src/services/fonts.ts`（list_fonts）、`src/stores/config.ts`（config_*）、`src/main.ts` 与 `SettingsView.vue`（dev_log / config_dir_path / opener 插件）。

## invoke 命令

| 命令 | 方向 | 参数 | 返回 | 执行方式 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `ssh_connect` | JS→Rust | `options: SshConnectOptions`（camelCase：**id（前端生成）**/**profileId**/host/port/user/auth/**keyId**/cols/rows）、`dataChannel: Channel`、`secrets: State<SecretsState>` | `()` | **async** | 连接 + TOFU 指纹 + 认证（私钥/口令/密码按 id 从加密库解密，明文不经前端）+ PTY/shell；指纹确认期间挂起等待 `ssh_confirm_host_key` |
| `key_generate` | JS→Rust | `options`（id/name/algorithm/passphrase?/comment?） | `SshKeyMeta` | sync | 生成 ed25519/rsa，私钥（可选口令加密）AES-GCM 加密入库 |
| `key_import` | JS→Rust | `options`（id/name/**content**/passphrase?/comment?） | `SshKeyMeta` | sync | 导入私钥内容（File API 无路径），`decode_secret_key` 验证后加密入库 |
| `key_list` | JS→Rust | 无 | `SshKeyMeta[]` | sync | 密钥链条目元数据（私钥不出库） |
| `key_update` | JS→Rust | `options`（id/name?/comment?） | `()` | sync | 重命名/备注 |
| `key_delete` | JS→Rust | `id` | `()` | sync | 删除条目（引用档案由前端同步置空 keyId） |
| `cred_set_password` | JS→Rust | `profileId`、`password` | `()` | sync | 档案密码加密入库 |
| `cred_remove` | JS→Rust | `profileId` | `()` | sync | 清除档案密码 |
| `cred_has_password` | JS→Rust | `profileId` | `bool` | sync | 查询密码状态（不返回内容） |
| `ssh_write` | JS→Rust | `id`、`data: number[]` | `()` 或错误 | **async** | `channel.data_bytes` 写远端 |
| `ssh_resize` | JS→Rust | `id`、`cols: u32`、`rows: u32` | `()` 或错误 | **async** | `window_change` |
| `ssh_kill` | JS→Rust | `id` | `()` 或错误 | **async** | 关 channel + `disconnect` + 停队列 |
| `ssh_ack_data` | JS→Rust | `id`、`length: usize` | `()` | sync | 背压恢复（语义同 pty_ack_data） |
| `ssh_confirm_host_key` | JS→Rust | `id`、`accepted: bool` | `()` | sync | 应答 `ssh:{id}:hostkey` 事件（oneshot；Rust 侧等待上限 120s，超时视为拒绝） |
| `ssh_respond_kbd` | JS→Rust | `id`、`responses: Option<Vec<String>>`（None = 用户取消） | `()` | sync | 应答 `ssh:{id}:kbdchallenge` 事件（每轮一个 oneshot；等待上限 300s） |
| `sftp_open` | JS→Rust | `sshId` | `{id, home}` | **async** | 同连接开第二 channel 跑 `sftp` subsystem（russh-sftp 3.0）；`SshSession.open_sftp_channel()` 封装 |
| `sftp_read_dir` | JS→Rust | `id`、`path` | `FileEntry[]` | **async** | readdir 一次拿全元数据（size/mtime/isDir），目录优先排序 |
| `sftp_mkdir` / `sftp_rename` / `sftp_remove_file` / `sftp_remove_dir` | JS→Rust | `id` + 路径参数 | `()` | **async** | 文件管理 |
| `sftp_download` / `sftp_upload` | JS→Rust | `id`（sftp 会话）、remotePath/localPath | `string`（传输任务 id） | **async** | TransferManager 后台任务（目录递归聚合为单任务、AtomicBool 取消）；进度经全局事件 `sftp-transfers-changed` 全量快照推送，终态历史保留 100 条 |
| `sftp_transfers` | JS→Rust | `sshId?`（过滤指定连接） | `TransferSnapshot[]` | sync | 传输任务快照列表（含历史） |
| `sftp_transfer_cancel` / `sftp_transfers_clear` | JS→Rust | `id` / `sshId?` | `()` 或错误 / `()` | sync | 取消活动任务 / 清空终态历史 |
| `sftp_close` | JS→Rust | `id` | `()` | **async** | 关会话（面板关闭/会话退出时调用） |
| `forward_start` | JS→Rust | `options: ForwardOptions`（camelCase：**sshId**/kind=local\|remote\|dynamic/**listenHost**/**listenPort**（0=自动分配并回填）/targetHost?/targetPort?/ruleId?） | `ForwardState` | **async** | 端口转发：-L 本地 TcpListener→direct-tcpip；-R `tcpip_forward` 请求 server 监听（入站 channel 经 `ScxHandler::server_channel_open_forwarded_tcpip` 按端口路由）；-D fast-socks5 no-auth CONNECT→direct-tcpip；监听失败/连接不存在同步报错 |
| `forward_stop` | JS→Rust | `id` | `()` | **async** | 停止转发（-R 先 `cancel_tcpip_forward`）；监听器与数据泵任务统一 abort |
| `forward_list` | JS→Rust | `sshId` | `ForwardState[]` | sync | 该连接全部转发状态（面板打开时全量拉取；连接不存在返回空数组） |
| `forward_list_all` | JS→Rust | 无 | `ForwardState[]` | sync | 全部连接的转发状态（隧道管理器页总览） |
| `history_record` | JS→Rust | `source`（分桶键 local:{profileId} / ssh:{user}@{host}:{port}）、`command` | `()` 或错误 | sync | 记录命令到独立 history.db（去重提升） |
| `history_list` / `history_import` / `history_clear` | JS→Rust | `source?`、`limit?` / `source`、`entries` / `source?` | `HistoryEntry[]` / `usize` / `()` | sync | 建议历史读取 / shell 历史批量导入（幂等）/ 清空（连带清 imported 标记） |
| `fs_list_dir` | JS→Rust | `path`（~ 展开） | `FsDirEntry[]`（name/isDir） | sync | 路径补全列目录（错误静默空数组；**点文件全量返回**，可见性由前端引擎按补全前缀决定） |
| `fs_read_text_file` | JS→Rust | `path` | `string \| null` | sync | 读文本文件（shell 历史导入源；不存在返回 null） |
| `fs_browse_dir` / `fs_home_dir` | JS→Rust | `path`、`showHidden` / 无 | `FsBrowseEntry[]` / `string` | sync | SFTP 本地栏目录浏览（含 size/mtime，错误显式传播）/ 本地家目录 |
| `background_image_set` | JS→Rust | `path: Option<String>`（None = 清除） | `Option<String>`（文件名）或错误 | sync | 终端背景图设置：扩展白名单 png/jpg/jpeg/webp/gif/bmp、≤20MB，覆盖式复制进 `app_data_dir/backgrounds/` |
| `background_image_load` | JS→Rust | 无 | `Option<Vec<u8>>` | sync | 读当前背景图 bytes（未设置/缺失 None，前端降级无图） |
| `pty_spawn` | JS→Rust | `options: SpawnOptions`（camelCase：file/args/env/cwd/cols/rows）、`channel: Channel` | `string`（会话 id，UUID） | **async**（线程池） | 建会话；输出经 channel 二进制流回传 |
| `pty_write` | JS→Rust | `id: string`、`data: number[]`（字节） | `()` 或错误 | **async** | 写 master；前端吞掉错误（会话可能已退出） |
| `pty_resize` | JS→Rust | `id`、`cols: u16`、`rows: u16` | `()` | sync | ioctl resize |
| `pty_kill` | JS→Rust | `id` | `()` | **async** | drop writer（EOF/SIGHUP）+ killer 信号 |
| `pty_ack_data` | JS→Rust | `id`、`length: usize` | `()` | sync | 输出流确认，驱动背压 |
| `pty_exists` | JS→Rust | `id` | `bool` | sync | 存在且未退出 |
| `pty_get_cwd` | JS→Rust | `id` | `Option<string>` | sync | 进程探测读 shell 子进程当前工作目录（`proc_cwd.rs` FFI `PROC_PIDVNODEPATHINFO`；pid 在 spawn 时拆出存 `Pty.pid`——child 锁被清理线程 wait() 持有，事后不可取） |
| `list_shells` | JS→Rust | 无 | `ShellInfo[]`（path/name/default/args） | sync | 解析 `/etc/shells` |
| `list_fonts` | JS→Rust | 无 | `Vec<String>`（字体族名，去重排序） | sync | `font-loader` 枚举系统字体（macOS CoreText）；失败前端回退自由文本输入 |
| `config_load` | JS→Rust | 无 | `ConfigSnapshot \| null`（terminal/appearance/hotkeys/profiles/colorSchemes/quickCommands/quickCommandGroups；null = 全新库未写过） | sync | 聚合读全量配置（config.db） |
| `config_load_legacy_yaml` | JS→Rust | 无 | `string \| null` | sync | 读旧版 `config.yaml` 原文（一次性迁移源，不存在返回 null） |
| `config_archive_legacy_yaml` | JS→Rust | 无 | `bool`（是否执行了改名） | sync | 旧 config.yaml → `config.yaml.migrated` |
| `config_dir_path` | JS→Rust | 无 | `string` | sync | `app_data_dir` 绝对路径（config.db/secrets.db 所在） |
| `settings_set_section` | JS→Rust | `key`（terminal\|appearance）、`value` | `()` | sync | upsert 设置分片 JSON（key 白名单校验） |
| `hotkey_set` | JS→Rust | `action`、`bindings` | `()` | sync | upsert 单个热键绑定 |
| `profile_create` / `profile_update` / `profile_delete` | JS→Rust | `profile`（完整 JSON）/ `id` | `()` | sync | 档案增改删；create 缺 id、update 目标不存在报错；delete 幂等 |
| `quick_command_create` / `quick_command_update` / `quick_command_delete` | JS→Rust | `command`（id/name/command/groupId?/autoRun）/ `id` | `()` | sync | 快捷命令增改删；update 保留 sort_order；delete 幂等 |
| `quick_command_group_create` / `quick_command_group_update` / `quick_command_group_delete` | JS→Rust | `group`（id/name）/ `id` | `()` | sync | 分组增改删；delete 同事务把组内命令降级未分组 |
| `ssh_group_create` / `ssh_group_update` / `ssh_group_delete` | JS→Rust | `group`（id/name）/ `id` | `()` | sync | SSH 分组增改删；delete 同事务把组内档案的 data JSON 移除 groupId |
| `color_scheme_save` / `color_scheme_delete` | JS→Rust | `name`、`data` / `name` | `()` | sync | 自定义配色按 name upsert / 删（delete 幂等） |
| `dev_log` | JS→Rust | `message: string` | `()` | sync | 前端日志转发到 stdout |

类型映射注意：JS `number[]` ↔ Rust `Vec<u8>`；`SpawnOptions` 用 `#[serde(rename_all = "camelCase")]`；id 两侧都是字符串。

插件命令（经 capability 授权）：设置页用 `@tauri-apps/plugin-opener` 的 `openPath`（底层 `plugin:opener|open_path`，capabilities 中需带 `$APPDATA` 路径 scope——裸权限无 scope 时所有路径都会被插件拒绝）、链接打开用 `openUrl`；剪贴板 `readText/writeText`（`@tauri-apps/plugin-clipboard-manager`）。

## 事件（Rust → JS，`listen`）

| 事件名 | payload | 触发 |
| --- | --- | --- |
| `pty:{id}:close` | `()` | 读线程 EOF/错误，master 关闭 |
| `pty:{id}:exit` | 退出码 JSON 或 `null` | 子进程 wait 返回 |
| `ssh:{id}:exit` | `null` | SSH channel Eof/Close（输出泵末尾发出） |
| `ssh:{id}:hostkey` | `{fingerprint, keyType, changed}` | KEX 后 TOFU 校验：未知/失配时发出，**前端必须在 invoke 前注册监听**（connect 挂起等应答，事后注册=事件丢失死锁） |
| `ssh:{id}:kbdchallenge` | `{name, instructions, prompts: [{prompt, echo}]}` | kbd-interactive 每轮挑战（oneshot 应答经 `ssh_respond_kbd`；headless 连接经全局 `pendingKbdChallenge` 弹窗） |
| `ssh:{id}:close` | （预留，当前不发） | — |
| `forward:{sshId}:changed` | `ForwardState[]`（该连接完整快照，按 id 排序） | 转发启停/失败/端口回填时发出；SSH 会话断开（exit 路径）级联停止全部转发后发空快照 |
| `sftp-transfers-changed` | `TransferSnapshot[]`（app 级全量快照） | 传输任务进度节流推送/终态变更（传输中心消费；速度=相邻快照差 EMA） |

## 数据通道（非事件、非普通 invoke 返回）

- **输出**：`pty_spawn` / `ssh_connect` 时传入的 `tauri::ipc::Channel`，Rust 以 `InvokeResponseBody::Raw(Vec<u8>)` 直发二进制块（≤100KB，UTF-8 安全切分；SSH 复用 pty 的 `PtyDataQueue`）；JS 端 `channel.onmessage` 收 `ArrayBuffer`/`number[]`。每块必须 `pty_ack_data` / `ssh_ack_data(len)` 确认——未确认累计 >500KB 时 Rust 暂停读取（内核反压子进程 / russh channel）。
- **输入**：普通 `pty_write` / `ssh_write`（JSON number[]），无流控。

## 前端时序约束（改动 IPC 前必读）

1. `channel.onmessage` 在 `pty_spawn` 之前安装，但 `LocalSession` 的 `data` 订阅在 spawn+listen 往返之后——空窗期输出由 `TauriPTYProxy.pendingChunks` 缓冲并在首次订阅时回放。
2. 事件名模板是 `` `pty:${id}:exit` ``——id 拼接，改事件名需同时改 `src/services/pty.ts` 与 `src-tauri/src/pty.rs` 两处。
3. `pty_spawn/pty_write/pty_kill` 必须保持 async 命令（阻塞 IO 不上主线程），见 [03-backend/pty-lifecycle](../03-backend/pty-lifecycle.md)。

## Related

- [03-backend/pty-lifecycle](../03-backend/pty-lifecycle.md)
- [02-frontend/sessions-and-middleware](../02-frontend/sessions-and-middleware.md)
- [03-backend/capabilities-and-window](../03-backend/capabilities-and-window.md)
