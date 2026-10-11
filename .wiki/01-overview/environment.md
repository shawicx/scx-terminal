# 环境与运行 — scx-terminal v0.2.2

<details>
<summary>Relevant source files</summary>

- package.json
- vite.config.ts
</details>

本页说明 scx-terminal 的运行环境约束（模块制式、包管理器）、可执行的脚本命令及其产出，以及构建期会被读取的环境变量，用于在本地正确准备环境并跑通全部命令。

## 项目信息

| 项 | 值 |
| --- | --- |
| 包名 | scx-terminal |
| 版本 | 0.2.2 |
| 模块运行时 | ESM |
| Node 版本约束 | 未声明（数据中无 node 版本/engines 约束） |
| 包管理器 | bun |

**运行时与包管理器的实际影响**

- **ESM**：项目按 ECMAScript Module 解析，源码与配置文件（如 `vite.config.ts`）应采用 `import` / `export` 语法，不能使用 `require()`、`module.exports`（待确认） 等 CJS 写法；ESM 下没有 CJS 的 `__dirname`（待确认） / `__filename`（待确认），需改用 `import.meta.url` 推导路径；引用本地文件时必须带扩展名语义由打包器处理，而依赖包中标注为 ESM/CJS 双出口的会按 `import` 条件解析。由于 `build` 链路包含 `vue-tsc --noEmit` 的严格类型检查，模块解析模式不一致（例如在 ESM 配置文件中混用 CJS 写法）会直接导致构建失败。
- **包管理器 bun**：安装依赖统一使用 `bun install`（生成/读取 `bun.lock` 类锁文件），不会走 npm/yarn 的锁文件流程；执行脚本使用 `bun run <script>`，也可用 `bun <script>` 简写（如 `bun dev`）；脚本体内调用的外部命令（`vite`、`vue-tsc`、`tauri`、`oxlint`、`vitest`）由 bun 从已安装依赖的可执行文件中解析，因此**必须先安装依赖再执行脚本**，否则会出现命令不存在。若团队其他成员使用 npm/pnpm，命令前缀需相应换成 `npm run` / `pnpm run`，但锁文件与安装结果不由本页保证一致。

## 脚本命令

以下脚本定义均来自 `package.json` 的 scripts 段，执行前缀统一为 `bun run`（可省略 `run`）。

| 命令 | 脚本内容 | 行为与预期产出 |
| --- | --- | --- |
| `bun run dev` | `vite` | 启动 Vite 开发服务器，以项目根为基准做依赖预构建与热更新（HMR）；终端打印本地访问地址，修改 `src` 下的模块会即时反映到浏览器，不产生磁盘产物。 |
| `bun run build` | `vue-tsc --noEmit && vite build` | 两阶段串行：先由 `vue-tsc` 对 `.vue` 与 `.ts` 做类型检查且**不输出**声明文件（`--noEmit`）；类型检查通过后才执行 `vite build` 生成生产打包产物（默认输出目录由 Vite 配置决定）。任一步失败即中断，不会产出可用构建物。 |
| `bun run preview` | `vite preview` | 以静态服务器方式预览已构建的生产产物，用于本地验证 `build` 结果；需先成功执行过 `build`，否则无可预览内容。 |
| `bun run app:dev` | `tauri dev` | 以桌面应用形态启动开发模式：前端侧复用开发服务器，同时编译并运行 Rust 侧壳程序，得到一个可交互的原生窗口，支持前后端联调。 |
| `bun run app:build` | `tauri build` | 以桌面应用形态做发布构建，输出平台安装包/可执行文件。属于耗时命令，会先跑前端产物构建再编译原生侧。 |
| `bun run lint` | `oxlint src` | 使用 oxlint 对 `src` 目录做静态检查，输出违规项列表；不修改文件，退出码非 0 表示存在 lint 问题。 |
| `bun run test` | `vitest run` | 以单次运行模式（非 watch）执行 vitest 测试并输出结果摘要，适合 CI 或本地一次性验证。 |

**执行顺序建议**：首次准备环境 → `bun install` → `bun run lint` / `bun run test` 做快速反馈 → `bun run dev` 进行日常开发 → `bun run build` 验证生产打包 → `bun run app:dev` / `bun run app:build` 走桌面端链路。

**前置条件说明**：`app:dev` 与 `app:build` 调用的是 Tauri CLI，桌面端构建依赖对应平台的原生编译工具链（Rust 工具链与系统级构建依赖），这类依赖不由本项目的脚本安装，需在机器上预先具备。

## 环境变量

| 变量名 | 敏感 | 生产引用 |
| --- | --- | --- |
| `TAURI_ENV_HOST` | 否 | `vite.config.ts` |
| `TAURI_ENV_DEBUG` | 否 | `vite.config.ts` |

两者均为非敏感变量，且都只出现在构建配置文件 `vite.config.ts` 中被读取。从变量名可谨慎推断它们与 Tauri 构建期的宿主目标/调试标记相关，但**具体取值含义、生效条件与默认值见 `vite.config.ts` 中的读取逻辑**，本页不做展开。这两个变量通常由 Tauri CLI 在调用前端构建时注入，日常直接执行 `bun run dev` / `bun run build` 时一般无需手动设置。
## Related

- 同目录：[overview.md](overview.md) · [tech-stack.md](tech-stack.md)
- 共享 29 个符号：[onboarding.md](../05-guides/onboarding.md)
- 共享 1 个源文件、共享 24 个符号：[troubleshooting.md](../05-guides/troubleshooting.md)
- 共享 7 个符号：[conventions.md](../06-constraints/conventions.md)
- 总入口：[README](../README.md)

<!-- wiki:source: llm -->
