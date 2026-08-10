# 发布指南

[English](../en/releasing.md) | 简体中文

本文描述从干净 `main` 分支准备公开版本的完整流程。当前正式发布基线是 Windows；macOS/Linux 只有在完成对应真实设备验证后才能列为正式资产。

## 1. 确定版本

使用语义化版本 `MAJOR.MINOR.PATCH`，标签使用 `vMAJOR.MINOR.PATCH`。同步修改：

1. `package.json` 的 `version`
2. `src-tauri/Cargo.toml` 的 `version`
3. `src-tauri/tauri.conf.json` 的 `version`
4. 运行 `cargo check --manifest-path src-tauri/Cargo.toml`，让 `Cargo.lock` 中本项目版本同步，并确认没有意外升级依赖
5. `CHANGELOG.md`：把 `Unreleased` 内容移入带日期的新版本，并保证中文/英文条目一一对应

然后运行：

```powershell
bun install --frozen-lockfile
bun run check
bun run build
bun run format:rust:check
bun run test:rust
git diff --check
```

## 2. 验证平台行为

至少检查：

- 首次启动和旧配置迁移
- 手动代理启用、地址切换和关闭
- PAC 服务可访问、规则命中、端口占用回退
- 主窗口关闭到托盘、托盘切换、明确退出
- 应用重启后的模式恢复
- 无效地址、无权限、系统命令失败时的明确错误
- 退出或故障后系统网络可恢复

不能把 TypeScript/Rust 构建成功写成某个平台“已验证”。平台声明必须有真实系统运行证据。

## 3. 构建 Windows 资产

先运行环境检查，再构建 MSI：

```powershell
.\scripts\check-environment.ps1 -Json
bun run tauri:build:windows
```

需要下载代理时：

```powershell
bun run tauri:build:windows -- -Proxy http://127.0.0.1:7890
```

典型输出：

```text
src-tauri/target/release/proxy-manager-next.exe
src-tauri/target/release/bundle/msi/*.msi
```

不要把这些二进制提交到 Git；它们只上传到对应 Release。

## 4. 校验资产

在一台没有开发源码的 Windows 机器或干净虚拟机安装并运行。确认卸载、升级、托盘、代理恢复和中文安装界面。记录文件名、字节数和 SHA-256：

```powershell
Get-FileHash .\src-tauri\target\release\proxy-manager-next.exe -Algorithm SHA256
Get-ChildItem .\src-tauri\target\release\bundle\msi\*.msi |
  Get-FileHash -Algorithm SHA256
```

把校验值保存为 `SHA256SUMS.txt` 并随 Release 上传。正式分发建议增加 Windows 代码签名；未签名时必须在发布说明中明确提示。

## 5. 提交、标签和 GitHub Release

版本提交和标签应来自同一个已验证提交：

```powershell
git tag -s v0.1.0 -m "release: v0.1.0"
git push origin main
git push origin v0.1.0
```

如果没有可用的签名密钥，使用 annotated tag `git tag -a`，不要伪装成已签名。可使用 GitHub CLI 创建草稿：

```powershell
gh release create v0.1.0 --draft --verify-tag `
  --title "Haruha v0.1.0" `
  .\src-tauri\target\release\proxy-manager-next.exe `
  .\src-tauri\target\release\bundle\msi\*.msi `
  .\SHA256SUMS.txt
```

## 6. 发布说明模板

```markdown
## 中文

- 与 CHANGELOG 对应的变更 1
- 与 CHANGELOG 对应的变更 2

### 下载与校验

- Windows EXE：...
- Windows MSI：...
- SHA-256：见 SHA256SUMS.txt
- 已验证：Windows 11 x64
- 未验证：macOS、Linux

## English

- Change 1 matching the Chinese entry
- Change 2 matching the Chinese entry

### Downloads and verification

- Windows EXE: ...
- Windows MSI: ...
- SHA-256: see SHA256SUMS.txt
- Verified: Windows 11 x64
- Not verified: macOS, Linux
```

发布前逐条确认中英文含义、顺序、资产名称和验证边界完全一致。

## 7. 发布后与回滚

- 在干净机器从 GitHub 下载并再次校验哈希、安装和启动。
- 检查 Release 页面、标签、源码归档和所有链接。
- 严重问题时先把 Release 标记为预发布或撤下受影响资产，发布安全说明；不要移动已有标签指向另一个提交。
- 修复应产生新的 patch 版本和新标签，保留原版本的可追溯性。
