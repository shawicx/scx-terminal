# 模块

<details>
<summary>Relevant source files</summary>

- src-tauri/src/background.rs
- src-tauri/src/config/groups.rs
- src-tauri/src/config/legacy.rs
- src-tauri/src/config/load.rs
- src-tauri/src/config/mod.rs
- src-tauri/src/config/model.rs
- src-tauri/src/config/profiles.rs
- src/i18n/en.ts
- src/i18n/en/panels.ts
- src/i18n/en/settings.ts
- src/i18n/index.ts
- src/i18n/zh-CN.ts
- src/i18n/zh/panels.ts
- src/i18n/zh/settings.ts
- src/lib/backgroundImage.ts
</details>

## src

文件数：60

语言：rust × 55 / ts × 3 / other × 2

依赖：`services`, `lib`

扇入/扇出：0 / 0

### 设计依据（意图证据）

> 设计依据（意图证据）与 architecture.md 高度重合，已折叠；完整证据表见 [architecture.md](../02-architecture/architecture.md)。

### 文件结构

| 文件 | 关键符号 |
| --- | --- |
| `src/App.vue` | 未检出已索引符号 |
| `src/assets/styles/main.css` | 未检出已索引符号 |
| `src/assets/styles/palette.css` | 未检出已索引符号 |
| `src/main.ts` | 未检出已索引符号 |
| `src/vite-env.d.ts` | 未检出已索引符号 |
| `src-tauri/src/background.rs` | 未检出已索引符号 |
| `src-tauri/src/config/groups.rs` | 未检出已索引符号 |
| `src-tauri/src/config/legacy.rs` | 未检出已索引符号 |
| `src-tauri/src/config/load.rs` | 未检出已索引符号 |
| `src-tauri/src/config/mod.rs` | 未检出已索引符号 |
| `src-tauri/src/config/model.rs` | 未检出已索引符号 |
| `src-tauri/src/config/profiles.rs` | 未检出已索引符号 |

## lib

文件数：51

语言：ts × 50 / other × 1

依赖：`services`

被依赖：`services`, `stores`, `components`, `src`

扇入/扇出：0 / 0

### 设计依据（意图证据）


### 文件结构

| 文件 | 关键符号 |
| --- | --- |
| `src/lib/backgroundImage.ts` | 未检出已索引符号 |
| `src/lib/colorSchemes.ts` | 未检出已索引符号 |
| `src/lib/communityColorSchemes.ts` | 未检出已索引符号 |
| `src/lib/frontendContext.ts` | 未检出已索引符号 |
| `src/lib/frontends/bufferRows.ts` | 未检出已索引符号 |
| `src/lib/frontends/frontend.ts` | 未检出已索引符号 |
| `src/lib/frontends/xterm/frontend.ts` | 未检出已索引符号 |
| `src/lib/frontends/xterm/keyboard.ts` | 未检出已索引符号 |
| `src/lib/frontends/xterm/lines.ts` | 未检出已索引符号 |
| `src/lib/frontends/xterm/options.ts` | 未检出已索引符号 |
| `src/lib/frontends/xterm/renderer.ts` | 未检出已索引符号 |
| `src/lib/frontends/xterm/resize.ts` | 未检出已索引符号 |

## services

文件数：29

语言：ts × 29

依赖：`lib`, `components`

被依赖：`lib`, `src`, `stores`, `components`

扇入/扇出：0 / 0

### 设计依据（意图证据）


### 文件结构

| 文件 | 关键符号 |
| --- | --- |
| `src/services/backgroundImage.ts` | 未检出已索引符号 |
| `src/services/commands.ts` | 未检出已索引符号 |
| `src/services/configBackup.ts` | 未检出已索引符号 |
| `src/services/configSync.ts` | 未检出已索引符号 |
| `src/services/fonts.ts` | 未检出已索引符号 |
| `src/services/forward.ts` | 未检出已索引符号 |
| `src/services/history.ts` | 未检出已索引符号 |
| `src/services/hotkeys.ts` | 未检出已索引符号 |
| `src/services/hotkeysSingleton.ts` | 未检出已索引符号 |
| `src/services/localFs.ts` | 未检出已索引符号 |
| `src/services/monitor.ts` | 未检出已索引符号 |
| `src/services/mosh.ts` | 未检出已索引符号 |

