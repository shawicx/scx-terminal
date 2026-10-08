# Calls

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
- src-tauri/src/main.rs
</details>

调用关系边表（按入口/热点分组）。每条边可被 trace_path / CALLS 查询复现。

## Tauri IPC 调用边（跨语言）

前端 invoke ↔ Rust #[tauri::command] 对表（正则扫描；图谱 CALLS 边不覆盖跨语言边界，invoke(变量) 动态命令名不在内）

| 命令 | 前端调用点 | Rust 定义 |
| --- | --- | --- |
| `config_dir_path` | src/components/settings/pages/AboutPage.vue:26 | src-tauri/src/config/mod.rs:37 |
| `debug_log_dir` | src/components/settings/pages/AboutPage.vue:29 | src-tauri/src/lib.rs:64 |
| `dev_log` | src/components/settings/pages/AboutPage.vue:46<br>src/components/settings/pages/AboutPage.vue:66<br>src/main.ts:22 | src-tauri/src/lib.rs:29 |
| `background_image_set` | src/components/settings/pages/AppearancePage.vue:54<br>src/components/settings/pages/AppearancePage.vue:71 | src-tauri/src/background.rs:116 |
| `debug_set_enabled` | src/main.ts:38 | src-tauri/src/lib.rs:41 |
| `debug_open_devtools` | src/main.ts:39 | src-tauri/src/lib.rs:52 |
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
| `history_record` | src/services/history.ts:69 | src-tauri/src/history.rs:67 |
| `history_clear` | src/services/history.ts:78 | src-tauri/src/history.rs:151 |
| `fs_read_text_file` | src/services/history.ts:106 | src-tauri/src/fsutil.rs:114 |
| `history_import` | src/services/history.ts:114 | src-tauri/src/history.rs:119 |
| `fs_browse_dir` | src/services/localFs.ts:28 | src-tauri/src/fsutil.rs:133 |
| `fs_home_dir` | src/services/localFs.ts:39 | src-tauri/src/fsutil.rs:147 |
| `monitor_start` | src/services/monitor.ts:78 | src-tauri/src/monitor/mod.rs:87 |
| `monitor_stop` | src/services/monitor.ts:90 | src-tauri/src/monitor/mod.rs:212 |
| `fs_list_dir` | src/services/pathCompletion.ts:26 | src-tauri/src/fsutil.rs:108 |
| `pty_spawn` | src/services/pty.ts:41 | src-tauri/src/pty/mod.rs:124 |
| `pty_exists` | src/services/pty.ts:94 | src-tauri/src/pty/mod.rs:318 |
| `pty_get_cwd` | src/services/pty.ts:109 | src-tauri/src/pty/mod.rs:338 |
| `pty_resize` | src/services/pty.ts:117 | src-tauri/src/pty/mod.rs:286 |
| `pty_write` | src/services/pty.ts:124 | src-tauri/src/pty/mod.rs:277 |
| `pty_kill` | src/services/pty.ts:130 | src-tauri/src/pty/mod.rs:298 |
| `pty_ack_data` | src/services/pty.ts:136 | src-tauri/src/pty/mod.rs:310 |
| `key_inspect` | src/services/secrets.ts:55 | src-tauri/src/secrets/keys.rs:153 |
| `key_generate` | src/services/secrets.ts:67 | src-tauri/src/secrets/keys.rs:100 |

## Fan-in（被调用次数）

| 符号 | 文件 | 扇入 |
| --- | --- | --- |
| lock_conn |  | 46 |
| execute |  | 43 |
| load_internal |  | 25 |
| mark_initialized |  | 24 |
| push |  | 20 |
| new |  | 20 |
| temp_dir |  | 13 |
| new |  | 12 |
| new |  | 10 |
| session |  | 9 |

## main

入口文件：src-tauri/src/main.rs

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| main | run | src-tauri/src/lib.rs:70 |
| run | default | src-tauri/src/shells.rs:15 |
| run | new | src-tauri/src/history.rs:38 |
| run | path | src-tauri/src/proc_cwd.rs:50 |

## useGroupNameDialog

