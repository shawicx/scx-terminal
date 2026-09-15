# 命令注册、配置与 shell 探测

## 命令注册（`src-tauri/src/lib.rs`）

`invoke_handler` 按模块注册命令：`pty_*`（pty.rs）、`list_shells`（shells.rs）、`list_fonts`（fonts.rs）、`config_*` 等 17 个配置 CRUD 命令（config.rs，见下）、`key_*`/`cred_*`（secrets.rs）、`sftp_*`（sftp.rs）、`ssh_*`（ssh.rs）、`dev_log`（lib.rs，前端 console 转发到 `tauri dev` 终端）。契约细节见 [05-reference/ipc-reference](../05-reference/ipc-reference.md)。

插件：`tauri_plugin_opener`（打开路径/显示于访达）、`tauri_plugin_clipboard_manager`、`tauri_plugin_dialog`（SFTP 上传下载的文件选择）。状态：`.manage(pty::PtyManager::new())`、`ssh::SshManager`、`sftp::SftpManager`；`SecretsState` 与 `ConfigState` 在 setup 阶段以 `app_data_dir` 构造并 `app.manage(...)`。

setup 阶段：`app.remove_menu()`（快捷键归 webview，且防止 ⌘W 直接关窗）；vibrancy 代码被 `#[cfg(any())]` 关闭；debug 构建且环境变量 `SCX_DEVTOOLS` 存在时打开 WebView devtools。

契约细节（参数名/类型/异步标记）见 [05-reference/ipc-reference](../05-reference/ipc-reference.md)。

## 配置持久化（`src-tauri/src/config.rs`）

- 数据库：`app_data_dir/config.db`（`~/Library/Application Support/com.scx.terminal/`，与 secrets.db 同目录），rusqlite bundled + WAL，`ConfigState { conn: Mutex<Connection> }` 单连接同步命令（与 secrets.rs 同模式）。表结构经 `PRAGMA user_version` 迁移（v1 = 初始 schema）。
- 表：`settings`（terminal/appearance 分片 JSON）、`hotkeys`（action → bindings JSON）、`profiles`（id/type/name/is_default/sort_order 身份排序列 + `data` JSON 权威数据）、`color_schemes`（name + data JSON）、`quick_command_groups`、`quick_commands`（真实列）。无外键——级联由命令层事务控制（删组即把组内命令 `group_id` 置 NULL）。
- 命令面：`config_load`（聚合读全量快照，`meta.initialized` 无标记时返回 `None` = 全新库）+ 实体级 CRUD（`settings_set_section`/`hotkey_set`/`profile_create|update|delete`/`quick_command_*`/`quick_command_group_*`/`color_scheme_save|delete`）。删除幂等（diff flush 重试安全），create/update 对不存在的 id 报错。任何写事务同时维护 `meta.initialized`。
- 旧版一次性迁移：`config_load_legacy_yaml` 读旧手写目录的 `config.yaml` 原文（前端解析合并后全量落库），`config_archive_legacy_yaml` 把它改名 `config.yaml.migrated`（迁移标记 + 天然备份）。
- `config_dir_path` 返回 `app_data_dir`（设置页"打开配置目录"，opener 作用域已放行该目录）。
- Rust 侧不理解配置内容——**前端是配置 schema 的唯一所有者**；前端经深度 watch + 500ms 防抖做差异 flush，把本地 mutation 翻译成上述实体级命令（见 [02-frontend/config-and-theming](../02-frontend/config-and-theming.md)）。

## shell 探测（`src-tauri/src/shells.rs` `list_shells`）

- 解析 `/etc/shells`，逐行生成 `ShellInfo`；与 `$SHELL` 匹配的条目标记 `default`。
- `$SHELL` 不在列表时前置插入；解析失败回退 `/bin/sh`。
- `args` 恒为空 → shell 以**交互非登录**方式运行（`~/.zshrc` 会加载，`~/.zprofile` 不会；PATH 继承自 GUI 应用环境）。
- 前端 `defaultShell()`（`src/services/shells.ts`）取 `default` 条目传给 `session.start`。目前无 profile/参数机制（无 UI 选择 shell）。

## Related

- [pty-lifecycle](pty-lifecycle.md)
- [02-frontend/config-and-theming](../02-frontend/config-and-theming.md)
- [03-backend/capabilities-and-window](capabilities-and-window.md)
