# 项目规约与协作文档

<details>
<summary>Relevant source files</summary>

- .oxlintrc.json
- AGENTS.md
- src-tauri/Cargo.toml
- src-tauri/src/lib.rs
- src-tauri/src/main.rs
- src-tauri/tauri.conf.json
</details>

本页汇总本项目的工具链规约、AI 协作规约（源自 `AGENTS.md`）与命名/结构约定，供新成员与 AI 代理在修改代码前对齐约束。所有条目均来自项目内配置文件与 `AGENTS.md`，未提供证据的方面一律省略。

---

## 一、工具链规约

项目已启用 Linter 与 EditorConfig 两套代码规范工具，配置状态与对应文件如下。

| 类别 | 是否启用 | 配置文件 | 说明 |
| --- | --- | --- | --- |
| Linter | 已启用（`hasLinter: true`） | `.oxlintrc.json` | 采用 oxlint 作为代码检查工具 |
| EditorConfig | 已启用（`hasEditorConfig: true`） | `.editorconfig` | 统一不同编辑器的编码、缩进、换行等基础行为 |

> 说明：数据仅提供 Linter 配置文件路径 `.oxlintrc.json`，未提供其具体规则内容，故不对规则细节展开；本节仅确认工具链已配置。锚点：`.oxlintrc.json`、`.editorconfig`。

### EditorConfig 原文

`.editorconfig` 完整内容如下（锚点：`.editorconfig`）：

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

### 缩进与格式规则归纳（依据 `.editorconfig`）

| 作用范围 | 属性 | 取值 | 约束含义 |
| --- | --- | --- | --- |
| 全局 `[*]` | `charset` | `utf-8` | 文件统一使用 UTF-8 编码 |
| 全局 `[*]` | `insert_final_newline`（待确认） | `true` | 文件结尾必须保留一个空行 |
| 全局 `[*]` | `indent_style`（待确认） | `space` | 缩进使用空格，禁止 Tab |
| 全局 `[*]` | `indent_size`（待确认） | `4` | 默认缩进为 4 个空格 |
| 全局 `[*]` | `end_of_line`（待确认） | `lf` | 换行符统一为 LF |
| 全局 `[*]` | `trim_trailing_whitespace`（待确认） | `true` | 去除行尾多余空白 |
| `*.yml` | `indent_size`（待确认） | `2` | YAML 文件缩进为 2 个空格（覆盖全局值） |
| `*.json` | `indent_size`（待确认） | `2` | JSON 文件缩进为 2 个空格（覆盖全局值） |

**关键点：**
- 默认缩进 **4 空格**，但 `*.yml` 与 `*.json` 例外，均为 **2 空格**。
- 文件编码、换行符、结尾换行、行尾空白在所有文件上统一受约束。

---

## 二、AI 协作规约（AGENTS.md 提炼）

以下内容提炼自 `AGENTS.md`，按主题分组。AI 在修改代码前必须严格遵守。

### 2.1 核心工作原则（锚点：`AGENTS.md` 第 1 节）

| 原则 | 具体要求 |
| --- | --- |
| 先了解项目再动手 | 执行任务前若需了解项目，必须先阅读 `.wiki/` 中的项目概述与文档结构，掌握整体架构后再动手，避免基于猜测的修改 |
| 保持现有功能完整性 | 除非用户明确要求，不得修改现有功能行为、配置、接口、环境变量结构、目录结构、脚手架流程；保持原有构建流程与运行方式 |
| 最小化修改 | 只做必要修改，避免影响不相关模块；新增逻辑须最小化修改范围，避免连锁兼容问题 |
| 代码风格统一 | 遵循项目现有代码风格与命名规范；文件名统一 kebab-case 或遵循现有约定；保持文件与目录结构一致性 |

### 2.2 依赖管理（锚点：`AGENTS.md` 第 2 节）

| 规则 | 内容 |
| --- | --- |
| 禁止降级依赖版本 | 仅当用户明确允许、或必须降级以修复冲突且经用户允许时才可降版本 |
| 不得移除现有依赖 | 除非用户明确要求，或确认冗余且经用户允许 |
| 新增依赖策略 | 必须遵循最新兼容版本策略（semver `^`），并考虑兼容性 |
| 修改前置条件 | 修改依赖配置前必须先确认项目类型与构建体系 |

