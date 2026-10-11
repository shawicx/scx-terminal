# 调用关系

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
- src-tauri/src/debug_log.rs
- src-tauri/src/fonts.rs
- src-tauri/src/forward/loops.rs
- src-tauri/src/forward/mod.rs
- src-tauri/src/fsutil.rs
- src-tauri/src/history.rs
</details>

调用关系边表（按入口/热点分组）。每条边可被 trace_path / CALLS 查询复现。

## Tauri IPC 调用边（跨语言）

前端 invoke ↔ Rust #[tauri::command] 对表（正则扫描；图谱 CALLS 边不覆盖跨语言边界，invoke(变量) 动态命令名不在内）

| 命令 | 前端调用点 | Rust 定义 |
| --- | --- | --- |
| `config_dir_path` | src/components/settings/pages/AboutPage.vue:26 | src-tauri/src/config/mod.rs:38 |
| `debug_log_dir` | src/components/settings/pages/AboutPage.vue:29 | src-tauri/src/lib.rs:65 |
| `dev_log` | src/components/settings/pages/AboutPage.vue:46<br>src/components/settings/pages/AboutPage.vue:66<br>src/main.ts:22 | src-tauri/src/lib.rs:30 |
| `background_image_set` | src/components/settings/pages/AppearancePage.vue:54<br>src/components/settings/pages/AppearancePage.vue:71 | src-tauri/src/background.rs:116 |
| `debug_set_enabled` | src/main.ts:38 | src-tauri/src/lib.rs:42 |
| `debug_open_devtools` | src/main.ts:39 | src-tauri/src/lib.rs:53 |
| `background_image_load` | src/services/backgroundImage.ts:63 | src-tauri/src/background.rs:140 |
| `config_export` | src/services/configBackup.ts:24 | src-tauri/src/snapshot/mod.rs:138 |
| `config_import` | src/services/configBackup.ts:37 | src-tauri/src/snapshot/mod.rs:161 |
| `s3_sync_get` | src/services/configSync.ts:56 | src-tauri/src/s3sync/mod.rs:138 |
| `s3_sync_set` | src/services/configSync.ts:68 | src-tauri/src/s3sync/mod.rs:155 |
| `s3_sync_clear` | src/services/configSync.ts:79 | src-tauri/src/s3sync/mod.rs:165 |
| `s3_sync_test` | src/services/configSync.ts:91 | src-tauri/src/s3sync/mod.rs:175 |
| `s3_sync_status` | src/services/configSync.ts:102 | src-tauri/src/s3sync/mod.rs:217 |
| `s3_sync_push` | src/services/configSync.ts:114 | src-tauri/src/s3sync/mod.rs:185 |
| `s3_sync_list_remote` | src/services/configSync.ts:125 | src-tauri/src/s3sync/mod.rs:236 |
| `s3_sync_pull` | src/services/configSync.ts:138 | src-tauri/src/s3sync/mod.rs:247 |
| `list_fonts` | src/services/fonts.ts:15 | src-tauri/src/fonts.rs:5 |
| `forward_start` | src/services/forward.ts:21 | src-tauri/src/forward/mod.rs:317 |
| `forward_stop` | src/services/forward.ts:33 | src-tauri/src/forward/mod.rs:431 |
| `forward_list` | src/services/forward.ts:45 | src-tauri/src/forward/mod.rs:461 |
| `forward_list_all` | src/services/forward.ts:56 | src-tauri/src/forward/mod.rs:479 |
| `history_list` | src/services/history.ts:33 | src-tauri/src/history.rs:88 |
| `history_record` | src/services/history.ts:69 | src-tauri/src/history.rs:67 |
| `history_clear` | src/services/history.ts:78 | src-tauri/src/history.rs:151 |
| `fs_read_text_file` | src/services/history.ts:106<br>src/services/workflowYamlIo.ts:99 | src-tauri/src/fsutil.rs:114 |
| `history_import` | src/services/history.ts:114 | src-tauri/src/history.rs:119 |
| `fs_browse_dir` | src/services/localFs.ts:28 | src-tauri/src/fsutil.rs:152 |
| `fs_home_dir` | src/services/localFs.ts:39 | src-tauri/src/fsutil.rs:166 |
| `monitor_start` | src/services/monitor.ts:78 | src-tauri/src/monitor/mod.rs:87 |
| `monitor_stop` | src/services/monitor.ts:90 | src-tauri/src/monitor/mod.rs:212 |
| `mosh_detect` | src/services/mosh.ts:14 | src-tauri/src/mosh.rs:14 |
| `fs_list_dir` | src/services/pathCompletion.ts:26 | src-tauri/src/fsutil.rs:108 |
| `pty_spawn` | src/services/pty.ts:41 | src-tauri/src/pty/mod.rs:124 |
| `pty_exists` | src/services/pty.ts:94 | src-tauri/src/pty/mod.rs:318 |
| `pty_get_cwd` | src/services/pty.ts:109 | src-tauri/src/pty/mod.rs:338 |
| `pty_resize` | src/services/pty.ts:117 | src-tauri/src/pty/mod.rs:286 |
| `pty_write` | src/services/pty.ts:124 | src-tauri/src/pty/mod.rs:277 |
| `pty_kill` | src/services/pty.ts:130 | src-tauri/src/pty/mod.rs:298 |
| `pty_ack_data` | src/services/pty.ts:136 | src-tauri/src/pty/mod.rs:310 |

