# 项目规约与工具链约定

<details>
<summary>Relevant source files</summary>

- .oxlintrc.json
- AGENTS.md
- src-tauri/Cargo.toml
</details>

> 本页汇总本仓库的开发规约：Linter / EditorConfig 工具链配置状态、`AGENTS.md` 中面向 AI 协作者的行为规约要点，以及可据此确定的命名与结构约定。新成员与 AI 协作者在动手前应先阅读本页。

---

## 1. 工具链规约

本项目的代码质量与格式由 Linter 与 EditorConfig 两层配置约束。

| 工具 | 配置状态 | 配置文件 | 作用口径 |
| --- | --- | --- | --- |
| Linter | 已启用 | `.oxlintrc.json` | 静态代码检查（oxlint） |
| EditorConfig | 已启用 | `.editorconfig` | 编辑器层面的缩进 / 换行 / 编码统一 |

### 1.1 Linter 配置

- 已配置 Linter，配置文件为 `.oxlintrc.json`（见 `.oxlintrc.json`）。
- `AGENTS.md` 明确要求：禁止改变 lint / build 行为导致结果不同（`AGENTS.md#4-禁止事项`）。

### 1.2 EditorConfig 原文

以下为 `.editorconfig` 的完整配置内容：

```ini
root = true

[*]
charset = utf-8
insert_final_newline = true
indent_style = space
indent_size = 4
end_of_line = lf
trim_trailing_whitespace = true

[*.yml]
indent_size = 2

[*.json]
indent_size = 2
```

**规约提炼：**

| 项目 | 约定值 | 作用范围 |
| --- | --- | --- |
| 字符编码 | `utf-8` | 所有文件 |
| 文件末尾换行 | 必须插入（`insert_final_newline = true`） | 所有文件 |
| 缩进风格 | 空格（`indent_style = space`） | 所有文件 |
| 缩进宽度 | 4 空格 | 所有文件 |
| 换行符 | `lf` | 所有文件 |
| 行尾空白 | 必须裁剪（`trim_trailing_whitespace = true`） | 所有文件 |
| YAML 缩进 | 2 空格 | `*.yml` |
| JSON 缩进 | 2 空格 | `*.json` |

---

## 2. AI 协作规约（AGENTS.md 提炼）

`AGENTS.md` 定义了 AI 在修改代码前必须遵守的规则。以下按主题提炼要点。

### 2.1 核心工作原则（`AGENTS.md#1-核心原则`）

| 原则 | 具体要求 |
| --- | --- |
| 先了解项目再动手 | 修改前如需了解项目，必须先阅读 `.wiki/` 中的项目概述与文档结构，掌握整体架构后再工作，避免基于猜测的修改 |
| 保持现有功能完整性 | 除非用户明确要求，不得修改现有功能行为、配置、接口、环境变量结构、目录结构、脚手架流程；保持原有构建流程与运行方式 |
| 最小化修改 | 只做必要修改，避免影响不相关模块；新增逻辑应最小化修改范围，避免连锁兼容问题 |
| 代码风格统一 | 遵循项目现有代码风格与命名规范；文件名统一用 kebab-case 或遵循现有约定；保持文件与目录结构一致 |

### 2.2 依赖管理（`AGENTS.md#2-依赖管理`）

- 禁止降级依赖版本；仅当用户明确允许，或必须降级以修复冲突且经用户允许时才可降版本。
- 不得移除现有依赖，除非用户明确要求，或确认冗余且经用户允许。
- 新增依赖必须遵循最新兼容版本策略（semver `^`），并考虑兼容性。
- 修改依赖配置前必须先确认项目类型与构建体系。

### 2.3 输出要求（`AGENTS.md#3-输出要求`）

- 提供清晰的代码实现，优先输出代码与必要的命令步骤。
- 必要时说明修改原因，避免冗余解释性文本。
- 不得擅自生成总结文档、README 或说明文档（除非用户明确要求）。

### 2.4 禁止事项（`AGENTS.md#4-禁止事项`）

