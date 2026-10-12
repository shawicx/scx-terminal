# 贡献指南

感谢关注 scx-terminal！欢迎通过 Issue 报告问题、提交 Pull Request 改进代码或文档。

## 环境准备

- **Bun 1.4+**（前端工具链统一使用 Bun，锁定文件为 `bun.lock`）
- **Rust stable**（Rust 后端，edition 2021）
- 平台依赖参考 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/)

```bash
bun install
bun run app:dev   # 启动完整桌面应用（开发模式）
```

## 开发工作流

| 命令 | 说明 |
| --- | --- |
| `bun run dev` | 仅启动前端 Vite 开发服务器 |
| `bun run app:dev` | 启动完整桌面应用（开发模式） |
| `bun run app:build` | 构建发布版安装包 |
| `bun run lint` | oxlint 检查前端代码 |
| `bun run test` | vitest 单元测试 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust 单元测试 |

提交前请确保：

1. `bun run lint` 与 `bun run test` 通过
2. `cargo test --manifest-path src-tauri/Cargo.toml` 通过
3. 新增公共函数/文件带有 `@description` 等文档注释（各语言按各自规范）
4. 不得降级依赖版本、不得移除 `tauri.conf.json` 中的 security/CSP/capabilities 字段

## 提交信息规范

项目使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，changelog 由 [git-cliff](./cliff.toml) 从提交历史生成：

```
<type>: <中文描述>
```

合法 type：`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`。

示例：

```
fix: 修复终端分屏关闭后焦点丢失的问题
docs: 补充 SFTP 转发的使用说明
```

## Pull Request 要求

- 一个 PR 聚焦一个改动主题，避免混入无关格式化/重构
- 描述清楚改动动机与影响范围；涉及 UI 变化请附截图
- 新增依赖需说明用途与选型理由（遵循 semver `^`，禁止降级）
- 请勿在 PR 中包含 `git commit` 之外的发布操作；版本号与 tag 由维护者管理

## 报告 Bug

请通过 [Issue 模板](https://github.com/shawicx/scx-terminal/issues/new/choose) 提交，尽量附上：

- 操作系统与版本、应用版本（设置页「关于」可查）
- 复现步骤与预期/实际行为
- 日志（设置页可开启调试日志，目录见 [README](./README.md#数据目录)）

## 安全问题

请勿通过公开 Issue 报告安全漏洞，参见 [SECURITY.md](./SECURITY.md)。

## 行为准则

参与本项目即表示同意遵守 [行为准则](./CODE_OF_CONDUCT.md)。