## 扇入（被调用次数）

| 符号 | 文件 | 扇入 |
| --- | --- | --- |
| lock_conn |  | 50 |
| execute |  | 47 |
| mark_initialized |  | 28 |
| load_internal |  | 27 |
| new |  | 22 |
| push |  | 20 |
| new |  | 16 |
| new |  | 16 |
| temp_dir |  | 13 |
| failed |  | 10 |

## main

入口文件：src-tauri/src/main.rs

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| main | run | src-tauri/src/lib.rs:71 |
| run | Users-scx-Documents-code-scx-terminal.src-tauri.src.shells.ShellInfo.default | src-tauri/src/shells.rs:15 |
| run | Users-scx-Documents-code-scx-terminal.src-tauri.src.history.HistoryState.new | src-tauri/src/history.rs:38 |
| run | Users-scx-Documents-code-scx-terminal.src-tauri.src.proc_cwd.VnodeInfoPath.path | src-tauri/src/proc_cwd.rs:50 |

## useDraftEditor

入口文件：src/components/settings/useDraftEditor.ts

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| useDraftEditor | stableStringify | src/components/settings/useDraftEditor.ts:25 |

## accept_local_connection

高扇入热点锚定（非应用入口）：src-tauri/src/forward/loops.rs

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| accept_local_connection | Users-scx-Documents-code-scx-terminal.src-tauri.src.forward.mod.ForwardHandle.snapshot | src-tauri/src/forward/mod.rs:168 |
| accept_local_connection | Users-scx-Documents-code-scx-terminal.src-tauri.src.forward.mod.ForwardHandle.spawn_tracked | src-tauri/src/forward/mod.rs:189 |
| accept_local_connection | Users-scx-Documents-code-scx-terminal.src-tauri.src.ssh.session.SshSession.open_direct_tcpip | src-tauri/src/ssh/session.rs:203 |
| accept_local_connection | Users-scx-Documents-code-scx-terminal.src-tauri.src.ssh.session.ScxHandler.port | src-tauri/src/ssh/session.rs:25 |
| accept_local_connection | pipe_bidirectional | src-tauri/src/forward/loops.rs:50 |
| spawn_tracked | Users-scx-Documents-code-scx-terminal.src-tauri.src.pty.queue.PtyDataQueue.push | src-tauri/src/pty/queue.rs:96 |
| push | maybe_emit | src-tauri/src/pty/queue.rs:151 |

## append_raw

高扇入热点锚定（非应用入口）：src-tauri/src/debug_log.rs

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| append_raw | Users-scx-Documents-code-scx-terminal.src-tauri.src.debug_log.DebugLogState.append | src-tauri/src/debug_log.rs:63 |
| append_raw | Users-scx-Documents-code-scx-terminal.src-tauri.src.debug_log.DebugLogState.new | src-tauri/src/debug_log.rs:28 |
| append_raw | Users-scx-Documents-code-scx-terminal.src-tauri.src.snapshot.model.BackupSnapshot.format | src-tauri/src/snapshot/model.rs:131 |
| append_raw | truncate_over_limit | src-tauri/src/debug_log.rs:100 |
| append | Users-scx-Documents-code-scx-terminal.src-tauri.src.monitor.parse.MonitorSample.load | src-tauri/src/monitor/parse.rs:55 |
| append | Users-scx-Documents-code-scx-terminal.src-tauri.src.debug_log.DebugLogState.append_raw | src-tauri/src/debug_log.rs:76 |

## attach

