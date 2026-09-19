# 项目概述

## 是什么

scx-terminal 是一个 macOS 桌面终端应用（Tauri v2 + Vue 3 + @xterm/xterm 5.5），界面与功能对标 Tabby，核心模块移植自 Tabby 源码树（`tabby-terminal` / `tabby-local` / `tabby-electron` / `tabby-core`，文件头注释中均有标注）。它不是 Web 应用：所有 shell 会话由 Rust 后端通过 `portable-pty` 在真实 PTY 中运行，前端与后端仅通过 Tauri IPC 通信。

## 当前功能清单

| 功能 | 状态 | 关键代码 |
| --- | --- | --- |
| 本地终端（配置档案驱动；默认以登录 shell `-l` 启动） | 可用 | `src/lib/sessions/localSession.ts`、`src/stores/config.ts` |
| Profiles 配置档案：`profiles[]`（本地/SSH 双类型）、首次从 /etc/shells 自动生成、设置页 CRUD（本地终端/SSH 两分页）、标签栏「+」下拉与命令面板按档案开标签、按档案专属配色 | 可用 | `src/stores/config.ts`、`src/components/settings/SettingsView.vue`、`src/components/titlebar/TabStrip.vue`、`src/services/commands.ts` |
| 多标签（后台标签保持会话运行，`v-show` 不卸载；中键关闭、拖拽排序；标签栏位置可 top/bottom） | 可用 | `src/stores/tabs.ts`、`src/App.vue`、`src/components/titlebar/TabStrip.vue` |
| 标签右键菜单：重命名（手动标题优先于 OSC 上报）、关闭其他、颜色标记 | 可用 | `src/components/titlebar/TabStrip.vue`、`src/components/ui/ContextMenu.vue` |
| 分屏（水平/垂直、拖拽调整比例、键盘导航） | 可用 | `src/components/split/` |
| 终端内右键菜单（复制/粘贴/全选/清屏/搜索/分屏/关窗格） | 可用 | `src/components/terminal/TerminalPane.vue` |
| 标签标题跟随 shell OSC 0/2 上报 | 可用 | `TerminalPane.vue` → `frontend.title$` |
| 终端内搜索 | 可用 | `@xterm/addon-search` + `TerminalPane.vue` 搜索条 |
| 复制/粘贴（Tauri 剪贴板插件，降级 `navigator.clipboard`） | 可用 | `src/lib/frontendContext.ts` |
| OSC 52 剪贴板写入（base64 解码 + 100KB 上限，只写不读） | 可用 | `src/lib/middleware/oscProcessing.ts` |
| 可点击 URL（WebLinks addon + opener 插件；OSC 8 由 xterm 核心支持） | 可用 | `src/lib/frontends/xtermFrontend.ts` |
| 系统文件/保存对话框（SFTP 上传/下载目标选择） | 可用 | `tauri-plugin-dialog`（capabilities `dialog:default`） |
| 命令面板（模糊搜索）+ 可配置热键（加载时对旧键名做归一化） | 可用 | `src/components/palette/CommandPalette.vue`、`src/services/` |
| 配色主题：严格复刻 Tabby 候选列表（Tabby Default/Light + 社区全集 191 套，共 193）+ 独立配色方案页（搜索/首字母分组折叠/Tabby 式预览卡）+ 界面跟随配色 + 亮暗跟随系统 | 可用 | `src/lib/colorSchemes.ts`、`src/lib/communityColorSchemes.ts`（生成产物）、`src/lib/schemeColors.ts`、`src/stores/theme.ts`、`src/components/settings/ColorSchemePicker.vue` |
| 自定义配色：逐色编辑器（16 ANSI + 前景/背景/光标/选区等 22 槽）、iTerm2 .itermcolors 导入 | 可用 | `src/lib/itermColors.ts`、`src/components/settings/SettingsView.vue`（外观页）、`ui/SearchableSelect.vue` |
| 字体列表选择器（系统字体枚举可搜索下拉，命令失败回退自由文本） | 可用 | `src-tauri/src/fonts.rs`（font-loader）、`src/services/fonts.ts` |
| 设置页（分组卡片式：本地终端/SSH/密钥/配色/快捷命令/隧道规则/外观/热键/关于），SQLite 持久化（`config.db`，前端差异 flush）；含退格行为、输入/输出换行转换、wordSeparator、粗体亮色、字重（常规/粗体）、登录 shell 开关、标签栏位置 | 可用 | `src/components/settings/SettingsView.vue`、`src/stores/config.ts`、`src-tauri/src/config.rs` |
| 退格重映射与换行转换中间件（会话构造期按配置挂载，对新标签生效） | 可用 | `src/lib/sessions/baseSession.ts`、`src/lib/middleware/{inputProcessing,streamProcessing}.ts` |
| 中英双语（跟随系统） | 可用 | `src/i18n/index.ts` |
| 工作目录跟踪（M4）：OSC 7 + OSC 1337 双协议解析 + Rust 进程探测（`pty_get_cwd`）三级回退 | 可用 | `src/lib/middleware/oscProcessing.ts`、`src-tauri/src/proc_cwd.rs` |
| 新标签/分屏窗格继承当前目录（档案显式 cwd 优先，同 Tabby 语义）；「复制当前路径」命令 | 可用 | `src/services/commands.ts`、`src/components/terminal/TerminalTabContent.vue`、`src/stores/tabs.ts` |
| SSH 远程会话（M5）：russh 0.63、agent/私钥/密码认证、TOFU 指纹确认（读写系统 known_hosts，120s 确认超时）、keepalive、SSH 档案管理（M11 分组 + 本地/SSH 设置页分离）；认证失败文案携带服务器可用方法 | 可用 | `src-tauri/src/ssh.rs`、`src/services/ssh.ts`、`src/lib/sessions/sshSession.ts`、`ui/Dialog.vue`+`terminal/HostKeyDialog.vue` |
| SSH keyboard-interactive 认证：kbd 优先 + password 兜底（库存密码首轮静默自动应答）、动态凭据弹窗（多轮挑战/echo 分级/回车跳焦）、「记住密码」认证成功后回存（300s 挑战超时） | 可用 | `src-tauri/src/ssh.rs`（try_password_like/ask_frontend）、`src/components/terminal/CredentialDialog.vue`、`src/services/sshConnections.ts` |
| SSH 密钥链（M5.5，Termius 式）：密钥导入/应用内生成/管理，敏感内容 AES-256-GCM 加密存 SQLite（主密钥在系统钥匙串），档案按 keyId 直连 | 可用 | `src-tauri/src/secrets.rs`、`src/services/secrets.ts`、设置页「密钥」分页 |
| SFTP 双栏标签页（Termius 式）：本地/远端双栏浏览（面包屑/排序/隐藏开关/多选）、栏间自实现指针拖拽与系统文件拖入、同名冲突对话框、断线重连 banner；连接复用优先，无会话 headless 后台连接 | 可用 | `src/components/sftp/SftpTabContent.vue`、`SftpBrowserPane.vue`、`src/services/sftp.ts`、`src/lib/sshConnectionRegistry.ts`、`src/services/sshConnections.ts` |
| 全局传输中心：上传/下载统一任务（目录递归聚合、取消、速度/ETA、历史 100 条），标题栏指示器徽标 | 可用 | `src-tauri/src/transfers.rs`、`src/components/sftp/TransferPopover.vue`、`src/stores/transfers.ts` |
| 端口转发：本地（-L）/远程（-R，含 GatewayPorts 公网绑定）/动态（-D，SOCKS5）三种；SSH 档案持久化规则（autoStart）+ 独立「隧道管理器」标签页（运行总览/按档案规则库/无会话时建独立隧道）+ 窗格临时转发抽屉；转发绑定连接，会话断开级联停止 | 可用 | `src-tauri/src/forward.rs`、`src/components/forwarding/ForwardingTabContent.vue`、`ForwardRuleFormDialog.vue`、`src/components/terminal/ForwardPanel.vue`、`src/components/settings/ProfileForwardingsCard.vue`、`src/services/forward.ts`、`src/lib/portForwarding.ts` |
| 终端背景图片（2026-09-19）：外观页选图（复制进 app-data/backgrounds/，覆盖式单张）+ 终端背景不透明度 + 填充方式（铺满/适应/平铺）；CSS 背景层 + xterm 半透明背景色（allowTransparency）实现，仅终端区生效 | 可用 | `src-tauri/src/background.rs`、`src/lib/backgroundImage.ts`、`src/services/backgroundImage.ts`、`TerminalPane.vue`（.terminal-bg）、`xtermFrontend.ts`（configureColors 合成） |
| 快捷命令（M7，Warp Workflows 式）：`{{param}}` 占位符、分组管理、选择器面板（⌘⇧R）与命令面板条目、autoRun 开关 | 可用 | `src/lib/quickCommands.ts`、`src/components/palette/QuickCommandPalette.vue`、设置页「快捷命令」分页 |
| 终端输入建议（M10）：PromptTracker 提示符自适应学习 + 历史/快捷命令/路径三源建议菜单（⌥-Space 手动/自动弹出）、独立 history.db（shell 历史导入、分桶）、粘贴/autoRun 命令直录历史、宽字符光标偏移按字符计 | 可用 | `src/lib/suggestions/`（promptTracker/suggestionEngine/controller）、`src/components/terminal/SuggestionMenu.vue`、`src-tauri/src/history.rs`、`src/services/pathCompletion.ts` |

