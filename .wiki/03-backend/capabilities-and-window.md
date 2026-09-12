# 窗口、Capabilities 与安全

## tauri.conf.json（`src-tauri/tauri.conf.json`）

- `macOSPrivateApi: true`（tauri Cargo feature `macos-private-api` 配套；vibrancy 目前编译关闭）。
- 窗口 `main`：1100×700、`decorations: false`、`titleBarStyle: "Overlay"`、`hiddenTitle: true`、`transparent: false`、`acceptFirstMouse: true`。自定义标题栏由前端 `TitleBar.vue` 绘制（traffic light 区域留白 + `core:window:allow-start-dragging` 拖拽）。
- `security.csp: null`（本地渲染，无远程内容；改动需用户批准——AGENTS.md 禁止弱化 security 字段）。
- 开发联调：`beforeDevCommand: "bun run dev"`（Vite，端口 1420 `strictPort`）、`devUrl: http://localhost:1420`、`frontendDist: ../dist`。

## Capabilities（`src-tauri/capabilities/default.json`，Tauri v2 权限模型）

窗口 `main` 显式声明（无 wildcard 放开）：

- `core:default`（含事件 listen/emit 等 core 权限——`listen('pty:{id}:…')` 依赖它）
- `core:window:allow-start-dragging / minimize / toggle-maximize / is-maximized / close / set-focus`
- `opener:default` + `opener:allow-open-path` + `opener:allow-reveal-item-in-dir`（设置页打开配置目录）
- `clipboard-manager:allow-read-text / write-text`

自定义应用命令（`pty_*`、`list_shells`、`config_*`、`dev_log`）不需要 capability 条目。新增权限必须在此文件显式追加。

## 安全相关事实

- 前后端唯一通道是 Tauri IPC（`invoke` / `#[tauri::command]`）；前端不直接链接 Rust crate，后端不渲染内容。
- 配置文件不含密钥/凭据（纯外观与热键偏好）；Wiki 与文档不得写入任何 token。
- 剪贴板读写走官方插件并带 `navigator.clipboard` 降级（`src/lib/frontendContext.ts`）。

## Related

- [commands-and-config](commands-and-config.md)
- [02-frontend/app-shell-and-tabs](../02-frontend/app-shell-and-tabs.md)
- `AGENTS.md` Tauri 章节（禁止弱化 security/CSP/capabilities）
