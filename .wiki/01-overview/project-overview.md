# 项目概述

## 是什么

scx-terminal 是一个 macOS 桌面终端应用（Tauri v2 + Vue 3 + @xterm/xterm 5.5），界面与功能对标 Tabby，核心模块移植自 Tabby 源码树（`tabby-terminal` / `tabby-local` / `tabby-electron` / `tabby-core`，文件头注释中均有标注）。它不是 Web 应用：所有 shell 会话由 Rust 后端通过 `portable-pty` 在真实 PTY 中运行，前端与后端仅通过 Tauri IPC 通信。

## 当前功能清单

| 功能 | 状态 | 关键代码 |
| --- | --- | --- |
| 本地终端（配置档案驱动；默认以登录 shell `-l` 启动） | 可用 | `src/lib/sessions/localSession.ts`、`src/stores/config.ts` |
| Profiles 配置档案：`profiles[]`（`type: 'local'` 判别字段预留 SSH）、首次从 /etc/shells 自动生成、设置页 CRUD、标签栏「+」下拉与命令面板按档案开标签、按档案专属配色 | 可用 | `src/stores/config.ts`、`src/components/settings/SettingsView.vue`、`src/components/titlebar/TitleBar.vue`、`src/services/commands.ts` |
| 多标签（后台标签保持会话运行，`v-show` 不卸载；中键关闭、拖拽排序） | 可用 | `src/stores/tabs.ts`、`src/App.vue` |
| 标签右键菜单：重命名（手动标题优先于 OSC 上报）、关闭其他、颜色标记 | 可用 | `src/components/titlebar/TitleBar.vue`、`src/components/ui/ContextMenu.vue` |
| 分屏（水平/垂直、拖拽调整比例、键盘导航） | 可用 | `src/components/split/` |
| 终端内右键菜单（复制/粘贴/全选/清屏/搜索/分屏/关窗格） | 可用 | `src/components/terminal/TerminalPane.vue` |
| 标签标题跟随 shell OSC 0/2 上报 | 可用 | `TerminalPane.vue` → `frontend.title$` |
| 终端内搜索 | 可用 | `@xterm/addon-search` + `TerminalPane.vue` 搜索条 |
| 复制/粘贴（Tauri 剪贴板插件，降级 `navigator.clipboard`） | 可用 | `src/lib/frontendContext.ts` |
| OSC 52 剪贴板写入（base64 解码 + 100KB 上限，只写不读） | 可用 | `src/lib/middleware/oscProcessing.ts` |
| 可点击 URL（WebLinks addon + opener 插件；OSC 8 由 xterm 核心支持） | 可用 | `src/lib/frontends/xtermFrontend.ts` |
| 系统文件/保存对话框（SFTP 上传/下载目标选择） | 可用 | `tauri-plugin-dialog`（capabilities `dialog:default`） |
| 命令面板（模糊搜索）+ 可配置热键（加载时对旧键名做归一化） | 可用 | `src/components/palette/CommandPalette.vue`、`src/services/` |
| 配色主题：严格复刻 Tabby 候选列表（Tabby Default/Light + 社区全集 191 套，共 193）+ 界面跟随配色 + 亮暗跟随系统 | 可用 | `src/lib/colorSchemes.ts`、`src/lib/communityColorSchemes.ts`（生成产物）、`src/lib/schemeColors.ts`、`src/stores/theme.ts` |
| 自定义配色：逐色编辑器（16 ANSI + 前景/背景/光标/选区等 22 槽）、iTerm2 .itermcolors 导入 | 可用 | `src/lib/itermColors.ts`、`src/components/settings/SettingsView.vue`（外观页）、`ui/SearchableSelect.vue` |
| 字体列表选择器（系统字体枚举可搜索下拉，命令失败回退自由文本） | 可用 | `src-tauri/src/fonts.rs`（font-loader）、`src/services/fonts.ts` |
| 设置页（终端/外观/快捷键/关于），YAML 持久化；含退格行为、输入/输出换行转换、wordSeparator、粗体亮色、登录 shell 开关 | 可用 | `src/components/settings/SettingsView.vue`、`src/stores/config.ts` |
| 退格重映射与换行转换中间件（会话构造期按配置挂载，对新标签生效） | 可用 | `src/lib/sessions/baseSession.ts`、`src/lib/middleware/{inputProcessing,streamProcessing}.ts` |
| 中英双语（跟随系统） | 可用 | `src/i18n/index.ts` |
| 工作目录跟踪（M4）：OSC 7 + OSC 1337 双协议解析 + Rust 进程探测（`pty_get_cwd`）三级回退 | 可用 | `src/lib/middleware/oscProcessing.ts`、`src-tauri/src/proc_cwd.rs` |
| 新标签/分屏窗格继承当前目录（档案显式 cwd 优先，同 Tabby 语义）；「复制当前路径」命令 | 可用 | `src/services/commands.ts`、`src/components/terminal/TerminalTabContent.vue`、`src/stores/tabs.ts` |
| SSH 远程会话（M5）：russh 0.63、agent/私钥/密码认证、TOFU 指纹确认（读写系统 known_hosts）、keepalive、SSH 档案管理 | 可用 | `src-tauri/src/ssh.rs`、`src/services/ssh.ts`、`src/lib/sessions/sshSession.ts`、`ui/Dialog.vue`+`terminal/HostKeyDialog.vue` |
| SSH 密钥链（M5.5，Termius 式）：密钥导入/应用内生成/管理，敏感内容 AES-256-GCM 加密存 SQLite（主密钥在系统钥匙串），档案按 keyId 直连 | 可用 | `src-tauri/src/secrets.rs`、`src/services/secrets.ts`、设置页「密钥」分页 |
| SFTP 面板（M6）：SSH 窗格内右侧抽屉，目录浏览/上传/下载（进度）/删除/重命名/新建目录，复用已认证连接的第二 channel | 可用 | `src-tauri/src/sftp.rs`（russh-sftp 3.0）、`src/components/terminal/SftpPanel.vue`、`src/services/sftp.ts` |

