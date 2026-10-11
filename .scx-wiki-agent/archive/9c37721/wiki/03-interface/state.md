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

本页基于状态管理扫描数据，说明项目的状态管理选型、store 清单及其按业务域的组织方式。全部结论以 `file:line` 锚定，未提供的维度明确标注为「待确认」。

## 一、选型概览

扫描到 7 个状态单元，类型分布为：**Pinia 6 个**、**composable 1 个**（`src/components/settings/useConfirmAction.ts:45`）。即全局共享状态统一由 Pinia 承担，局部交互逻辑以 composable 形式存在，未出现 Vuex / Redux / Zustand 等其他方案（数据中无对应条目）。

| 类型 | 数量 | 条目 |
| --- | --- | --- |
| pinia | 6 | config、forwarding、monitor、tabs、theme、transfers |
| composable | 1 | useConfirmState |

## 二、store 清单

> 条目与扫描数据一一对应，未作增删改。

| 名称 | 类型 | state 字段数 | 消费文件数 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| useConfirmState | composable | 0 | 2 | `src/components/settings/useConfirmAction.ts:45` |
| config | pinia | 0 | 57 | `src/stores/config/store.ts:23` |
| forwarding | pinia | 6 | 11 | `src/stores/forwarding.ts:16` |
| monitor | pinia | 11 | 17 | `src/stores/monitor.ts:16` |
| tabs | pinia | 15 | 24 | `src/stores/tabs.ts:34` |
| theme | pinia | 0 | 11 | `src/stores/theme.ts:14` |
| transfers | pinia | 8 | 7 | `src/stores/transfers.ts:17` |

**统计口径**：

- `state 字段数`为近似计数，取扫描器识别结果。值为 0 的条目（`useConfirmState`、`config`、`theme`）表示**扫描未识别出 state 字段**，不等同于该单元无状态（见「待确认」）。
- `消费文件数`为**词法统计**的引用该单元的文件数量，不代表运行时调用次数或调用频次。

## 三、按业务域的组织

### 3.1 配置与外观域

| store | 锚点 | state 字段数 | 消费文件数 |
| --- | --- | --- | --- |
| config | `src/stores/config/store.ts:23` | 0 | 57 |
| theme | `src/stores/theme.ts:14` | 0 | 11 |

`config` 是全部条目中消费文件数最高的单元（57，`src/stores/config/store.ts:23`），且是唯一位于带子目录路径 `src/stores/config/` 下的 Pinia store。`theme` 与其同属外观/配置相关命名，消费文件数 11（`src/stores/theme.ts:14`）。两者 state 字段计数均为 0。

> **推断 1**：按命名特征可将 store 划分为「配置与外观」「网络运行」「界面状态」三类，并据此解读职责。推断依据仅为条目 `name` 与文件路径的命名特征，数据中未提供任何字段名、getter 或 action 列表。该分类为阅读便利而设，非数据给定。

> **推断 2**：`config` 作为唯一带子目录的 store 且消费面最广，可能承担跨模块的全局配置中枢角色。推断依据为路径结构 `src/stores/config/store.ts:23` 与消费文件数 57，无源码调用点佐证。

### 3.2 网络运行域

| store | 锚点 | state 字段数 | 消费文件数 |
| --- | --- | --- | --- |
| forwarding | `src/stores/forwarding.ts:16` | 6 | 11 |
| monitor | `src/stores/monitor.ts:16` | 11 | 17 |
| transfers | `src/stores/transfers.ts:17` | 8 | 7 |

三者均位于 `src/stores/` 根目录下的单文件形式。其中 `monitor` 的状态规模在该组最大（11 个 state 字段，`src/stores/monitor.ts:16`），消费文件数也为该组最高（17，`src/stores/monitor.ts:16`）；`transfers` 状态字段 8 个（`src/stores/transfers.ts:17`），但消费文件数在该组最低（7，`src/stores/transfers.ts:17`），呈「状态较重、消费面较窄」的形态。

### 3.3 界面状态域

| store | 锚点 | state 字段数 | 消费文件数 |
| --- | --- | --- | --- |
| tabs | `src/stores/tabs.ts:34` | 15 | 24 |

`tabs` 是全部条目中 state 字段数最多者（15，`src/stores/tabs.ts:34`），消费文件数 24（`src/stores/tabs.ts:34`），仅次于 `config`。其定义行号（34）明显大于其他 Pinia store（14–23），说明该文件在 store 定义之前还有较长的前置内容。

### 3.4 局部 composable

| 单元 | 锚点 | 类型 | state 字段数 | 消费文件数 |
| --- | --- | --- | --- | --- |
| useConfirmState | `src/components/settings/useConfirmAction.ts:45` | composable | 0 | 2 |

`useConfirmState` 是唯一非 Pinia 单元，位于组件目录 `src/components/settings/` 而非 `src/stores/`，消费文件数 2（`src/components/settings/useConfirmAction.ts:45`），是扫描结果中作用范围最小的单元。

## 四、规模对照

| 维度 | 最高 | 最低 |
| --- | --- | --- |
| state 字段数 | tabs（15，`src/stores/tabs.ts:34`） | useConfirmState / config / theme（0） |
| 消费文件数 | config（57，`src/stores/config/store.ts:23`） | useConfirmState（2，`src/components/settings/useConfirmAction.ts:45`） |

可观察到 state 字段数与消费文件数并不同向：`config` 状态计数为 0 而消费文件数达 57（`src/stores/config/store.ts:23`），`transfers` 状态计数 8 而消费文件数仅 7（`src/stores/transfers.ts:17`）。

## 五、待确认

1. **`config` 的实际暴露接口未知**：`src/stores/config/store.ts:23` 的 state 字段计数为 0，但其消费文件数达 57，缺 state/getter/action 清单数据，无法判断其被消费的具体内容。
2. **跨 store 调用关系缺失**：数据未提供任何调用边，无法给出「调用方 → 被调用方 → `file:line`」的依赖表，也无法确认 store 之间是否存在相互引用。
3. **持久化与外部同步策略无数据**：全部条目均无持久化（localStorage / sessionStorage 等）信息，`theme`（`src/stores/theme.ts:14`）一类通常需持久化的单元亦无佐证。
4. **设计动机无证据源**：本次扫描的 `intent`（待确认） 数组为空，无法引用注释、提交信息或文档小节说明各 store 的拆分动机，故本页动机相关表述（推断 1、推断 2）已显式标注为推断。
5. **composable 的消费文件未列出**：`useConfirmState`（`src/components/settings/useConfirmAction.ts:45`）仅给出消费文件数为 2，未提供具体消费文件路径，无法界定其适用范围。
## Related

- 同目录：[api.md](api.md) · [components.md](components.md) · [routing.md](routing.md)
- 共享 2 个源文件、共享 1 个符号：[decisions.md](../04-design/decisions.md)
- 共享 1 个源文件、共享 1 个符号：[modules.md](../02-architecture/modules.md)
- 共享 2 个符号：[onboarding.md](../05-guides/onboarding.md)
- 总入口：[README](../README.md)
