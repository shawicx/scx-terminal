# 测试体系

<details>
<summary>Relevant source files</summary>

- src/components/settings/groupDragSort.test.ts
- src/components/split/splitTree.test.ts
- src/components/terminal/searchFocus.test.ts
- src/components/titlebar/tabGroupLayout.test.ts
- src/components/titlebar/tabStripLayout.test.ts
- src/components/titlebar/tabSwitcherModel.test.ts
- src/lib/backgroundImage.test.ts
- src/lib/colorSchemes.test.ts
- src/lib/frontends/bufferRows.test.ts
- src/lib/hotkeys/hotkeys.test.ts
- src/lib/itermColors.test.ts
- src/lib/jumpChain.test.ts
- src/lib/middleware/oscProcessing.test.ts
- src/lib/monitorOrchestrator.test.ts
- src/lib/portForwarding.test.ts
</details>

本页汇总该项目的测试框架、测试目录组织、运行方式与测试专用依赖，用于快速判断「如何跑测试、测试覆盖了哪些模块」。

## 测试体系概览

| 项目 | 事实 |
| --- | --- |
| 测试框架 | vitest（版本约束 `^5.0.0`） |
| 运行命令 | `vitest run` |
| 配置文件 | 未检测到独立配置文件（`configPath` 为空） |
| 测试目录 | 12 个，见下表 |
| 夹具目录 | 未检测到 |
| 覆盖率阈值 | 未检测到 |
| 生产文件数 | 244 |
| 测试文件数 | 40 |

测试目录清单：

| 测试目录 | 该目录下的测试文件数 |
| --- | --- |
| `src/components/settings` | 1 |
| `src/components/split` | 1 |
| `src/components/terminal` | 1 |
| `src/components/titlebar` | 3 |
| `src/lib` | 13 |
| `src/lib/frontends` | 1 |
| `src/lib/hotkeys` | 1 |
| `src/lib/middleware` | 1 |
| `src/lib/sessions` | 4 |
| `src/lib/suggestions` | 5 |
| `src/services` | 4 |
| `src/stores` | 5 |

## 运行方式

```bash
vitest run
```

**做了什么**：以非交互方式一次性执行全部测试文件。该子命令与监听模式相对，跑完即退出，适合本地一次性验证与 CI 场景。

**预期产出**：终端输出各测试文件的通过/失败结果与汇总，并以进程退出码反映整体结果（失败时非零退出码，便于 CI 判定）。

测试文件命名统一为 `*.test.ts`，集中在源码目录内与实现文件同级存放（colocated），因此按文件路径过滤即可只跑某一模块的测试，vitest 支持的按文件名/用例名过滤、监听模式等常规能力在此同样适用。

## 测试文件分布

以下为检测到的 40 个测试文件，按目录归组，路径即为锚点。

**`src/components/settings`**

| 测试文件 |
| --- |
| `src/components/settings/groupDragSort.test.ts` |

**`src/components/split`**

| 测试文件 |
| --- |
| `src/components/split/splitTree.test.ts` |

**`src/components/terminal`**

| 测试文件 |
| --- |
| `src/components/terminal/searchFocus.test.ts` |

**`src/components/titlebar`**

| 测试文件 |
| --- |
| `src/components/titlebar/tabGroupLayout.test.ts` |
| `src/components/titlebar/tabStripLayout.test.ts` |
| `src/components/titlebar/tabSwitcherModel.test.ts` |

**`src/lib`**

| 测试文件 |
| --- |
| `src/lib/backgroundImage.test.ts` |
| `src/lib/colorSchemes.test.ts` |
| `src/lib/itermColors.test.ts` |
| `src/lib/jumpChain.test.ts` |
| `src/lib/monitorOrchestrator.test.ts` |
| `src/lib/portForwarding.test.ts` |
| `src/lib/quickCommands.test.ts` |
| `src/lib/sftpPane.test.ts` |
| `src/lib/sftpTransferMath.test.ts` |
| `src/lib/sshConnectionRegistry.test.ts` |
| `src/lib/startPage.test.ts` |
| `src/lib/workflowYaml.test.ts` |
| `src/lib/workflows.test.ts` |

**`src/lib/frontends`**

| 测试文件 |
| --- |
| `src/lib/frontends/bufferRows.test.ts` |

**`src/lib/hotkeys`**

