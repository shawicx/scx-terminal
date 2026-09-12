# 命令注册、配置与 shell 探测

## 命令注册（`src-tauri/src/lib.rs`）

`invoke_handler` 注册 **11 个命令**：`pty_spawn`、`pty_write`、`pty_resize`、`pty_kill`、`pty_ack_data`、`pty_exists`（pty.rs）；`list_shells`（shells.rs）；`config_load`、`config_save`、`config_dir_path`（config.rs）；`dev_log`（lib.rs，前端 console 转发到 `tauri dev` 终端）。

插件：`tauri_plugin_opener`（打开路径/显示于访达）、`tauri_plugin_clipboard_manager`。状态：`.manage(pty::PtyManager::new())`。

setup 阶段：`app.remove_menu()`（快捷键归 webview，且防止 ⌘W 直接关窗）；vibrancy 代码被 `#[cfg(any())]` 关闭；debug 构建且环境变量 `SCX_DEVTOOLS` 存在时打开 WebView devtools。

契约细节（参数名/类型/异步标记）见 [05-reference/ipc-reference](../05-reference/ipc-reference.md)。

## 配置读写（`src-tauri/src/config.rs`）

- 文件：`~/Library/Application Support/scx-terminal/config.yaml`（`config_dir` 用 `tauri::path::app_config_dir`）。
- `config_load` 返回文件原始字符串（前端解析与深合并，见 [02-frontend/config-and-theming](../02-frontend/config-and-theming.md)）；`config_save(content)` 原子写（临时文件 + rename）并维护 `.backup` 备份；`config_dir_path` 供设置页"打开配置目录"（opener 插件）。
- Rust 侧不理解配置内容——**前端是配置 schema 的唯一所有者**，YAML 手编后重启即生效（未知键会被前端丢弃）。

## shell 探测（`src-tauri/src/shells.rs` `list_shells`）

- 解析 `/etc/shells`，逐行生成 `ShellInfo`；与 `$SHELL` 匹配的条目标记 `default`。
- `$SHELL` 不在列表时前置插入；解析失败回退 `/bin/sh`。
- `args` 恒为空 → shell 以**交互非登录**方式运行（`~/.zshrc` 会加载，`~/.zprofile` 不会；PATH 继承自 GUI 应用环境）。
- 前端 `defaultShell()`（`src/services/shells.ts`）取 `default` 条目传给 `session.start`。目前无 profile/参数机制（无 UI 选择 shell）。

## Related

- [pty-lifecycle](pty-lifecycle.md)
- [02-frontend/config-and-theming](../02-frontend/config-and-theming.md)
- [03-backend/capabilities-and-window](capabilities-and-window.md)
