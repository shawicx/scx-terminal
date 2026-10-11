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
- src-tauri/src/fonts.rs
- src-tauri/src/forward/loops.rs
- src-tauri/src/forward/mod.rs
- src-tauri/src/fsutil.rs
- src-tauri/src/history.rs
- src-tauri/src/lib.rs
- src-tauri/src/monitor/mod.rs
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
| `history_list` | src/services/history.ts:33 | src-tauri/src/history.rs:88 |
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

## 扇入（被调用次数）

| 符号 | 文件 | 扇入 |
| --- | --- | --- |
| lock_conn |  | 47 |
| execute |  | 44 |
| load_internal |  | 26 |
| mark_initialized |  | 25 |
| push |  | 20 |
| new |  | 20 |
| new |  | 15 |
| temp_dir |  | 13 |
| new |  | 10 |
| encodeUTF8 |  | 9 |

## main

入口文件：src-tauri/src/main.rs

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| main | run | src-tauri/src/lib.rs:70 |
| run | Users-scx-Documents-code-scx-terminal.src-tauri.src.shells.ShellInfo.default | src-tauri/src/shells.rs:15 |
| run | Users-scx-Documents-code-scx-terminal.src-tauri.src.history.HistoryState.new | src-tauri/src/history.rs:38 |
| run | Users-scx-Documents-code-scx-terminal.src-tauri.src.proc_cwd.VnodeInfoPath.path | src-tauri/src/proc_cwd.rs:50 |

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
| constructor | Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.frontend.XTermFrontend.getSelection | src/lib/frontends/xterm/frontend.ts:274 |
| constructor | Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.frontend.XTermFrontend.copySelection | src/lib/frontends/xterm/frontend.ts:278 |
| constructor | createKeyboardEventHandler | src/lib/frontends/xterm/keyboard.ts:28 |
| constructor | createKeyGate | src/lib/frontends/xterm/keyboard.ts:82 |
| constructor | ResizeScheduler | src/lib/frontends/xterm/resize.ts:13 |
| constructor | Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.frontend.XTermFrontend.isAttachActive | src/lib/frontends/xterm/frontend.ts:53 |
| constructor | XtermRendererManager | src/lib/frontends/xterm/renderer.ts:26 |
| copySelection | Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.frontend.XTermFrontend.getSelection | src/lib/frontends/xterm/frontend.ts:274 |
| createKeyboardEventHandler | encodeUTF8 | src/lib/utils/bytes.ts:50 |
| createKeyGate | isIMETextKey | src/lib/frontends/xterm/support.ts:35 |

## connectHeadless

高扇入热点锚定（非应用入口）：src/services/sshConnections.ts

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| connectHeadless | useConfigStore | src/stores/config/store.ts:23 |
| connectHeadless | SshProxy | src/services/ssh.ts:57 |
| connectHeadless | Users-scx-Documents-code-scx-terminal.src.lib.sshConnectionRegistry.SshConnectionRegistry.noteHeadlessDead | src/lib/sshConnectionRegistry.ts:165 |
| connectHeadless | refreshMirror | src/services/sshConnections.ts:152 |
| connectHeadless | pendingKbdResolver | src/services/sshConnections.ts:33 |
| connectHeadless | setProfilePassword | src/services/secrets.ts:126 |
| refreshMirror | useConfigStore | src/stores/config/store.ts:23 |
| refreshMirror | Users-scx-Documents-code-scx-terminal.src.lib.sshConnectionRegistry.SshConnectionRegistry.hasPaneSessions | src/lib/sshConnectionRegistry.ts:85 |
| refreshMirror | Users-scx-Documents-code-scx-terminal.src.lib.sshConnectionRegistry.SshConnectionRegistry.headlessSshIdFor | src/lib/sshConnectionRegistry.ts:211 |
| refreshMirror | Users-scx-Documents-code-scx-terminal.src.lib.sshConnectionRegistry.SshConnectionRegistry.isConnecting | src/lib/sshConnectionRegistry.ts:215 |

## copy_file

高扇入热点锚定（非应用入口）：src-tauri/src/transfers/pump.rs

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| copy_file | failed | src-tauri/src/transfers/mod.rs:112 |
| copy_file | Users-scx-Documents-code-scx-terminal.src-tauri.src.transfers.mod.TransferManager.new | src-tauri/src/transfers/mod.rs:117 |
| copy_file | Users-scx-Documents-code-scx-terminal.src-tauri.src.monitor.parse.MonitorSample.load | src-tauri/src/monitor/parse.rs:55 |
| copy_file | advance | src-tauri/src/transfers/mod.rs:289 |
| copy_file | Users-scx-Documents-code-scx-terminal.src-tauri.src.pty.queue.Utf8Splitter.flush | src-tauri/src/pty/queue.rs:50 |
| copy_file | Users-scx-Documents-code-scx-terminal.src-tauri.src.forward.mod.ForwardHandle.shutdown | src-tauri/src/forward/mod.rs:156 |
| new | Users-scx-Documents-code-scx-terminal.src-tauri.src.shells.ShellInfo.default | src-tauri/src/shells.rs:15 |
| advance | Users-scx-Documents-code-scx-terminal.src-tauri.src.transfers.mod.TransferManager.mutate | src-tauri/src/transfers/mod.rs:173 |
| advance | emit_all | src-tauri/src/transfers/mod.rs:282 |
| mutate | is_terminal | src-tauri/src/transfers/mod.rs:89 |
| emit_all | Users-scx-Documents-code-scx-terminal.src-tauri.src.transfers.mod.TransferManager.snapshots | src-tauri/src/transfers/mod.rs:190 |

## accept_local_connection

高扇入热点锚定（非应用入口）：src-tauri/src/forward/loops.rs

| 调用方 | 被调用方 | 源文件:行号 |
| --- | --- | --- |
| accept_local_connection | Users-scx-Documents-code-scx-terminal.src-tauri.src.forward.mod.ForwardHandle.snapshot | src-tauri/src/forward/mod.rs:168 |
| accept_local_connection | Users-scx-Documents-code-scx-terminal.src-tauri.src.forward.mod.ForwardHandle.spawn_tracked | src-tauri/src/forward/mod.rs:189 |
| accept_local_connection | Users-scx-Documents-code-scx-terminal.src-tauri.src.ssh.session.SshSession.open_direct_tcpip | src-tauri/src/ssh/session.rs:200 |
| accept_local_connection | Users-scx-Documents-code-scx-terminal.src-tauri.src.ssh.session.ScxHandler.port | src-tauri/src/ssh/session.rs:25 |
| accept_local_connection | pipe_bidirectional | src-tauri/src/forward/loops.rs:50 |
| spawn_tracked | Users-scx-Documents-code-scx-terminal.src-tauri.src.pty.queue.PtyDataQueue.push | src-tauri/src/pty/queue.rs:96 |
| push | maybe_emit | src-tauri/src/pty/queue.rs:151 |

## 本页确定知道的事实

- 调用边分组 6 组（入口 2 / 热点锚定 4）
- 调用边共 45 条（每组内已去重）
- 扇入表条目 10 个
- Tauri IPC 跨语言命令 95 个、事件 5 个
## Related

- 同目录：[classes.md](classes.md) · [glossary.md](glossary.md)
- 互补职责：[glossary.md](../07-reference/glossary.md)
- 共享 15 个源文件、共享 40 个符号：[api.md](../03-interface/api.md)
- 共享 3 个源文件、共享 3 个符号：[architecture.md](../02-architecture/architecture.md)
- 共享 6 个源文件：[onboarding.md](../05-guides/onboarding.md)
- 总入口：[README](../README.md)
