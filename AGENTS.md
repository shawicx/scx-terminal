# AI Code Agent

以下规则适用于本项目，AI 在修改代码前必须严格遵守。

---

## 1. 核心原则

0. **先了解项目再动手**
   - 执行任务或修改代码之前，如果需要了解项目，必须先阅读 `.wiki/` 中的项目概述和文档结构
   - 掌握项目的整体架构和设计原则后再开始工作，避免基于猜测的修改

1. **保持现有功能完整性**
   - 除非用户明确要求，不得修改现有功能行为、配置、接口、环境变量结构、目录结构、脚手架流程
   - 保持项目原有的构建流程和运行方式

2. **最小化修改**
   - 只做必要的修改，避免影响不相关的功能模块
   - 新增逻辑必须最小化修改范围，避免连锁兼容问题

3. **代码风格统一**
   - 遵循项目现有的代码风格和命名规范
   - 文件名统一使用 kebab-case 或遵循项目现有约定
   - 保持文件和目录结构的一致性

---

## 2. 依赖管理

1. **禁止降级依赖版本**，只有用户明确允许或必须降级以修复冲突时才可降版本且经过用户允许
2. **不得移除现有依赖**，除非用户明确要求或明确冗余且经过用户允许
3. **新增依赖必须遵循最新兼容版本策略（semver ^）**，并考虑兼容性
4. **修改依赖配置前必须先确认项目类型与构建体系**

---

## 3. 输出要求

1. 提供清晰的代码实现，优先输出代码与必要的命令步骤
2. 必要时说明修改原因，避免冗余解释性文本
3. 不得擅自生成总结文档、README 或说明文档（除非用户明确要求）

---

## 4. 禁止事项

以下行为全部禁止：

- 自动执行 `git commit`、`git push` 等提交操作（代码修改完成后由用户审查并手动提交）
- 擅自重构项目一级目录结构（如 src、public、dist、apps 等）
- 改变 lint / build 行为导致结果不同
- 将项目改为其他框架或运行环境
- 删除现有功能
- 擅自改变基础配置文件（如 tsconfig / vite / webpack / Cargo.toml / pom.xml）
- 插入当前环境无法使用的 API（例如在浏览器项目引入 fs/path 等 node-only API）
- **Superpowers spec/plan 文件错放**：spec 与 plan 文件只能存放在 `docs/superpowers/specs/` 和 `docs/superpowers/plans/` 下；禁止从 `.gitignore` 中删除 `docs/superpowers` 条目；禁止将 spec/plan 文件放到任何其他目录

---

## 5. 注释规范

**示例（TypeScript）：**

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

**强制要求：**

1. 每个文件必须有 `@description` 文件头注释（中文）
2. 每个函数必须有 `@description` 注释
3. 有参数的函数必须有 `@param` 注释
4. 有返回值的函数必须有 `@returns` 注释
5. 核心函数（命名策略、类型清理、生成器、解析器、转换器等）需要 `@example` 标签

**语言差异说明：**

- TypeScript / JavaScript：使用 JSDoc 风格（如上示例）
- Java：使用 Javadoc 风格（`/** ... */`），遵循 Java 既有规范
- Rust：使用 `///` 文档注释，遵循 rustdoc 规范（`# Arguments` / `# Returns` / `# Examples` 段）
- 各语言按各自规范实现上述 5 条要求的内容，不强制使用完全相同的标签名

---


---

## Tauri 项目规则

Tauri 项目同时包含前端（JS/TS）与后端（Rust），两套依赖体系独立维护。

### 包管理与运行时

1. **前端必须使用 `bun`**，Rust 后端使用 `cargo`，不得混用
2. **Bun 版本要求 1.4+**（前端包管理与构建工具链统一使用 Bun 运行时，锁定文件为 `bun.lock`）
3. Rust edition 必须与 `src-tauri/Cargo.toml` 中声明的版本一致（通常为 2021）

### 项目结构约定

遵循 Tauri 标准结构，不得擅自调整：

- `src/` 或前端根目录 — 前端代码（Vue/React/Svelte，遵循项目现状）
- `src-tauri/`
  - `src/main.rs` — Rust 入口
  - `src/lib.rs` — 应用逻辑（如使用 lib 结构）
  - `Cargo.toml` — Rust 依赖
  - `tauri.conf.json` — Tauri 配置（**含 security 字段**）
  - `icons/` — 应用图标
  - `capabilities/` — 权限配置（Tauri v2）

### 构建与测试命令

- `bun install` — 安装前端依赖
- `bun run app:dev` — 开发模式（同时启动前端与 Rust，等价 `tauri dev`）
- `bun run app:build` — 生产打包（等价 `tauri build`）
- `bun run dev` — 仅启动前端（用于纯前端调试）
- `cargo test --manifest-path src-tauri/Cargo.toml` — Rust 测试

### 依赖与配置规则

1. **`tauri.conf.json` 的 security 相关字段必须保留**（CSP、allowlist、capabilities 等），不得删除或弱化
2. 前后端通过 Tauri IPC（`invoke` / `#[tauri::command]`）通信，命令必须在 `invoke_handler` 中注册
3. Rust 依赖遵循 cargo semver，不得降级
4. 前端依赖遵循 bun 规范（新增依赖用 `bun add`，版本策略仍为 semver `^`）
5. `tauri.conf.json` 修改必须采取合并策略，不得重写整个文件
6. Tauri v2 项目权限必须在 `capabilities/` 下显式声明，不得通过 wildcard 放开

### 禁止事项

- 不得删除 `tauri.conf.json` 中的 security / CSP / capabilities 字段
- 不得在前端代码中直接调用 Rust crate（必须通过 IPC）
- 不得在 Rust 后端中改变 edition 版本（如从 2021 改为 2018）
- 不得擅自升级 Tauri 主版本（v1 ↔ v2 不兼容，迁移需用户明确批准）
- 不得破坏 `invoke_handler` 与前端 `invoke` 调用的对应关系