## 技术栈

**前端**（`package.json`）：Vue 3.5、Pinia 4、rxjs 7（会话/前端事件流全部基于 Subject）、@xterm/xterm 5.5（addon-canvas / webgl / fit / search / unicode11）、Tailwind CSS 4（`@theme inline` token 体系）、reka-ui + class-variance-authority（UI 组件）、vue-i18n 11、yaml、nanoid。构建 Vite 8（端口 1420，`strictPort`，别名 `@` → `src/`），类型检查 `vue-tsc`，Lint `oxlint`，测试 `vitest`（node 环境）。

**后端**（`src-tauri/Cargo.toml`）：tauri 2（feature `macos-private-api`）、portable-pty 0.9、russh 0.63（SSH 客户端）、russh-sftp 3.0（SFTP）、fast-socks5 1.0（动态转发 SOCKS5 服务端）、rusqlite 0.40 bundled + aes-gcm + keyring + getrandom（敏感数据加密库）、tauri-plugin-opener、tauri-plugin-clipboard-manager、serde/serde_json、uuid、font-loader 0.11（系统字体枚举）。Release profile：`lto`、`opt-level = "s"`、`strip`。

**语言分布**（2026-09-18 统计）：TypeScript 77 文件、Vue 32、Rust 14。

## 已知限制与未接线功能

