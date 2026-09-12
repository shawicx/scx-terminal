# IPC 契约总表（前端 ↔ Rust）

注册处：`src-tauri/src/lib.rs` `invoke_handler`。前端调用方：`src/services/pty.ts`（pty_*）、`src/services/shells.ts`（list_shells）、`src/stores/config.ts`（config_*）、`src/main.ts` 与 `SettingsView.vue`（dev_log / config_dir_path / opener 插件）。

## invoke 命令

| 命令 | 方向 | 参数 | 返回 | 执行方式 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `pty_spawn` | JS→Rust | `options: SpawnOptions`（camelCase：file/args/env/cwd/cols/rows）、`channel: Channel` | `string`（会话 id，UUID） | **async**（线程池） | 建会话；输出经 channel 二进制流回传 |
| `pty_write` | JS→Rust | `id: string`、`data: number[]`（字节） | `()` 或错误 | **async** | 写 master；前端吞掉错误（会话可能已退出） |
| `pty_resize` | JS→Rust | `id`、`cols: u16`、`rows: u16` | `()` | sync | ioctl resize |
| `pty_kill` | JS→Rust | `id` | `()` | **async** | drop writer（EOF/SIGHUP）+ killer 信号 |
| `pty_ack_data` | JS→Rust | `id`、`length: usize` | `()` | sync | 输出流确认，驱动背压 |
| `pty_exists` | JS→Rust | `id` | `bool` | sync | 存在且未退出 |
| `list_shells` | JS→Rust | 无 | `ShellInfo[]`（path/name/default/args） | sync | 解析 `/etc/shells` |
| `config_load` | JS→Rust | 无 | `string`（YAML 原文，可空） | sync | 读配置文件 |
| `config_save` | JS→Rust | `content: string` | `()` | sync | 原子写 + `.backup` |
| `config_dir_path` | JS→Rust | 无 | `string` | sync | 配置目录绝对路径 |
| `dev_log` | JS→Rust | `message: string` | `()` | sync | 前端日志转发到 stdout |

类型映射注意：JS `number[]` ↔ Rust `Vec<u8>`；`SpawnOptions` 用 `#[serde(rename_all = "camelCase")]`；id 两侧都是字符串。

插件命令（经 capability 授权）：`plugin:opener|open_path` / `plugin:opener|reveal_item_in_dir`（设置页打开配置目录）；剪贴板 `readText/writeText`（`@tauri-apps/plugin-clipboard-manager`）。

## 事件（Rust → JS，`listen`）

| 事件名 | payload | 触发 |
| --- | --- | --- |
| `pty:{id}:close` | `()` | 读线程 EOF/错误，master 关闭 |
| `pty:{id}:exit` | 退出码 JSON 或 `null` | 子进程 wait 返回 |

## 数据通道（非事件、非普通 invoke 返回）

- **输出**：`pty_spawn` 时传入的 `tauri::ipc::Channel`，Rust 以 `InvokeResponseBody::Raw(Vec<u8>)` 直发二进制块（≤100KB，UTF-8 安全切分）；JS 端 `channel.onmessage` 收 `ArrayBuffer`/`number[]`。每块必须 `pty_ack_data(len)` 确认——未确认累计 >500KB 时 Rust 暂停读取（内核反压子进程）。
- **输入**：普通 `pty_write`（JSON number[]），无流控。

## 前端时序约束（改动 IPC 前必读）

1. `channel.onmessage` 在 `pty_spawn` 之前安装，但 `LocalSession` 的 `data` 订阅在 spawn+listen 往返之后——空窗期输出由 `TauriPTYProxy.pendingChunks` 缓冲并在首次订阅时回放。
2. 事件名模板是 `` `pty:${id}:exit` ``——id 拼接，改事件名需同时改 `src/services/pty.ts` 与 `src-tauri/src/pty.rs` 两处。
3. `pty_spawn/pty_write/pty_kill` 必须保持 async 命令（阻塞 IO 不上主线程），见 [03-backend/pty-lifecycle](../03-backend/pty-lifecycle.md)。

## Related

- [03-backend/pty-lifecycle](../03-backend/pty-lifecycle.md)
- [02-frontend/sessions-and-middleware](../02-frontend/sessions-and-middleware.md)
- [03-backend/capabilities-and-window](../03-backend/capabilities-and-window.md)
