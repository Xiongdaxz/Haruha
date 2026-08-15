<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="Haruha 项目图标">
</p>

<h1 align="center">Haruha</h1>

<p align="center">轻量、现代的跨平台系统代理管理器</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=0B1F33" alt="React 19">
  <img src="https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white" alt="Rust stable">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/License-MIT-2EA44F" alt="MIT License">
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-6E56CF" alt="Windows, macOS and Linux">
  <img src="https://img.shields.io/badge/Build-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white" alt="GitHub Actions">
</p>

<p align="center"><a href="README.en.md">English</a> · 简体中文</p>

Haruha 使用 Tauri 2、React 19 和 Rust 构建。它负责配置操作系统的 HTTP/HTTPS 手动代理和 PAC 自动代理，并提供规则管理、连接测试、IP 信息、流量概览和桌面托盘操作。

> Haruha 不是代理协议实现，也不提供代理节点。使用前需要准备一个可访问的上游 HTTP 代理地址。

## ✨ 功能

- 手动代理、PAC 自动代理和关闭代理三种模式
- PAC 代理/直连规则及跨配置统一名单
- Windows 桌面托盘和快速模式切换
- 代理连接、IP 信息及代理/直连下载速度测试
- Windows 系统物理网卡实时流量，以及应用本次累计流量（需 UAC）
- 本地配置、日志和站点图标缓存
- 旧版 Windows 配置的只读迁移

## 🖥️ 平台状态

| 平台 | 源码实现 | 当前验证状态 |
| --- | --- | --- |
| Windows 10/11 | x64、ARM64；每种架构自动打包 MSI/NSIS | x64 已完成主要开发与打包验证；ARM64 仍需真实设备验证 |
| macOS | x64 + ARM64 Universal；自动打包 App/DMG | 源码已实现，正式发布前仍需真实 Mac 验证 |
| Linux | x64、ARM64；每种架构自动打包 AppImage/DEB/RPM | 实验性；KDE 和其他桌面尚未完整支持 |

详见[平台支持说明](docs/zh-CN/platform-support.md)。

## 🚀 快速开始

需要安装：

- [Bun](https://bun.sh/) 1.3 或更高版本
- [Rust](https://rustup.rs/) stable 工具链
- Tauri 2 对应的[系统依赖](https://v2.tauri.app/start/prerequisites/)
- Windows 打包还需要 Visual Studio 2022“使用 C++ 的桌面开发”和 Windows SDK

```powershell
cd D:\proxy-manager-next
bun install --frozen-lockfile
bun run tauri:dev
```

首次启动和“恢复默认”会预填 `192.168.0.6:10808`，但首次启动不会自动修改系统代理；确认地址后再手动开启即可。

## 🛠️ 常用命令

```powershell
bun run check              # TypeScript 静态检查
bun run build              # 前端生产构建
bun run test:rust          # Rust 单元测试
bun run format:rust:check  # Rust 格式检查
bun run tauri:dev          # 桌面开发模式
bun run tauri:build        # 当前平台正式构建
bun run tauri:build:windows:all  # Windows x64/ARM64 的 MSI 与 NSIS
```

需要为 Cargo 显式指定下载代理时：

```powershell
.\scripts\cargo-with-proxy.ps1 -Proxy http://127.0.0.1:7890 test
```

脚本没有内置代理地址；不传 `-Proxy` 时使用当前环境配置。

## 📦 GitHub 自动构建

- 推送到 `main` 或提交 Pull Request 时，CI 会检查前端，运行 Windows x64、macOS、Linux x64/ARM64 测试，并交叉检查 Windows ARM64 编译。
- 推送形如 `v0.1.0` 的标签时，Release 工作流会运行 Windows x64/ARM64、macOS Universal、Linux x64/ARM64 共 5 个打包任务，并创建 GitHub 草稿 Release。
- 自动构建产物默认未进行 Windows 代码签名、macOS Developer ID 签名或公证。发布前需要核对哈希、中英文发布说明和真实设备验证结果。
- CI 编译成功只代表源码可以在对应 runner 上构建，不代表该平台的代理行为已经完成正式验证。

| 平台 | 芯片架构 | 每个版本的格式 | 打包组合数 |
| --- | --- | --- | --- |
| Windows | x64、ARM64 | MSI、NSIS EXE | 4 |
| macOS | 一个 Universal 包含 x64、ARM64 | App、DMG | 2 |
| Linux | x64、ARM64 | AppImage、DEB、RPM | 6 |

不再提供 32 位 x86 版本；当前主流桌面芯片由 x64 和 ARM64 覆盖。

完整流程和资产列表见[发布指南](docs/zh-CN/releasing.md)。

## 📚 文档

- [文档索引](docs/README.md)
- [架构说明](docs/zh-CN/architecture.md)
- [开发指南](docs/zh-CN/development.md)
- [发布指南](docs/zh-CN/releasing.md)
- [验证说明](docs/zh-CN/verification.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [更新日志](CHANGELOG.md)

## 🔒 安全提示

Haruha 会修改当前用户的系统代理设置。退出应用时会尝试关闭代理，但强制终止或系统崩溃可能使系统保留最后一次代理状态。若网络异常，请先在系统设置中关闭代理，再提交问题。

项目不包含遥测或分析模块。Windows 应用统计仅在本次监控期间累计 PID、方向和字节数，不采集内容、域名、IP 或端口，也不保存历史；IP 查询、测速和站点图标功能会访问第三方网络服务。具体边界见[架构说明](docs/zh-CN/architecture.md#网络与隐私边界)。

## 📄 许可证

本项目使用 [MIT License](LICENSE)。