- 配置键 `appearance.theme`、`terminal.lineHeightAdjustment` 为死键（无读取方，保留以稳定配置结构）。`lineHeightAdjustment` 为**有意不接线**：`terminal.linePadding` 滑杆已完整覆盖行高调节，再接第二个键反而冗余（2026-09-18 M12 决策）。
- `terminal.fontWeight` / `fontWeightBold` / `wordSeparator` / `drawBoldTextInBrightColors` 由 xterm 消费且均已上设置 UI（字重两项于 2026-09-18 M12 补齐）；`paletteGenerate` / `paletteHarmonious` 亦有设置页开关。
- `appearance.tabBarPosition`（top/bottom）已接线：bottom 时标签条独立渲染在内容区下方（TabStrip.vue），标题栏只留红绿灯占位与指示器。
- `services/shells.ts` 的 `defaultShell()` 已无调用方（档案化后由 config 的 `defaultProfile()` 取代）；`listShells()` 仍被首次档案生成使用。`terminal.loginShell` 配置键保留作为新档案生成的种子值，运行期生效项为各档案的 `loginShell` 字段。
- 窗口 vibrancy/透明已写代码但被 `#[cfg(any())]` 编译关闭（`src-tauri/src/lib.rs`，WKWebView 下渲染空白，待主题阶段重试）。
- 终端粘贴仍固定做 `\r\n → \n` 归一化（`TerminalPane.vue`），叠加在 `inputNewlines` 转换之前，防多行粘贴被 shell 逐行执行；含换行的粘贴/快捷命令 autoRun 已直录历史（多行粘贴只记录最后一条命令，单命令模型限制）。
- 建议菜单对点文件的可见性统一为「补全前缀以 `.` 开头才显示」，本地与 SSH 同规则（`suggestionEngine.ts`；Rust `fs_list_dir` 全量返回）。
- 输入建议的多行命令续行合并（PS2/反斜杠）适用于回车采集路径；粘贴直录路径不做续行合并。

## 起源与设计文档

初始版本为一次性交付，后续按里程碑演进（git 历史完整保留各里程碑提交）。设计文档见 `docs/superpowers/specs/`（M1–M12 各里程碑一份，含端口转发、SFTP 双栏重构、keyboard-interactive 等）。

## Related

- [architecture](architecture.md)
- [04-guides/development](../04-guides/development.md)
- `AGENTS.md`（仓库根）
