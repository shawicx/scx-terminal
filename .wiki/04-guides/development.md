# 开发指南

## 环境要求

- Bun 1.4+（前端包管理与运行时统一使用 Bun，锁定文件 `bun.lock`，`package.json` 已声明 `packageManager: bun@1.4.1`；`tauri.conf.json` 的 `beforeDevCommand` 为 `bun run dev`）。
- Rust stable（edition 2021，见 `src-tauri/Cargo.toml`）。
- macOS（窗口配置/标题栏/locale 逻辑均为 mac 优先；`platform.ts` 区分平台）。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `bun install` | 安装前端依赖（以 `bun.lock` 为准） |
| `bun run app:dev`（= `tauri dev`） | 同时起 Vite(1420) + Rust，热更新；改 Rust 会自动重编译重启 |
| `bun run dev` | 仅前端（浏览器调试，无 PTY——终端功能不可用） |
| `bun run app:build`（= `tauri build`） | 生产打包 |
| `bun run build` | `vue-tsc --noEmit` + `vite build`（类型检查是构建闸门） |
| `bun run lint` / `bun run test` | oxlint / vitest（node 环境，`src/**/*.test.ts`） |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust 单测（Utf8Splitter 等） |

调试技巧：`SCX_DEVTOOLS=1 bun run app:dev` 打开 WebView devtools；前端所有未捕获错误/ Promise rejection 会经 `dev_log` 转发到 `tauri dev` 的 stdout（前缀 `VUE-ERR` / `JS-ERR` / `REJ`）。

## 常见坑

1. **`bun test` ≠ `bun run test`**：`bun test` 会调用 Bun 内置测试运行器、绕过 package.json 里的 vitest 脚本——跑测试必须用 `bun run test`。新增依赖一律 `bun add` / `bun add -d`，不要混用 npm/pnpm/yarn（会生成冲突的锁定文件）。
2. **端口 1420 被占用**：`strictPort: true`，已有 dev server 时再起 `tauri dev` 会失败（vite 报 Port in use），先结束旧进程。
3. **改 `SplitContainer`/`TerminalTabContent` 的布局要小心**：根容器必须保留 `.split-root`（flex:1），否则回到 0 宽度坍塌（终端整体不可见）。见 [02-frontend/app-shell-and-tabs](../02-frontend/app-shell-and-tabs.md)。
4. **PTY 初始尺寸**：新会话尺寸来自 `LocalSession.pendingResize`；调试"输入行提前换行"先查 spawn 时传入的 cols/rows（终端里 `tput cols` 应等于窗口实际列数）。
5. **首屏丢字节**：输出链有两层缓冲（`TauriPTYProxy.pendingChunks`、`BaseSession.initialDataBuffer`）；改动订阅时序前先读 [04-guides/key-flows](key-flows.md)。
6. **热键键名**：序列格式如 `⌘-Shift-P`；`getKeyName` 会剥掉 `Arrow` 前缀（`ArrowRight` → `Right`），配置默认值时需匹配该输出。
7. **禁止事项**（摘自 `AGENTS.md`）：不得自动 `git commit/push`；不得降级/删除依赖；不得弱化 `tauri.conf.json` 的 security/CSP/capabilities；不得把 Tauri v1↔v2 互迁；修改以最小化为原则。

## 测试清单（提交前）

- [ ] `bun run lint`、`bun run test`、`bun run build` 通过
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 通过
- [ ] 涉及终端行为的改动在 `bun run app:dev` 中实测：输入回显、新建标签提示符完整、`tput cols` 匹配窗口宽度、配色切换即时生效

## Related

- [04-guides/key-flows](key-flows.md)
- [01-overview/project-overview](../01-overview/project-overview.md)
- `AGENTS.md`（仓库根，完整规则）
