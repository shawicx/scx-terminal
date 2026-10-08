# 环境与运行文档（scx-terminal）

本页描述 `scx-terminal` 的包元信息、运行时形态、可用脚本命令以及环境变量，用于准备开发/构建环境并正确执行全部脚本。

> 说明：本页数据全部来自包清单（package manifest）字段，数据源未提供源码文件路径与行号，因此以下事实以清单字段名为准，不附源码锚点。

## 项目信息

| 项目 | 值 |
| --- | --- |
| 包名 | `scx-terminal` |
| 版本 | `0.2.0` |
| 运行时模块体系 | ESM |
| Node 版本约束 | 数据未提供 |
| 包管理器 | bun |

**运行时与包管理器的实际影响：**

- 包以 **ESM** 形式声明（`runtime: ESM`）。在此形态下，源码与配置中的模块引用必须使用 `import` / `export` 语法；若出现 `require(...)`、`module.exports`（待确认）、`__dirname`（待确认） 等 CommonJS 专有写法，会与 ESM 解析语义冲突，需改为 ESM 等价写法（如 `import.meta.url` 推导目录）。同时，`.js` 文件被按 ESM 解析，不再默认按 CJS 解析。
- 包管理器为 **bun**。所有安装与脚本执行命令均以 bun 前缀书写：依赖安装用 `bun install`，脚本执行用 `bun run <script>`（也可用 `bun <script>` 简写，但 `bun run` 形式对所有脚本名都稳定可用）。请勿混用 `npm install` / `yarn`（待确认） 之类的命令，以免生成与 bun 不一致的锁文件与依赖布局。
- 脚本中直接出现 `vite`、`tauri`、`vue-tsc`、`oxlint`、`vitest` 这些可执行名，说明它们必须能从依赖树中被解析到；由 bun 安装后应通过 `bun run` 调用，而不是全局命令，以保证版本一致性。

## 脚本命令

| 命令 | 脚本内容 | 行为与预期产出 |
| --- | --- | --- |
| `bun run dev` | `vite` | 启动 Vite 开发服务器，用于前端侧开发调试，带开发态构建与热更新；该命令不涉及桌面壳进程。（监听端口未在数据中提供，省略） |
| `bun run build` | `vue-tsc --noEmit && vite build` | 两步串行：先由 `vue-tsc --noEmit` 做类型检查且**不产出**类型文件，只有检查通过（退出码 0）才会继续；再由 `vite build` 产出前端构建产物。任一步失败即整体失败，属于发布前的前端侧门禁命令。 |
| `bun run preview` | `vite preview` | 以静态服务方式预览已构建的前端产物，用于验证 `build` 的输出结果，属于本地验收用途，不参与打包。 |
| `bun run app:dev` | `tauri dev` | 以开发模式启动 Tauri 应用（桌面壳 + 前端联调）。该命令依赖本机具备 Tauri 所要求的系统原生构建环境。 |
| `bun run app:build` | `tauri build` | 以发布模式构建 Tauri 桌面应用并产出可分发的安装包/可执行产物。与前端的 `build` 脚本是两条独立路径，`app:build` 由 Tauri CLI 负责整体构建流程。 |
| `bun run lint` | `oxlint src` | 使用 oxlint 对 `src` 目录做静态检查，检查范围明确限定在 `src`（其余目录不在此脚本覆盖内）。 |
| `bun run test` | `vitest run` | 以单次运行（非 watch）模式执行 Vitest 测试，适合 CI 或一次性校验；与 `dev` 的开发态监听不同，执行完即退出。 |

**命令分组理解：**

- 前端侧：`dev`（开发）→ `build`（类型检查 + 构建）→ `preview`（产物预览）。
- 桌面侧：`app:dev`（开发联调）→ `app:build`（发布打包）。
- 质量门禁：`lint`（静态检查）、`test`（单次测试）。

## 环境变量

| 变量名 | 敏感标记 | 典型用途 |
| --- | --- | --- |
| `TAURI_ENV_HOST` | 非敏感（`sensitive: false`） | Tauri 构建/开发流程中标识宿主目标平台的环境变量，供构建期逻辑区分运行/打包所在的宿主环境。 |
| `TAURI_ENV_DEBUG` | 非敏感（`sensitive: false`） | Tauri 构建/开发流程中标识调试态开关的环境变量，供构建期逻辑区分 debug 与 release 语义。 |

两个变量均标记为非敏感，可安全出现在日志与 CI 输出中，无需按密钥方式注入或做脱敏处理。它们由 Tauri 工具链在 `app:dev` / `app:build` 流程中参与环境构造，无需手工写入仓库内的配置文件。

## 环境准备与执行顺序

1. 安装依赖（bun 前缀）：`bun install`。
2. 前端开发：`bun run dev`；提交前自检：`bun run lint` 与 `bun run test`。
3. 前端产出验证：`bun run build` 成功后用 `bun run preview` 复核产物。
4. 桌面应用开发：`bun run app:dev`；桌面应用发布：`bun run app:build`。

> 待确认：数据未提供 Node 版本约束（`nodeVersion` 为空），无法给出最低运行时版本；如需精确复现环境，请以仓库内的版本声明为准。
## Related

- 同目录：[overview.md](overview.md) · [tech-stack.md](tech-stack.md)
- 总入口：[README](../README.md)