以下行为全部禁止：

| 类别 | 禁止内容 |
| --- | --- |
| 版本控制操作 | 自动执行 `git commit`、`git push` 等提交操作（修改完成后由用户审查并手动提交） |
| 目录结构 | 擅自重构项目一级目录结构（如 src、public、dist、apps 等） |
| 构建行为 | 改变 lint / build 行为导致结果不同 |
| 技术栈 | 将项目改为其他框架或运行环境 |
| 功能删除 | 删除现有功能 |
| 基础配置 | 擅自改变基础配置文件（如 tsconfig / vite / webpack / Cargo.toml / pom.xml） |
| 环境 API | 插入当前环境无法使用的 API（例如在浏览器项目引入 fs/path 等 node-only API） |
| spec/plan 文件 | spec 与 plan 文件只能存放在 `docs/superpowers/specs/` 和 `docs/superpowers/plans/` 下；禁止从 `.gitignore` 中删除 `docs/superpowers` 条目；禁止放到其他目录 |

### 2.5 注释规范（`AGENTS.md#5-注释规范`）

**强制要求：**

1. 每个文件必须有 `@description` 文件头注释（中文）。
2. 每个函数必须有 `@description` 注释。
3. 有参数的函数必须有 `@param` 注释。
4. 有返回值的函数必须有 `@returns` 注释。
5. 核心函数（命名策略、类型清理、生成器、解析器、转换器等）需要 `@example` 标签。

**语言差异：**

| 语言 | 注释风格 | 说明 |
| --- | --- | --- |
| TypeScript / JavaScript | JSDoc（`/** ... */`） | 按示例风格实现上述 5 条 |
| Java | Javadoc（`/** ... */`） | 遵循 Java 既有规范 |
| Rust | `///` 文档注释 | 遵循 rustdoc 规范（`# Arguments` / `# Returns` / `# Examples` 段） |

> 各语言按各自规范实现上述 5 条要求的内容，不强制使用完全相同的标签名。

**TypeScript 示例（摘自 `AGENTS.md#5-注释规范`）：**

```typescript
/**
 * @description 从 Apifox 平台获取 OpenAPI 数据
 * @param config API 配置对象
 * @returns Promise<ApiData> API 数据
 *
 * @example const data = await fetchApifoxData({ source: '...', token: '...' });
 *
 */
```

---

## 3. Tauri 项目规则（`AGENTS.md#tauri-项目规则`）

本节规约针对同时包含前端（JS/TS）与 Rust 后端的 Tauri 项目，两套依赖体系独立维护。

### 3.1 包管理与运行时

1. 前端必须使用 `bun`，Rust 后端使用 `cargo`，不得混用。
2. Bun 版本要求 1.4+，锁定文件为 `bun.lock`。
3. Rust edition 必须与 `src-tauri/Cargo.toml` 中声明的版本一致（通常为 2021）。

### 3.2 项目结构约定

遵循 Tauri 标准结构，不得擅自调整：

- `src/` 或前端根目录 — 前端代码（Vue/React/Svelte，遵循项目现状）
- `src-tauri/`
  - `src/main.rs` — Rust 入口
  - `src/lib.rs` — 应用逻辑（如使用 lib 结构）
  - `Cargo.toml` — Rust 依赖
  - `tauri.conf.json` — Tauri 配置（含 security 字段）
  - `icons/` — 应用图标
  - `capabilities/` — 权限配置（Tauri v2）

### 3.3 构建与测试命令

| 命令 | 用途 |
| --- | --- |
| `bun install` | 安装前端依赖 |
| `bun run app:dev` | 开发模式（同时启动前端与 Rust，等价 `tauri dev`） |
| `bun run app:build` | 生产打包（等价 `tauri build`） |
| `bun run dev` | 仅启动前端（用于纯前端调试） |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust 测试 |

### 3.4 依赖与配置规则

