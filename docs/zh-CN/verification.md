# 验证说明

[English](../en/verification.md) | 简体中文

## 证据等级

1. 静态检查：TypeScript、格式和源码审查。
2. 单元测试：Rust 配置、规则和 PAC 行为。
3. 构建：前端 bundle、Rust 二进制或安装包生成。
4. 运行验证：在真实目标系统操作代理、PAC、托盘和恢复。
5. 发布验证：从公开 Release 下载、校验哈希并在干净机器安装。

结论必须明确属于哪一级。HTTP 200、构建成功或源码存在都不能替代真实平台验证。

## 每次 Pull Request

```powershell
bun install --frozen-lockfile
bun run check
bun run build
bun run format:rust:check
bun run test:rust
git diff --check
```

CI 在 Windows runner 执行同类检查。平台相关改动还必须提供人工运行步骤和结果。

## 人工检查清单

- 前端：主要视口无溢出，明暗主题可读，键盘焦点可见，控制台无错误。
- 手动代理：正确写入、切换、关闭，绕过名单符合平台语义。
- PAC：本机 URL 可访问，代理/直连优先级正确，占用首选端口时能回退。
- 托盘：主窗口/托盘状态同步，重复打开和退出无残留窗口。
- 故障：无效代理、无网络、无权限、外部服务失败都有可见错误。
- 恢复：重启恢复保存模式；明确退出后系统代理关闭；强制退出场景有人工恢复说明。

## 当前基线

2026-08-10 的开源迁移快照已通过：

- `bun install --frozen-lockfile`
- `bun run check`
- `bun run build`
- `bun run format:rust:check`
- `bun run test:rust`：20 passed、0 failed
- 中英文 Markdown 本地链接、PowerShell 语法和 JSON 解析检查
- `bun run tauri:build:windows -- -NoBundle`：生成 Windows release EXE

项目历史验证还覆盖 Windows MSI 和主要托盘交互，但本次迁移没有重新生成 MSI，也没有做新的安装/运行 E2E。macOS 和 Linux 尚无正式真实设备交付证据。具体命令结果仍应以当前仓库最新 CI/本地输出为准。
