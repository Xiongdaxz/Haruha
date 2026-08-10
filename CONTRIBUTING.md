# 贡献指南

[English](CONTRIBUTING.en.md) | 简体中文

感谢你改进 Haruha。提交代码前，请先搜索现有 Issue；涉及平台行为、配置格式或大范围界面调整的改动，建议先开 Issue 说明问题、方案和验证环境。

## 本地开发

```powershell
bun install --frozen-lockfile
bun run check
bun run build
bun run test:rust
bun run format:rust:check
```

桌面联调使用 `bun run tauri:dev`。只运行 `bun run dev` 时，系统代理相关功能会使用浏览器模拟数据，不能证明真实系统行为。

## 提交规范

- 一个 Pull Request 聚焦一个问题，避免混入无关重构。
- 使用 `feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`build:` 或 `chore:` 等清晰前缀。
- 不提交 `node_modules`、`dist`、`target`、安装包、日志、下载工具或本机配置。
- 不写入代理凭据、令牌、私钥、内网地址或个人绝对路径。
- 修改系统代理/PAC 语义时，同步更新中英文架构和平台文档。
- 面向用户的发布说明必须在 `CHANGELOG.md` 中提供含义一致的中英文条目。

## Pull Request 检查

- [ ] TypeScript 检查和前端构建通过
- [ ] Rust 格式检查和单元测试通过
- [ ] 已说明实际测试平台和未验证平台
- [ ] 新增行为有测试或清晰的人工验证步骤
- [ ] 文档与代码一致
- [ ] 没有敏感信息和生成产物

更完整的环境和命令见[开发指南](docs/zh-CN/development.md)。