高扇入热点锚定（非应用入口）：src/lib/frontends/xterm/frontend.ts

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| attach | Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.frontend.XTermFrontend.isAttachActive | src/lib/frontends/xterm/frontend.ts:53 |
| attach | Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.frontend.XTermFrontend.configureColors | src/lib/frontends/xterm/frontend.ts:409 |
| attach | Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.renderer.XtermRendererManager.attach | src/lib/frontends/xterm/renderer.ts:37 |
| attach | Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.renderer.XtermRendererManager.recover | src/lib/frontends/xterm/renderer.ts:104 |
| attach | Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.frontend.XTermFrontend.resizeHandler | src/lib/frontends/xterm/frontend.ts:160 |
| resizeHandler | Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.resize.ResizeScheduler.schedule | src/lib/frontends/xterm/resize.ts:25 |
| configureColors | buildXtermTheme | src/lib/frontends/xterm/options.ts:18 |
| attach | Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.renderer.XtermRendererManager.attachWebGL | src/lib/frontends/xterm/renderer.ts:116 |
| recover | Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.renderer.XtermRendererManager.canRecover | src/lib/frontends/xterm/renderer.ts:128 |
| recover | Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.renderer.XtermRendererManager.attachWebGL | src/lib/frontends/xterm/renderer.ts:116 |
| recover | Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.renderer.XtermRendererManager.redraw | src/lib/frontends/xterm/renderer.ts:133 |
| attachWebGL | Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.renderer.XtermRendererManager.recover | src/lib/frontends/xterm/renderer.ts:104 |
| buildXtermTheme | generatePalette | src/lib/generatePalette.ts:88 |

## authenticate

高扇入热点锚定（非应用入口）：src-tauri/src/ssh/auth.rs

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| authenticate | try_agent | src-tauri/src/ssh/auth.rs:35 |
| authenticate | format_auth_failure | src-tauri/src/ssh/auth.rs:138 |
| authenticate | load_private_key | src-tauri/src/secrets/keys.rs:17 |
| authenticate | try_private_key_pem | src-tauri/src/ssh/auth.rs:68 |
| authenticate | try_password_like | src-tauri/src/ssh/auth.rs:266 |
| try_agent | Users-scx-Documents-code-scx-terminal.src-tauri.src.secrets.backup.KeyPlain.public_key | src-tauri/src/secrets/backup.rs:16 |
| try_agent | rsa_hash_for | src-tauri/src/ssh/auth.rs:22 |
| try_agent | Users-scx-Documents-code-scx-terminal.src-tauri.src.secrets.keys.KeyGenerateOptions.algorithm | src-tauri/src/secrets/keys.rs:56 |
| try_private_key_pem | rsa_hash_for | src-tauri/src/ssh/auth.rs:22 |
| try_private_key_pem | Users-scx-Documents-code-scx-terminal.src-tauri.src.secrets.keys.KeyGenerateOptions.algorithm | src-tauri/src/secrets/keys.rs:56 |
| try_private_key_pem | Users-scx-Documents-code-scx-terminal.src-tauri.src.ssh.mod.SshManager.new | src-tauri/src/ssh/mod.rs:75 |
| try_password_like | load_password | src-tauri/src/secrets/creds.rs:9 |
| try_password_like | is_single_secret_prompt | src-tauri/src/ssh/auth.rs:119 |
| try_password_like | ask_frontend | src-tauri/src/ssh/auth.rs:178 |
| try_password_like | password_fallback | src-tauri/src/ssh/auth.rs:217 |
| try_password_like | format_auth_failure | src-tauri/src/ssh/auth.rs:138 |
| load_private_key | Users-scx-Documents-code-scx-terminal.src-tauri.src.secrets.mod.SecretsState.lock_conn | src-tauri/src/secrets/mod.rs:109 |
| load_private_key | decrypt_field | src-tauri/src/secrets/crypto.rs:58 |
| load_private_key | Users-scx-Documents-code-scx-terminal.src-tauri.src.secrets.mod.SecretsState.cipher | src-tauri/src/secrets/mod.rs:114 |
| new | Users-scx-Documents-code-scx-terminal.src-tauri.src.shells.ShellInfo.default | src-tauri/src/shells.rs:15 |
| load_password | Users-scx-Documents-code-scx-terminal.src-tauri.src.secrets.mod.SecretsState.lock_conn | src-tauri/src/secrets/mod.rs:109 |
| load_password | decrypt_field | src-tauri/src/secrets/crypto.rs:58 |
| load_password | Users-scx-Documents-code-scx-terminal.src-tauri.src.secrets.mod.SecretsState.cipher | src-tauri/src/secrets/mod.rs:114 |
| password_fallback | ask_frontend | src-tauri/src/ssh/auth.rs:178 |
| password_fallback | format_auth_failure | src-tauri/src/ssh/auth.rs:138 |

## 本页确定知道的事实

- 调用边分组 6 组（入口 2 / 热点锚定 4）
- 调用边共 56 条（每组内已去重）
- 扇入表条目 10 个
- Tauri IPC 跨语言命令 103 个、事件 8 个
## Related

- 同目录：[classes.md](classes.md) · [glossary.md](glossary.md)
- 互补职责：[glossary.md](../07-reference/glossary.md)
- 共享 14 个源文件、共享 40 个符号：[api.md](../03-interface/api.md)
- 共享 6 个源文件、共享 2 个符号：[architecture.md](../02-architecture/architecture.md)
- 共享 6 个源文件、共享 1 个符号：[modules.md](../02-architecture/modules.md)
- 总入口：[README](../README.md)

<!-- wiki:source: fallback -->