入口文件：src/components/settings/useGroupNameDialog.ts

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| useGroupNameDialog | useConfigStore | src/stores/config/store.ts:23 |

## constructor

高扇入热点锚定（非应用入口）：src/lib/frontends/xterm/frontend.ts

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| constructor | FlowControl | src/lib/frontends/xterm/support.ts:61 |
| constructor | encodeUTF8 | src/lib/utils/bytes.ts:50 |
| constructor | getSelection | src/lib/frontends/xterm/frontend.ts:271 |
| constructor | copySelection | src/lib/frontends/xterm/frontend.ts:275 |
| constructor | createKeyboardEventHandler | src/lib/frontends/xterm/keyboard.ts:28 |
| constructor | createKeyGate | src/lib/frontends/xterm/keyboard.ts:82 |
| constructor | ResizeScheduler | src/lib/frontends/xterm/resize.ts:13 |
| constructor | isAttachActive | src/lib/frontends/xterm/frontend.ts:51 |
| constructor | XtermRendererManager | src/lib/frontends/xterm/renderer.ts:26 |
| copySelection | getSelection | src/lib/frontends/xterm/frontend.ts:271 |
| createKeyboardEventHandler | encodeUTF8 | src/lib/utils/bytes.ts:50 |
| createKeyGate | isIMETextKey | src/lib/frontends/xterm/support.ts:35 |

## connectHeadless

高扇入热点锚定（非应用入口）：src/services/sshConnections.ts

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| connectHeadless | useConfigStore | src/stores/config/store.ts:23 |
| connectHeadless | SshProxy | src/services/ssh.ts:57 |
| connectHeadless | noteHeadlessDead | src/lib/sshConnectionRegistry.ts:165 |
| connectHeadless | refreshMirror | src/services/sshConnections.ts:152 |
| connectHeadless | pendingKbdResolver | src/services/sshConnections.ts:33 |
| connectHeadless | setProfilePassword | src/services/secrets.ts:126 |
| refreshMirror | useConfigStore | src/stores/config/store.ts:23 |
| refreshMirror | hasPaneSessions | src/lib/sshConnectionRegistry.ts:85 |
| refreshMirror | headlessSshIdFor | src/lib/sshConnectionRegistry.ts:211 |
| refreshMirror | isConnecting | src/lib/sshConnectionRegistry.ts:215 |

## copy_file

高扇入热点锚定（非应用入口）：src-tauri/src/transfers/pump.rs

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| copy_file | failed | src-tauri/src/transfers/mod.rs:112 |
| copy_file | new | src-tauri/src/transfers/mod.rs:117 |
| copy_file | load | src-tauri/src/monitor/parse.rs:55 |
| copy_file | advance | src-tauri/src/transfers/mod.rs:289 |
| copy_file | flush | src-tauri/src/pty/queue.rs:50 |
| copy_file | shutdown | src-tauri/src/forward/mod.rs:156 |
| new | default | src-tauri/src/shells.rs:15 |
| advance | mutate | src-tauri/src/transfers/mod.rs:173 |
| advance | emit_all | src-tauri/src/transfers/mod.rs:282 |
| mutate | is_terminal | src-tauri/src/transfers/mod.rs:89 |
| emit_all | snapshots | src-tauri/src/transfers/mod.rs:190 |

## accept_local_connection

高扇入热点锚定（非应用入口）：src-tauri/src/forward/loops.rs

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| accept_local_connection | snapshot | src-tauri/src/forward/mod.rs:168 |
| accept_local_connection | spawn_tracked | src-tauri/src/forward/mod.rs:189 |
| accept_local_connection | open_direct_tcpip | src-tauri/src/ssh/session.rs:200 |
| accept_local_connection | port | src-tauri/src/ssh/session.rs:25 |
| accept_local_connection | pipe_bidirectional | src-tauri/src/forward/loops.rs:50 |
| spawn_tracked | push | src-tauri/src/pty/queue.rs:96 |
| push | maybe_emit | src-tauri/src/pty/queue.rs:151 |
## Related

- 同目录：[classes.md](classes.md) · [glossary.md](glossary.md)
- 总入口：[README](../README.md)