| 测试文件 |
| --- |
| `src/lib/hotkeys/hotkeys.test.ts` |

**`src/lib/middleware`**

| 测试文件 |
| --- |
| `src/lib/middleware/oscProcessing.test.ts` |

**`src/lib/sessions`**

| 测试文件 |
| --- |
| `src/lib/sessions/baseSession.test.ts` |
| `src/lib/sessions/index.test.ts` |
| `src/lib/sessions/moshSession.test.ts` |
| `src/lib/sessions/sshSession.test.ts` |

**`src/lib/suggestions`**

| 测试文件 |
| --- |
| `src/lib/suggestions/controller.test.ts` |
| `src/lib/suggestions/pathWord.test.ts` |
| `src/lib/suggestions/promptTracker.test.ts` |
| `src/lib/suggestions/shellHistory.test.ts` |
| `src/lib/suggestions/suggestionEngine.test.ts` |

**`src/services`**

| 测试文件 |
| --- |
| `src/services/backgroundImage.test.ts` |
| `src/services/notifications.test.ts` |
| `src/services/tabSession.test.ts` |
| `src/services/updater.test.ts` |

**`src/stores`**

| 测试文件 |
| --- |
| `src/stores/config.flush.test.ts` |
| `src/stores/config.test.ts` |
| `src/stores/config.windows.test.ts` |
| `src/stores/monitor.test.ts` |
| `src/stores/tabs.test.ts` |

## 测试专用证据

以下内容仅用于测试环境，不代表生产运行时配置。

### 测试专用依赖

| 依赖 | 版本约束 | 被测试文件导入（数量） | 代表锚点 |
| --- | --- | --- | --- |
| vitest | `^5.0.0` | 40 | `src/lib/sessions/sshSession.test.ts`、`src/stores/config.test.ts`、`src/lib/suggestions/suggestionEngine.test.ts` |

该依赖的导入点覆盖上表列出的全部 40 个测试文件，即所有测试文件均通过 vitest 的测试 API 组织用例，无其它测试框架混用。

### 测试专用环境变量

未检测到。

### 测试专用常量

未检测到。

## 测试策略解读

**（推断）覆盖重心在 `src/lib` 与状态层，组件层测试偏"逻辑抽离"取向。** 依据目录分布：`src/lib` 及其 5 个子目录（`frontends`、`hotkeys`、`middleware`、`sessions`、`suggestions`）合计 25 个测试文件，占全部 40 个测试文件的多数；`src/stores` 与 `src/services` 各 5 个和 4 个；而 `src/components` 下四个目录合计仅 6 个测试文件。组件侧被测试的命名（`groupDragSort`、`splitTree`、`searchFocus`、`tabGroupLayout`、`tabStripLayout`、`tabSwitcherModel`）显示其被测对象是布局计算、排序与焦点切换这类可独立验证的模型逻辑，而非整棵组件树的渲染结果。以上为基于目录与文件命名特征的推断，数据中未提供用例数量或断言内容作为直接证据。

**（推断）按子域拆分用例，同一子域存在多文件协作覆盖。** 依据命名分布：`sessions` 下按 `baseSession`/`sshSession`/`moshSession`/`index` 拆分，`suggestions` 下拆为 `controller`/`pathWord`/`promptTracker`/`shellHistory`/`suggestionEngine`，`stores` 下的 `config` 拆为 `config.test.ts`、`config.flush.test.ts`、`config.windows.test.ts` 三个文件——后者表明配置存储的刷新行为与平台差异（Windows）被单列验证。此判断同样基于文件命名与分组方式，属推断。

## 缺口汇总

本次探测未发现独立的测试配置文件（`configPath` 为空），也未发现夹具目录与覆盖率阈值设置，因此测试运行环境、包含/排除规则、覆盖率达标的门槛均无从判断；测试用例总数与覆盖率数值亦未提供，本页不作估计。
## Related

- 同目录：[onboarding.md](onboarding.md) · [troubleshooting.md](troubleshooting.md)
- 共享 3 个符号：[overview.md](../01-overview/overview.md)
- 共享 1 个符号：[environment.md](../01-overview/environment.md)
- 共享 1 个符号：[architecture.md](../02-architecture/architecture.md)
- 总入口：[README](../README.md)

<!-- wiki:source: llm -->
