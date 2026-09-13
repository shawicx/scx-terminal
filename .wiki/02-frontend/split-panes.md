# 分屏系统

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/components/split/splitTree.ts` | 不可变分屏树模型与全部树操作（纯函数，有单测 `splitTree.test.ts`） |
| `src/components/split/SplitContainer.vue` | 递归渲染器：叶 → `TerminalPane`，枝 → 子容器 + 分隔条 |
| `src/components/split/SplitSpanner.vue` | 可拖拽分隔条（调整相邻两个子项的 flex 比例） |
| `src/components/terminal/TerminalTabContent.vue` | 每个标签持有树根并应用树操作（见 [app-shell-and-tabs](app-shell-and-tabs.md)） |

## 树模型（`splitTree.ts`）

```typescript
SplitLeaf   = { id, type: 'leaf', cwd?: string }                  // 一个终端窗格；cwd=继承的初始目录
SplitBranch = { id, type: 'branch', orientation: 'h' | 'v',     // 水平/垂直排列
                ratios: number[], children: SplitNode[] }        // ratios 为相对 flex 份额
```

操作（全部返回新树，不做原地修改）：

- `makeLeaf(cwd?)` / `makeBranch`：构造。
- `splitLeaf(root, leafId, 'right' | 'down', newLeafCwd?)`：把叶包进新枝并追加新叶（`newLeafCwd` 来自源叶会话 cwd，新窗格继承目录）；拆根叶时整体包一层。返回 `{ tree, newLeafId }`。
- `removeLeaf(root, leafId)`：删除并 `prune`（单子枝上提、空枝剪除）；返回 `null` 表示树空（调用方关标签）。
- `resizeChildren(root, branchId, index, first, second)`：分隔条拖拽调整比例（下限 0.1）。
- `listLeaves`（深度优先视觉序）/ `neighborLeaf`（键盘导航 Δ±1）/ `findLeaf` / `findParent`。

## 渲染（`SplitContainer.vue`）

- **叶**：`.split-leaf`（`position:relative; min-width/height:0`），内含绝对定位的 `TerminalPane`；活动叶有 `--color-primary` 内描边；`mousedown` 上报 `leafActivated`。
- **枝**：`.split-branch.h|.v`（flex 行/列）渲染子 `SplitContainer`（带 `class="split-child"` 与内联 `flexGrow: ratios[i] / flexBasis: 0`）+ `SplitSpanner`。
- 通过 `paneRefs`/`containerRefs` Map 递归暴露 `focusLeaf(id)` / `invokeOnLeaf(id, method)`（copy/paste/clear/find）。
- **根容器必须带 `.split-root`（flex:1）**——见 [app-shell-and-tabs](app-shell-and-tabs.md) 中对 0 宽度坍塌 bug 的说明。

## 与标签/命令的联动

`TerminalTabContent` 的 `tabApi` 把 `split('right'|'down')`、`closePane`、`navigatePane(±1)` 暴露给命令注册表（⌘D / ⌘⇧D / ⌘⌥W / ⌘⌥←→，见 `src/stores/config.ts` 默认热键）。关闭最后一个叶 = 关闭标签（`closeTab`）。

## Related

- [app-shell-and-tabs](app-shell-and-tabs.md)
- [hotkeys-and-commands](hotkeys-and-commands.md)