### 2.3 输出要求（锚点：`AGENTS.md` 第 3 节）

| 规则 | 内容 |
| --- | --- |
| 输出形式 | 提供清晰代码实现，优先输出代码与必要命令步骤 |
| 说明程度 | 必要时说明修改原因，避免冗余解释性文本 |
| 文档生成限制 | 不得擅自生成总结文档、README 或说明文档（除非用户明确要求） |

### 2.4 禁止事项（锚点：`AGENTS.md` 第 4 节）

以下行为全部禁止：

| 禁止项 | 具体说明 |
| --- | --- |
| 自动提交操作 | 禁止自动执行 `git commit`、`git push` 等操作，代码修改后由用户审查并手动提交 |
| 重构一级目录结构 | 禁止擅自改动 `src`、`public`、`dist`、`apps` 等一级目录 |
| 改变 lint/build 行为 | 禁止改变导致结果不同的 lint / build 行为 |
| 更换框架或运行环境 | 禁止将项目改为其他框架或运行环境 |
| 删除现有功能 | 禁止删除现有功能 |
| 改动基础配置文件 | 禁止擅自改变 `tsconfig` / `vite` / `webpack` / `Cargo.toml` / `pom.xml` 等基础配置 |
| 插入不可用 API | 禁止插入当前环境无法使用的 API（如浏览器项目引入 `fs`/`path` 等 node-only API） |
| Superpowers 文件错放 | spec 与 plan 文件只能放 `docs/superpowers/specs/` 与 `docs/superpowers/plans/`；禁止从 `.gitignore` 删除 `docs/superpowers` 条目；禁止放到其他目录 |

### 2.5 注释规范（锚点：`AGENTS.md` 第 5 节）

**强制要求（每个文件/函数）：**

| 序号 | 要求 |
| --- | --- |
| 1 | 每个文件必须有 `@description` 文件头注释（中文） |
| 2 | 每个函数必须有 `@description` 注释 |
| 3 | 有参数的函数必须有 `@param` 注释 |
| 4 | 有返回值的函数必须有 `@returns` 注释 |
| 5 | 核心函数（命名策略、类型清理、生成器、解析器、转换器等）需有 `@example` 标签 |

**语言差异约定：**

| 语言 | 注释风格 |
| --- | --- |
| TypeScript / JavaScript | JSDoc 风格（`/** ... */`） |
| Java | Javadoc 风格（`/** ... */`），遵循 Java 既有规范 |
| Rust | `///` 文档注释，遵循 rustdoc 规范（`# Arguments` / `# Returns` / `# Examples` 段） |

> 各语言按各自规范实现上述 5 条要求的内容，不强制使用完全相同的标签名。`AGENTS.md` 中给出的 TypeScript 示例格式：

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

### 2.6 Tauri 项目规则（锚点：`AGENTS.md`「Tauri 项目规则」节）

Tauri 项目同时包含前端（JS/TS）与后端（Rust），两套依赖体系独立维护。

**包管理与运行时：**

| 规则 | 内容 |
| --- | --- |
| 包管理器分工 | 前端必须使用 `bun`，Rust 后端使用 `cargo`，不得混用 |
| Bun 版本 | 要求 1.4+，锁定文件为 `bun.lock` |
| Rust edition | 必须与 `src-tauri/Cargo.toml` 中声明版本一致（通常为 2021） |

**项目结构约定（不得擅自调整）：**

| 路径 | 说明 |
| --- | --- |
| `src/` 或前端根目录 | 前端代码（Vue/React/Svelte，遵循项目现状） |
| `src-tauri/src/main.rs` | Rust 入口 |
| `src-tauri/src/lib.rs` | 应用逻辑（如使用 lib 结构） |
| `src-tauri/Cargo.toml` | Rust 依赖 |
| `src-tauri/tauri.conf.json` | Tauri 配置（含 security 字段） |
| `src-tauri/icons/` | 应用图标 |
| `src-tauri/capabilities/` | 权限配置（Tauri v2） |