1. `tauri.conf.json` 的 security 相关字段必须保留（CSP、allowlist、capabilities 等），不得删除或弱化。
2. 前后端通过 Tauri IPC（`invoke` / `#[tauri::command]`）通信，命令必须在 `invoke_handler` 中注册。
3. Rust 依赖遵循 cargo semver，不得降级。
4. 前端依赖遵循 bun 规范（新增依赖用 `bun add`，版本策略仍为 semver `^`）。
5. `tauri.conf.json` 修改必须采取合并策略，不得重写整个文件。
6. Tauri v2 项目权限必须在 `capabilities/` 下显式声明，不得通过 wildcard 放开。

### 3.5 禁止事项（Tauri）

- 不得删除 `tauri.conf.json` 中的 security / CSP / capabilities 字段。
- 不得在前端代码中直接调用 Rust crate（必须通过 IPC）。
- 不得在 Rust 后端中改变 edition 版本（如从 2021 改为 2018）。
- 不得擅自升级 Tauri 主版本（v1 ↔ v2 不兼容，迁移需用户明确批准）。
- 不得破坏 `invoke_handler` 与前端 `invoke` 调用的对应关系。

---

## 4. 命名与结构规约

> 以下内容仅基于 `AGENTS.md` 与工具链配置可确定的部分归纳。

### 4.1 文件与命名

| 规约项 | 要求 | 依据 |
| --- | --- | --- |
| 文件名 | 统一使用 kebab-case，或遵循项目现有约定 | `AGENTS.md#1-核心原则` |
| 目录/文件结构 | 保持一致性，不得擅自调整 | `AGENTS.md#1-核心原则` |
| 缩进与换行 | 4 空格缩进、LF 换行、UTF-8 编码、末尾补空行 | `.editorconfig` |
| YAML / JSON | 缩进宽度为 2 空格 | `.editorconfig` |

### 4.2 目录结构红线

- 不得擅自重构项目一级目录结构（如 src、public、dist、apps 等）（`AGENTS.md#4-禁止事项`）。
- Tauri 项目需遵循标准结构：前端根目录 / `src-tauri/`（含 `src/main.rs`、`Cargo.toml`、`tauri.conf.json`、`icons/`、`capabilities/` 等）（`AGENTS.md#tauri-项目规则`）。
- spec / plan 文件必须存放于 `docs/superpowers/specs/` 与 `docs/superpowers/plans/`，禁止改放其他目录（`AGENTS.md#4-禁止事项`）。

### 4.3 注释结构约定

- 文件级：必须有中文 `@description` 文件头注释。
- 函数级：必须有 `@description`；有参数补 `@param`；有返回值补 `@returns`；核心函数补 `@example`。
- 语言差异：TS/JS 用 JSDoc、Java 用 Javadoc、Rust 用 `///` + rustdoc 段（`AGENTS.md#5-注释规范`）。

---

## 5. 提交与协作约定

- 代码修改完成后，由用户审查并手动提交；AI 不得自动执行 `git commit`、`git push`（`AGENTS.md#4-禁止事项`）。
- 修改前如需了解项目，应先查阅 `.wiki/` 中的项目概述和文档结构（`AGENTS.md#1-核心原则`）。
- 不得擅自生成总结文档、README 或说明文档，除非用户明确要求（`AGENTS.md#3-输出要求`）。

---

### 待确认

- 前端框架具体选型（Vue / React / Svelte）：`AGENTS.md` 中标注“遵循项目现状”，本次数据未提供前端代码锚点，无法确定具体框架。
- oxlint 的具体规则集与启用项：数据仅提供了配置文件路径 `.oxlintrc.json`，未提供其内容，规则细节待查阅该文件本身。
## Related

- 同目录：[constraints.md](constraints.md)
- 共享 3 个源文件、共享 7 个符号：[overview.md](../01-overview/overview.md)
- 共享 1 个源文件、共享 8 个符号：[onboarding.md](../05-guides/onboarding.md)
- 共享 7 个符号：[environment.md](../01-overview/environment.md)
- 总入口：[README](../README.md)

<!-- wiki:source: llm -->
