# 状态管理

<details>
<summary>Relevant source files</summary>

- src/components/settings/useConfirmAction.ts
- src/stores/config/store.ts
- src/stores/forwarding.ts
- src/stores/monitor.ts
- src/stores/tabs.ts
- src/stores/theme.ts
- src/stores/transfers.ts
</details>

本项目前端状态管理为 **Pinia（6 个 store）+ 组件内 composable（1 个）** 的组合：全局共享状态集中在 `src/stores/` 目录下的 Pinia store，局部交互状态则由设置组件内的 composable 承担。管理面最广的是 `config`（src/stores/config/store.ts:23），其余 store 分别对应转发、监控、标签页、主题与传输等较窄的场景。

> 下表条目严格来自状态管理扫描结果，未增删改；未在数据中出现的 store 一律不作补充。

## store 清单

| 名称 | 类型 | state 字段数（近似） | 消费文件数（词法统计） | 源文件:行号 |
| --- | --- | --- | --- | --- |
| `useConfirmState` | composable | 0 | 1 | src/components/settings/useConfirmAction.ts:47 |
| `config` | pinia | 1 | 35 | src/stores/config/store.ts:23 |
| `forwarding` | pinia | 3 | 3 | src/stores/forwarding.ts:16 |
| `monitor` | pinia | 4 | 5 | src/stores/monitor.ts:16 |
| `tabs` | pinia | 4 | 17 | src/stores/tabs.ts:34 |
| `theme` | pinia | 2 | 2 | src/stores/theme.ts:14 |
| `transfers` | pinia | 5 | 4 | src/stores/transfers.ts:17 |

**口径声明**

- **state 字段数**：为近似计数，只反映 store 顶层状态字段的数量级，不代表字段的嵌套深度或运行时数据量。
- **消费文件数**：为词法统计结果，即源码文本中出现该 store 标识符的文件数，不等同于运行时实际调用点数量。
- **类型**：`pinia` 表示独立定义的 Pinia store；`composable` 表示随组件模块定义、供组件内部使用的组合式函数，不注册为全局 store。

## 按业务域分组

以下分组依据 **store 命名** 推断得出（推断处：命名特征，无源码调用或注释证据佐证），仅用于组织阅读，不代表代码中存在显式的域划分。

### 应用配置与外观

| store | 关键事实 | 锚点 |
| --- | --- | --- |
| `config` | 唯一 state 字段数最少的全局 store（1 个），但消费文件数达 35，是全项目覆盖面最广的状态单元 | src/stores/config/store.ts:23 |
| `theme` | 2 个 state 字段，2 个消费文件，聚焦单一外观维度 | src/stores/theme.ts:14 |

`config` 的消费广度（35 个文件）与 `theme` 的消费收敛（2 个文件）形成对比：前者属于被广泛读取的基础状态，后者属于窄口径的展示层状态。

### 网络转发与传输

| store | 关键事实 | 锚点 |
| --- | --- | --- |
| `forwarding` | 3 个 state 字段，3 个消费文件 | src/stores/forwarding.ts:16 |
| `transfers` | 5 个 state 字段（清单中字段数最多），4 个消费文件 | src/stores/transfers.ts:17 |

两者字段数与消费面都较小且接近，属于围绕单一业务链路展开的状态。

### 运行监控与界面交互

| store | 关键事实 | 锚点 |
| --- | --- | --- |
| `monitor` | 4 个 state 字段，5 个消费文件 | src/stores/monitor.ts:16 |
| `tabs` | 4 个 state 字段，消费文件数 17，仅次于 `config` | src/stores/tabs.ts:34 |
| `useConfirmState` | 唯一非 Pinia 条目；state 字段数计为 0，消费文件数 1，随设置组件模块存在 | src/components/settings/useConfirmAction.ts:47 |

`tabs` 的高消费数（17）说明界面标签状态被多个视图共享；`useConfirmState` 则相反，仅服务于其所在模块（src/components/settings/useConfirmAction.ts:47），是典型的组件局部状态封装。

## 集中度观察

- 消费文件数排名：`config`（35）> `tabs`（17）> `monitor`（5）> `transfers`（4）> `forwarding`（3）> `theme`（2）> `useConfirmState`（1）。
- 单文件式独立 store 占多数（`forwarding`、`monitor`、`tabs`、`theme`、`transfers` 均为 `src/stores/` 下的单文件），仅 `config` 采用目录形态（src/stores/config/store.ts:23）。

## 待确认

1. **state 字段构成**：数据只提供各 store 的字段数量，未提供字段名与类型，因此无法说明任一 store 具体持有哪些状态。需补充 `defineStore` 的 state 定义体。
2. **store 间依赖关系**：无调用边或导入关系数据，无法判断 store 是否互相引用（例如 `theme` 是否被 `config` 内部读写）。需补充 store 之间的导入/调用证据。
3. **持久化机制**：数据未涉及 Pinia 插件、`localStorage`（待确认） 或后端同步，无法说明状态是否跨会话保留。需补充 store 定义外的初始化与订阅代码。
4. **设计动机**：本次扫描未返回意图证据（注释、提交信息、文档小节），因此各 store 的拆分理由与演进过程无据可依，不作叙述。
## Related

- 同目录：[api.md](api.md) · [components.md](components.md) · [routing.md](routing.md)
- 共享 2 个源文件、共享 1 个符号：[glossary.md](../07-reference/glossary.md)
- 共享 1 个源文件、共享 1 个符号：[overview.md](../01-overview/overview.md)
- 共享 2 个符号：[tech-stack.md](../01-overview/tech-stack.md)
- 总入口：[README](../README.md)

<!-- wiki:source: llm -->