**构建与测试命令：**

| 命令 | 用途 |
| --- | --- |
| `bun install` | 安装前端依赖 |
| `bun run app:dev` | 开发模式（同时启动前端与 Rust，等价 `tauri dev`） |
| `bun run app:build` | 生产打包（等价 `tauri build`） |
| `bun run dev` | 仅启动前端（用于纯前端调试） |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust 测试 |

**依赖与配置规则：**

| 规则 | 内容 |
| --- | --- |
| security 字段保留 | `tauri.conf.json` 的 security 相关字段（CSP、allowlist、capabilities 等）必须保留，不得删除或弱化 |
| IPC 注册 | 前后端通过 Tauri IPC（`invoke` / `#[tauri::command]`）通信，命令必须在 `invoke_handler` 中注册 |
| Rust 依赖 | 遵循 cargo semver，不得降级 |
| 前端依赖 | 遵循 bun 规范（新增依赖用 `bun add`，版本策略为 semver `^`） |
| 配置文件修改 | `tauri.conf.json` 修改必须采取合并策略，不得重写整个文件 |
| 权限声明 | Tauri v2 项目权限必须在 `capabilities/` 下显式声明，不得通过 wildcard 放开 |

**Tauri 专属禁止事项：**

| 禁止项 |
| --- |
| 不得删除 `tauri.conf.json` 中的 security / CSP / capabilities 字段 |
| 不得在前端代码中直接调用 Rust crate（必须通过 IPC） |
| 不得在 Rust 后端改变 edition 版本（如从 2021 改为 2018） |
| 不得擅自升级 Tauri 主版本（v1 ↔ v2 不兼容，迁移需用户明确批准） |
| 不得破坏 `invoke_handler` 与前端 `invoke` 调用的对应关系 |

---

## 三、命名与结构规约

以下内容仅基于 `AGENTS.md` 与工具链配置可确定的部分归纳，未涉及方面不予展开。

### 3.1 命名规约（锚点：`AGENTS.md` 第 1 节）

| 方面 | 约定 |
| --- | --- |
| 文件名 | 统一使用 kebab-case，或遵循项目现有约定 |
| 代码风格 | 遵循项目现有代码风格与命名规范 |

### 3.2 结构与目录规约

| 方面 | 约定 | 锚点 |
| --- | --- | --- |
| 目录结构一致性 | 保持文件与目录结构的一致性 | `AGENTS.md` 第 1 节 |
| 一级目录 | 禁止擅自重构 `src`、`public`、`dist`、`apps` 等一级目录 | `AGENTS.md` 第 4 节 |
| Tauri 标准结构 | 遵循 Tauri 标准结构（`src/`、`src-tauri/` 等），不得擅自调整 | `AGENTS.md`「Tauri 项目规则」节 |
| Spec/Plan 存放 | spec 与 plan 文件只能存放于 `docs/superpowers/specs/` 与 `docs/superpowers/plans/` | `AGENTS.md` 第 4 节 |

### 3.3 文件格式规约（锚点：`.editorconfig`）

| 方面 | 约定 |
| --- | --- |
| 编码 | UTF-8 |
| 缩进 | 空格，默认 4 个；`*.yml`、`*.json` 为 2 个 |
| 换行符 | LF |
| 文件结尾 | 必须保留结尾空行 |
| 行尾空白 | 自动去除 |

---

## 待确认

| 事项 | 缺失证据 |
| --- | --- |
| `.oxlintrc.json` 的具体规则内容 | 数据仅提供配置文件路径，未提供其规则项，无法说明启用了哪些 lint 规则 |

> 其余关键方面（Linter 是否启用、EditorConfig 内容、AGENTS.md 规约要点）数据均已提供，不再标注待确认。
## Related

- 同目录：[constraints.md](constraints.md)
- 共享 3 个源文件、共享 13 个符号：[onboarding.md](../05-guides/onboarding.md)
- 共享 12 个符号：[troubleshooting.md](../05-guides/troubleshooting.md)
- 共享 8 个符号：[environment.md](../01-overview/environment.md)
- 总入口：[README](../README.md)
