# IPC 契约总表（前端 ↔ Rust）

注册处：`src-tauri/src/lib.rs` `invoke_handler`。前端调用方：`src/services/pty.ts`（pty_*）、`src/services/ssh.ts`（ssh_*）、`src/services/secrets.ts`（key_*/cred_*）、`src/services/shells.ts`（list_shells）、`src/services/fonts.ts`（list_fonts）、`src/stores/config.ts`（config_*）、`src/main.ts` 与 `SettingsView.vue`（dev_log / config_dir_path / opener 插件）。

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
| `ssh_confirm_host_key` | JS→Rust | `id`、`accepted: bool` | `()` | sync | 应答 `ssh:{id}:hostkey` 事件（oneshot） |
| `pty_spawn` | JS→Rust | `options: SpawnOptions`（camelCase：file/args/env/cwd/cols/rows）、`channel: Channel` | `string`（会话 id，UUID） | **async**（线程池） | 建会话；输出经 channel 二进制流回传 |
| `pty_write` | JS→Rust | `id: string`、`data: number[]`（字节） | `()` 或错误 | **async** | 写 master；前端吞掉错误（会话可能已退出） |
| `pty_resize` | JS→Rust | `id`、`cols: u16`、`rows: u16` | `()` | sync | ioctl resize |
| `pty_kill` | JS→Rust | `id` | `()` | **async** | drop writer（EOF/SIGHUP）+ killer 信号 |
| `pty_ack_data` | JS→Rust | `id`、`length: usize` | `()` | sync | 输出流确认，驱动背压 |
| `pty_exists` | JS→Rust | `id` | `bool` | sync | 存在且未退出 |
| `pty_get_cwd` | JS→Rust | `id` | `Option<string>` | sync | 进程探测读 shell 子进程当前工作目录（`proc_cwd.rs` FFI `PROC_PIDVNODEPATHINFO`；pid 在 spawn 时拆出存 `Pty.pid`——child 锁被清理线程 wait() 持有，事后不可取） |
| `list_shells` | JS→Rust | 无 | `ShellInfo[]`（path/name/default/args） | sync | 解析 `/etc/shells` |
| `list_fonts` | JS→Rust | 无 | `Vec<String>`（字体族名，去重排序） | sync | `font-loader` 枚举系统字体（macOS CoreText）；失败前端回退自由文本输入 |
| `config_load` | JS→Rust | 无 | `string`（YAML 原文，可空） | sync | 读配置文件 |
| `config_save` | JS→Rust | `content: string` | `()` | sync | 原子写 + `.backup` |
| `config_dir_path` | JS→Rust | 无 | `string` | sync | 配置目录绝对路径 |
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
| `ssh:{id}:close` | （预留，当前不发） | — |

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
