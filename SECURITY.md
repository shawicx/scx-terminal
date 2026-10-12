# 安全策略

## 支持的版本

仅最新发布的版本接收安全修复，请始终升级到 [Releases](https://github.com/shawicx/scx-terminal/releases) 中的最新版。

| 版本 | 支持情况 |
| --- | --- |
| 最新 release | ✅ 安全修复 |
| 更早版本 | ❌ 不支持 |

## 报告漏洞

scx-terminal 是一个处理 SSH / SFTP / 端口转发 / 本地 PTY 的终端应用，以下类型的问题尤其值得关注：

- 凭据、密钥或会话数据的泄露与越权访问
- 更新器签名校验被绕过
- 远程服务器通过终端转义序列 / OSC 对本地应用发起的攻击
- 配置文件（`config.db`）与日志中的敏感信息处理不当

**请勿通过公开 Issue 或 Discussion 报告安全漏洞。**

请使用 GitHub 的 [私密漏洞报告](https://github.com/shawicx/scx-terminal/security/advisories/new) 提交，报告中请尽量包含：

- 受影响的版本与平台
- 复现步骤或 PoC
- 影响评估

## 响应流程

1. 收到报告后尽快（通常 72 小时内）确认
2. 评估影响并确定修复方案
3. 发布修复版本，并同步发布安全公告
4. 报告者可按意愿在公告中获得致谢

## 已知安全设计

- 自动更新使用 minisign 签名验证（公钥内置在 `src-tauri/tauri.conf.json`）
- CI 中使用的第三方 Action 均钉住 commit SHA，防止 tag 劫持
- Tauri v2 capabilities 按 `src-tauri/capabilities/` 显式声明最小权限
