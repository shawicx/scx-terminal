## 改动说明

<!-- 描述改动内容与动机；关联的 Issue 用「Fixes #123」格式 -->

## 改动类型

- [ ] feat 新功能
- [ ] fix 缺陷修复
- [ ] docs 文档
- [ ] style 界面样式
- [ ] refactor 重构
- [ ] perf 性能
- [ ] test 测试
- [ ] build/ci 构建 / CI
- [ ] chore 杂项

## 自查清单

- [ ] 提交信息符合 Conventional Commits（`<type>: <中文描述>`）
- [ ] `bun run lint` 通过
- [ ] `bun run test` 通过
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 通过（涉及 Rust 时）
- [ ] 涉及 UI 变化已附截图
- [ ] 未降级依赖版本；未修改 `tauri.conf.json` 的 security/CSP/capabilities 字段
