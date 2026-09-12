# scx-terminal

一个基于 **Tauri V2 + Rust + Vue 3 + shadcn-vue** 的跨平台终端应用。

由开源项目 [Tabby](https://github.com/Eugeny/tabby)（MIT License）改造而来，重写了整体架构：

- **后端**：Rust（Tauri V2），PTY 管理 / 配置持久化 / shell 探测
- **前端**：Vue 3 + Vite + Tailwind CSS 4 + shadcn-vue，xterm.js 终端渲染（WebGL 优先）
- **工具链**：bun（包管理）、oxlint（Lint）

## 开发

```bash
bun install
bun run tauri dev
```

常用脚本：

| 命令 | 说明 |
| --- | --- |
| `bun run dev` | 仅启动前端 Vite 开发服务器 |
| `bun run tauri dev` | 启动完整桌面应用（开发模式） |
| `bun run tauri build` | 构建发布版安装包 |
| `bun run lint` | oxlint 检查 |
| `bun run test` | vitest 单元测试 |

## 目录结构

```
src/          Vue 前端（components / stores / services / lib / i18n）
src-tauri/    Rust 后端（pty 背压队列 / config 持久化 / shells 探测）
docs/         设计文档（Tabby → Tauri 移植记录）
```

## 构建产物

`bun run tauri build` 产出 `src-tauri/target/release/bundle/macos/scx-terminal.app`
（约 5MB）。DMG 由 tauri 的美化脚本（create-dmg，依赖 Finder/AppleScript 权限）
生成；在无 GUI 权限的环境可用 hdiutil 兜底：

```bash
hdiutil create -volname scx-terminal \
  -srcfolder src-tauri/target/release/bundle/macos/scx-terminal.app \
  -ov -format UDZO scx-terminal.dmg
```

## 调试

- `SCX_DEVTOOLS=1 bun run tauri dev` 自动打开 WebView Inspector
- 前端错误会转发到 Rust 控制台（`[scx:js]` 前缀）

## 许可

本项目衍生自 Tabby（Copyright (c) 2018 Eugene Pankov），沿用 MIT License，见 [LICENSE](./LICENSE)。
