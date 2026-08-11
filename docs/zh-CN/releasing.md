# 发布指南

[English](../en/releasing.md) | 简体中文

本文描述从干净 `main` 分支准备公开版本的完整流程。GitHub Actions 可以为 Windows、macOS 和 Linux 自动编译资产，但当前正式运行验证基线仍是 Windows；macOS/Linux 只有在完成对应真实设备验证后才能声明为正式支持。

## 1. 确定版本

使用语义化版本 `MAJOR.MINOR.PATCH`，标签使用 `vMAJOR.MINOR.PATCH`。同步修改：

1. `package.json` 的 `version`
2. `src-tauri/Cargo.toml` 的 `version`
3. `src-tauri/tauri.conf.json` 的 `version`
4. 运行 `cargo check --manifest-path src-tauri/Cargo.toml`，让 `Cargo.lock` 中本项目版本同步，并确认没有意外升级依赖
5. `CHANGELOG.md`：把 `Unreleased` 内容移入带日期的新版本，并保证中文/英文条目一一对应

检查三个版本文件是否一致；传入标签时还会核对 `v` 前缀的完整标签：

```powershell
bun run release:verify-version v0.1.0
```

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

## 3. GitHub 自动检查与打包

仓库包含两个工作流：

- `.github/workflows/ci.yml`：在推送到 `main`、Pull Request 和手动触发时运行。前端检查在 Ubuntu 执行；Windows x64、macOS、Linux x64/ARM64 运行 Rust 测试，Windows ARM64 执行交叉编译检查。
- `.github/workflows/release.yml`：推送 `v*` 标签时运行。5 个架构打包任务并行执行，并把资产上传到同一个 GitHub 草稿 Release。

自动打包矩阵：

| 平台 | 架构 | 资产 |
| --- | --- | --- |
| Windows | x64 | MSI、NSIS EXE 安装包 |
| Windows | ARM64 | MSI、NSIS EXE 安装包 |
| macOS | Intel + Apple Silicon 通用包 | App、DMG |
| Linux | x64 | AppImage、DEB、RPM |
| Linux | ARM64 | AppImage、DEB、RPM |

Windows 不再提供 32 位 x86 包。macOS 的 Universal 包同时包含 x64 和 ARM64，不需要用户选择芯片版本。Actions runner 上成功编译属于“构建证据”，不等于真实设备上的“运行验证”。当前工作流也没有配置 Windows 代码签名证书、Apple Developer ID、公证凭据或 Linux 包签名密钥，因此自动资产默认未签名。

## 4. 提交并触发标签发布

版本提交和标签必须来自同一个已验证提交。先推送 `main` 并确认 CI 通过，再创建标签：

```powershell
git push origin main
git tag -s v0.1.0 -m "release: v0.1.0"
git push origin v0.1.0
```

如果没有可用的 Git 签名密钥，使用 annotated tag：

```powershell
git tag -a v0.1.0 -m "release: v0.1.0"
git push origin v0.1.0
```

不要伪装成已签名，也不要重复移动已经公开的标签。标签推送后，在 GitHub 的 Actions 页面检查 `Release` 工作流；成功后会出现标题为 `Haruha v0.1.0` 的草稿 Release。

## 5. 审核草稿 Release

自动化只创建草稿，人工核对完成后再点击发布：

1. 确认 5 个打包 job 全部成功，标签版本与 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 一致。
2. 下载所有资产，记录文件名、字节数并生成 SHA-256。把结果保存为 `SHA256SUMS.txt` 并上传到草稿 Release。
3. 在计划声明支持的真实系统上安装并运行，记录已验证的操作系统版本、架构、安装、托盘、代理切换、PAC 和退出恢复结果。
4. 将 `CHANGELOG.md` 的对应内容整理成含义和顺序一一对应的中英文发布说明。
5. 明确标注每个平台的签名、公证和运行验证状态；未完成的项目不能省略。

Windows 本地哈希示例：

```powershell
Get-FileHash .\src-tauri\target\release\proxy-manager-next.exe -Algorithm SHA256
Get-ChildItem .\src-tauri\target\release\bundle\msi\*.msi |
  Get-FileHash -Algorithm SHA256
```

## 6. Windows 本地构建备用流程

需要在本机复现全部 Windows 资产时，先运行环境检查，再构建 x64/ARM64 的 MSI 与 NSIS：

```powershell
.\scripts\check-environment.ps1 -Architecture all -Json
bun run tauri:build:windows:all
```

需要下载代理时：

```powershell
bun run tauri:build:windows:all -- -Proxy http://127.0.0.1:7890
```

典型输出：

```text
src-tauri/target/release/proxy-manager-next.exe
src-tauri/target/release/bundle/msi/*.msi
src-tauri/target/release/bundle/nsis/*-setup.exe
src-tauri/target/aarch64-pc-windows-msvc/release/bundle/msi/*.msi
src-tauri/target/aarch64-pc-windows-msvc/release/bundle/nsis/*-setup.exe
```

本地交叉构建 Windows ARM64 需要 Visual Studio ARM64 C++ 工具和对应 Windows SDK；脚本会按需安装 Rust 的 `aarch64-pc-windows-msvc` target。交叉编译成功不能代替 Windows ARM64 真机安装与代理行为验证。只构建原有 x64 MSI 时仍可使用 `bun run tauri:build:windows`。

不要把二进制提交到 Git；它们只应上传到对应 Release。

## 7. 发布说明模板

```markdown
## 中文

- 与 CHANGELOG 对应的变更 1
- 与 CHANGELOG 对应的变更 2

### 下载与校验

- Windows x64 MSI/NSIS：...
- Windows ARM64 MSI/NSIS：...
- macOS Universal App/DMG：...
- Linux x64 AppImage/DEB/RPM：...
- Linux ARM64 AppImage/DEB/RPM：...
- SHA-256：见 SHA256SUMS.txt
- 已验证：Windows 11 x64
- 未验证：Windows 11 ARM64、macOS、Linux

## English

- Change 1 matching the Chinese entry
- Change 2 matching the Chinese entry

### Downloads and verification

- Windows x64 MSI/NSIS: ...
- Windows ARM64 MSI/NSIS: ...
- macOS Universal App/DMG: ...
- Linux x64 AppImage/DEB/RPM: ...
- Linux ARM64 AppImage/DEB/RPM: ...
- SHA-256: see SHA256SUMS.txt
- Verified: Windows 11 x64
- Not verified: Windows 11 ARM64, macOS, Linux
```

发布前逐条确认中英文含义、顺序、资产名称和验证边界完全一致。

## 8. 发布后与回滚

- 在干净机器从 GitHub 下载并再次校验哈希、安装和启动。
- 检查 Release 页面、标签、源码归档和所有链接。
- 严重问题时先把 Release 标记为预发布或撤下受影响资产，发布安全说明；不要移动已有标签指向另一个提交。
- 修复应产生新的 patch 版本和新标签，保留原版本的可追溯性。