## 技术栈

**前端**（`package.json`）：Vue 3.5、Pinia 4、rxjs 7（会话/前端事件流全部基于 Subject）、@xterm/xterm 5.5（addon-canvas / webgl / fit / search / unicode11）、Tailwind CSS 4（`@theme inline` token 体系）、reka-ui + class-variance-authority（UI 组件）、vue-i18n 11、yaml、nanoid。构建 Vite 8（端口 1420，`strictPort`，别名 `@` → `src/`），类型检查 `vue-tsc`，Lint `oxlint`，测试 `vitest`（node 环境）。

**后端**（`src-tauri/Cargo.toml`）：tauri 2（feature `macos-private-api`）、portable-pty 0.9、russh 0.63（SSH 客户端）、russh-sftp 3.0（SFTP）、rusqlite 0.40 bundled + aes-gcm + keyring + getrandom（敏感数据加密库）、tauri-plugin-opener、tauri-plugin-clipboard-manager、serde/serde_json、uuid、font-loader 0.11（系统字体枚举）。Release profile：`lto`、`opt-level = "s"`、`strip`。

**语言分布**（来自 codebase-memory 索引）：TypeScript 37 文件、Vue 15、Rust 6。

## 已知限制与未接线功能

- 配置键 `appearance.theme`、`appearance.tabBarPosition`、`terminal.lineHeightAdjustment` 无任何读取方（死键，保留以稳定配置结构）。
- `terminal.paletteGenerate` / `paletteHarmonious`（256 色扩展调色板生成，`src/lib/generatePalette.ts`）有效但未暴露到设置 UI。
- `terminal.fontWeight` / `fontWeightBold` / `wordSeparator` / `drawBoldTextInBrightColors` 由 xterm 消费；后两者已上设置 UI，字重两项仍无 UI。
- cwd 跟踪管道（`BaseSession.reportedCWD` → `getWorkingDirectory()`）无调用方；新标签不会继承工作目录（需要 shell 集成脚本上报才有数据源）。
- 内置配色采用**严格复刻 Tabby 口径**（2026-09-13 用户确认）：原第三方 14 套（Tokyo Night、Catppuccin Mocha、Solarized、One Dark 等）已从内置列表移除，旧配置引用这些名称时回退系统深浅默认配色。
- SSH 等远程档案未实现——Profiles 框架已按 `type` 判别字段预留扩展点，后续接入 `type: 'ssh'`。
- `services/shells.ts` 的 `defaultShell()` 已无调用方（档案化后由 config 的 `defaultProfile()` 取代）；`listShells()` 仍被首次档案生成使用。`terminal.loginShell` 配置键保留作为新档案生成的种子值，运行期生效项为各档案的 `loginShell` 字段。
- 窗口 vibrancy/透明已写代码但被 `#[cfg(any())]` 编译关闭（`src-tauri/src/lib.rs`，WKWebView 下渲染空白，待主题阶段重试）。
- 终端粘贴仍固定做 `\r\n → \n` 归一化（`TerminalPane.vue`），叠加在 `inputNewlines` 转换之前，防多行粘贴被 shell 逐行执行。

## 起源与设计文档

初始版本为一次性交付（git 历史仅一个初始化提交 + 后续修复提交），设计文档见 `docs/superpowers/specs/2026-09-12-scx-terminal-tauri-design.md`（Phase 0–7 MVP）。

## Related

- [architecture](architecture.md)
- [04-guides/development](../04-guides/development.md)
- `AGENTS.md`（仓库根）