## components

文件数：75

语言：ts × 68 / other × 7

依赖：`lib`, `services`

被依赖：`services`, `stores`

扇入/扇出：0 / 0

### 设计依据（意图证据）


### 文件结构

| 文件 | 关键符号 |
| --- | --- |
| `src/components/forwarding/ForwardRuleFormDialog.vue` | 未检出已索引符号 |
| `src/components/forwarding/ForwardingTabContent.css` | 未检出已索引符号 |
| `src/components/forwarding/ForwardingTabContent.vue` | 未检出已索引符号 |
| `src/components/monitor/MetricChart.vue` | 未检出已索引符号 |
| `src/components/monitor/MonitorSidebar.vue` | 未检出已索引符号 |
| `src/components/palette/CommandPalette.vue` | 未检出已索引符号 |
| `src/components/palette/QuickCommandPalette.vue` | 未检出已索引符号 |
| `src/components/palette/WorkflowPalette.vue` | 未检出已索引符号 |
| `src/components/settings/ColorSchemePicker.vue` | 未检出已索引符号 |
| `src/components/settings/GroupAccordion.vue` | 未检出已索引符号 |
| `src/components/settings/ProfileForwardingsCard.vue` | 未检出已索引符号 |
| `src/components/settings/SettingsView.vue` | 未检出已索引符号 |

## stores

文件数：10

语言：ts × 10

依赖：`lib`, `services`, `components`

扇入/扇出：0 / 0

### 设计依据（意图证据）


### 文件结构

| 文件 | 关键符号 |
| --- | --- |
| `src/stores/config/defaults.ts` | 未检出已索引符号 |
| `src/stores/config/flush.ts` | 未检出已索引符号 |
| `src/stores/config/index.ts` | 未检出已索引符号 |
| `src/stores/config/store.ts` | 未检出已索引符号 |
| `src/stores/config/types.ts` | 未检出已索引符号 |
| `src/stores/forwarding.ts` | 未检出已索引符号 |
| `src/stores/monitor.ts` | 未检出已索引符号 |
| `src/stores/tabs.ts` | 未检出已索引符号 |
| `src/stores/theme.ts` | 未检出已索引符号 |
| `src/stores/transfers.ts` | 未检出已索引符号 |

## i18n

文件数：7

语言：ts × 7

扇入/扇出：0 / 0

### 设计依据（意图证据）


### 文件结构

| 文件 | 关键符号 |
| --- | --- |
| `src/i18n/en/panels.ts` | 未检出已索引符号 |
| `src/i18n/en/settings.ts` | 未检出已索引符号 |
| `src/i18n/en.ts` | 未检出已索引符号 |
| `src/i18n/index.ts` | 未检出已索引符号 |
| `src/i18n/zh/panels.ts` | 未检出已索引符号 |
| `src/i18n/zh/settings.ts` | 未检出已索引符号 |
| `src/i18n/zh-CN.ts` | 未检出已索引符号 |

## 本页确定知道的事实

- 详述模块 6 个
- 检出依赖关系的模块 5 个
- 检出意图证据（注释/提交/文档）的模块 6 个

## 未知项

- 6 个详述模块未检出图谱符号
- 1 个详述模块未检出模块间依赖证据
## Related

- 同目录：[architecture.md](architecture.md)
- 互补职责：[architecture.md](../02-architecture/architecture.md)
- 共享 6 个源文件、共享 27 个符号：[onboarding.md](../05-guides/onboarding.md)
- 共享 3 个源文件、共享 23 个符号：[overview.md](../01-overview/overview.md)
- 共享 6 个源文件、共享 18 个符号：[api.md](../03-interface/api.md)
- 总入口：[README](../README.md)

<!-- wiki:source: fallback -->
