# 环境与运行说明（scx-terminal）

<details>
<summary>Relevant source files</summary>

- package.json
- vite.config.ts
</details>

本页说明 `scx-terminal`（v0.2.1）的运行时形态、包管理器、可执行脚本与构建期环境变量，用于准备本地开发环境并正确执行全部命令。

## 项目信息

| 项目 | 值 |
| --- | --- |
| 包名 | `scx-terminal` |
| 版本 | `0.2.1` |
| 运行时模块制式 | ESM |
| 包管理器 | bun |

**运行时与包管理器的实际影响**

- **ESM**：项目以 ESM 加载，源码与配置文件（如 `vite.config.ts`）应使用 `import` / `export` 语法，不应使用 `require()` / `module.exports`（待确认）；引用仅提供 CommonJS 入口的依赖时按 ESM 互操作规则取默认导出。ESM 下相对导入路径的解析以文件为单位，路径扩展名与目录索引的处理与 CJS 不同，引用模块时需写清可解析的路径。
- **bun**：依赖安装使用 `bun install`（依据包管理器为 bun），执行脚本使用 `bun run <script>`（或 `bun <script>` 简写）。脚本内容本身调用的是 `vite`、`vue-tsc`、`tauri`、`oxlint`、`vitest`，这些可执行文件由 bun 安装的依赖提供并放入其可执行路径中，因此安装步骤必须先于脚本执行。

> 依赖清单、Node 版本约束与锁文件信息未在本次数据中提供，故不在此列出。

## 脚本命令

数据中 `scripts` 提供了 7 条命令，逐条说明如下：

| 命令 | 脚本内容 | 行为与预期产出 |
| --- | --- | --- |
| `dev` | `vite` | 启动 Vite 开发服务器，进入前端开发模式（带热更新）。产出：一个本地开发服务（监听地址与端口未在数据中提供）。 |
| `build` | `vue-tsc --noEmit && vite build` | 两阶段串行：先用 `vue-tsc` 做类型检查且 `--noEmit` 表示不输出类型产物；类型检查通过后才执行 `vite build` 生成生产构建产物。产出：构建输出目录；任一类型错误会以非零退出码中断，构建不会发生。 |
| `preview` | `vite preview` | 以本地静态服务器方式预览 `build` 生成的生产产物，用于构建结果验证。产出：一个本地预览服务（地址与端口未在数据中提供）。 |
| `app:dev` | `tauri dev` | 以 Tauri 开发模式启动桌面应用（前端资源 + Rust 侧编译运行）。产出：一个可交互的桌面应用开发实例。 |
| `app:build` | `tauri build` | 构建 Tauri 桌面应用的发布产物。产出：可分发的应用安装包/可执行产物（具体目标平台与产物路径未在数据中提供）。 |
| `lint` | `oxlint src` | 使用 oxlint 对 `src` 目录做静态检查。产出：lint 报告；存在违规时以非零退出码结束。 |
| `test` | `vitest run` | 以单次运行（非 watch）方式执行 Vitest 测试套件。产出：测试结果汇总，失败时非零退出码，适合 CI 使用。 |

**由脚本内容可确认的技术栈线索**（均来自上表脚本字符串）：

| 线索 | 证据 |
| --- | --- |
| Vue + TypeScript | `build` 脚本使用 `vue-tsc --noEmit`（`package.json` scripts.build） |
| Vite 作为前端构建/开发工具 | `dev` / `build` / `preview` 脚本调用 `vite`、`vite build`、`vite preview`（`package.json` scripts） |
| Tauri 作为桌面应用外壳 | `app:dev` / `app:build` 脚本调用 `tauri dev`、`tauri build`（`package.json` scripts） |
| Vitest 作为测试运行器 | `test` 脚本调用 `vitest run`（`package.json` scripts.test） |
| oxlint 作为 lint 工具 | `lint` 脚本调用 `oxlint src`（`package.json` scripts.lint） |

## 环境变量

| 变量名 | 敏感 | 生产引用 |
| --- | --- | --- |
| `TAURI_ENV_HOST` | 否 | `vite.config.ts` |
| `TAURI_ENV_DEBUG` | 否 | `vite.config.ts` |

- 用途：见生产引用。数据仅表明这两个变量在 `vite.config.ts` 中被引用，未提供默认值、是否必填、生效范围（构建期/运行期）或取值语义，故不进一步推断其具体作用。
- 两个变量均被标记为**非敏感**，可以出现在配置文件中，无需按密钥方式管理。
- *推断*：变量名以前缀 `TAURI_ENV_` 开头，且项目通过 `app:dev` / `app:build` 调用 Tauri（`package.json` scripts），推断其与 Tauri CLI 在构建/开发流程中注入的环境变量相关；该推断仅基于变量命名与实际引用位置（`vite.config.ts`），不含具体取值含义。

## 环境准备与运行流程

按下列顺序可在本机准备并跑通全部命令（命令前缀按包管理器为 bun 确定）：

| 步骤 | 命令 | 说明 |
| --- | --- | --- |
| 1. 安装依赖 | `bun install` | 安装前端与工具链依赖，提供 `vite` / `vue-tsc` / `tauri` / `oxlint` / `vitest` 可执行文件。 |
| 2. 前端开发 | `bun run dev` | 对应 `dev` 脚本，启动 Vite 开发服务器。 |
| 3. 类型检查 + 生产构建 | `bun run build` | 对应 `build` 脚本，先类型检查再构建。 |
| 4. 本地预览构建产物 | `bun run preview` | 对应 `preview` 脚本。 |
| 5. 静态检查 | `bun run lint` | 对应 `lint` 脚本，检查范围为 `src`。 |
| 6. 运行测试 | `bun run test` | 对应 `test` 脚本，单次运行测试。 |
| 7. 桌面应用开发 | `bun run app:dev` | 对应 `app:dev` 脚本，进入 Tauri 开发模式。 |
| 8. 桌面应用打包 | `bun run app:build` | 对应 `app:build` 脚本，产出可分发的桌面应用。 |

**执行顺序注意事项**

- `build` 与 `preview` 构成一条链：`preview` 预览的对象来自 `build`，未先执行 `build` 时 `preview` 无有效产物可预览（依据脚本定义：`build` = `vue-tsc --noEmit && vite build`，`preview` = `vite preview`）。
- `app:dev` / `app:build` 属于 Tauri 流程，与纯前端脚本（`dev` / `build` / `preview`）是两条并行的入口，前者额外涉及桌面端编译，环境要求高于后者。
- `test` 使用 `vitest run` 而非 watch 模式，可在无交互环境（如 CI）中直接使用。

## 缺口说明

- 本次数据未提供 Node 版本约束、依赖清单与锁文件信息，无法据此给出运行时版本校验建议。
- 两个 `TAURI_ENV_*` 变量的默认值、必填性与生效时机未提供，仅能确认其引用位置为 `vite.config.ts`。
## Related

- 同目录：[overview.md](overview.md) · [tech-stack.md](tech-stack.md)
- 共享 1 个源文件、共享 32 个符号：[onboarding.md](../05-guides/onboarding.md)
- 共享 23 个符号：[troubleshooting.md](../05-guides/troubleshooting.md)
- 共享 8 个符号：[conventions.md](../06-constraints/conventions.md)
- 总入口：[README](../README.md)
