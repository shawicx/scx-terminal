# CI 构建包 keypress 补发导致 ⌘T 双开（根因与调试手法）

<details>
<summary>Relevant source files</summary>

- src/lib/frontends/xterm/keyboard.ts
- src/lib/frontends/xterm/frontend.ts
- src/lib/hotkeys/hotkeys.ts
</details>

> 本页是**决策/排障记录**（history），非图谱推导文档：记录一个本地无法复现、仅 CI 构建包出现的键盘事件 bug 的完整根因链、修复落点与调试手法。首次记录于 2026-09-19（wiki commit `2352496`），代码经大文件拆分重构后，本文锚点已同步到 `src/lib/frontends/xterm/` 新结构。

## 现象

- CI 构建（GitHub Actions `build.yml` 产出的发布包）中，按一次 **⌘T 开出两个标签**
- **本地构建完全无法复现**，导致问题只能靠 CI 包实测定位
- ⌘W 同样存在双触发，但被「空标签自动重开」行为掩盖，不易察觉

## 根因链

1. xterm 5.5 的 `attachCustomKeyEventHandler` 会对 **keydown / keyup / keypress** 三种事件都回调进自定义 handler
2. CI 构建的 WKWebView 会对 ⌘ 组合键在 keydown 之外**补发 keypress**；本地构建的 WKWebView 不会——这是「本地无法复现」的直接原因
3. 旧代码把一切**非 keyup** 事件都当作 keydown 喂入热键状态机
4. 此时 keypress 与「刚被 macOS 合成 keyup 清空」的状态机再次匹配出同一热键 → 一次 ⌘T 触发两次「新建标签」

## 修复

custom handler 对 `keypress` 直接放行、不进热键状态机：

- 门函数 `createKeyGate`：keypress 分支直接 `return true`（`src/lib/frontends/xterm/keyboard.ts:101`）
- 装配点：`attachCustomKeyEventHandler(createKeyGate({...}))`（`src/lib/frontends/xterm/frontend.ts:110`）
- 放行无副作用的原因：xterm 对**带 meta 的 keypress 本就不产生输入**

相邻防线（同文件，勿破坏）：热键状态机必须接收**真实事件类型**，`keyup` 与 `keydown` 严格区分（`src/lib/frontends/xterm/keyboard.ts:106`），否则 keyup 被当作 keydown 二次喂入会造成同类重复匹配。

## 调试手法（可复用）

- **插桩分支**：在按键路径上用「微任务延迟 `dev_log`」打点，对按键时序**零扰动**（同步插桩会改变事件循环时序，可能破坏复现条件）
- **CI 包实测**：本地无法复现时，直接 dispatch `build.yml` 出 CI 构建包验证假设

## Related

- 同目录：[frontends-middleware-services.md](frontends-middleware-services.md)
- 排障入口：[troubleshooting](../05-guides/troubleshooting.md)
- 总入口：[README](../README.md)
