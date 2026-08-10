# Haruha

[English](README.en.md) | 简体中文

Haruha 是一个使用 Tauri 2、React 19 和 Rust 构建的跨平台系统代理管理器。它负责配置操作系统的 HTTP/HTTPS 手动代理和 PAC 自动代理，并提供规则管理、连接测试、IP 信息、流量概览和桌面托盘操作。

> Haruha 不是代理协议实现，也不提供代理节点。使用前需要准备一个可访问的上游 HTTP 代理地址。

## 功能

- 手动代理、PAC 自动代理和关闭代理三种模式
- PAC 代理/直连规则及跨配置统一名单
- Windows 桌面托盘和快速模式切换
- 代理连接、IP 信息及下载速度测试
- 系统网卡总流量概览
- 本地配置、日志和站点图标缓存
- 旧版 Windows 配置的只读迁移

## 平台状态

| 平台 | 源码实现 | 当前验证状态 |
| --- | --- | --- |
| Windows 10/11 | 注册表与 WinINet，EXE/MSI 打包 | 已完成主要开发与打包验证 |
| macOS | `networksetup` 手动代理与 PAC | 源码已实现，正式发布前仍需真实 Mac 验证 |
| Linux | GNOME 系桌面的 `gsettings` | 实验性；KDE 和其他桌面尚未完整支持 |

详见[平台支持说明](docs/zh-CN/platform-support.md)。

## 快速开始

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

首次启动使用 `127.0.0.1:1080` 作为安全示例，请在界面中改成你自己的代理地址。

## 常用命令

```powershell
bun run check              # TypeScript 静态检查
bun run build              # 前端生产构建
bun run test:rust          # Rust 单元测试
bun run format:rust:check  # Rust 格式检查
bun run tauri:dev          # 桌面开发模式
bun run tauri:build        # 当前平台正式构建
```

需要为 Cargo 显式指定下载代理时：

```powershell
.\scripts\cargo-with-proxy.ps1 -Proxy http://127.0.0.1:7890 test
```

脚本没有内置代理地址；不传 `-Proxy` 时使用当前环境配置。

## 文档

- [文档索引](docs/README.md)
- [架构说明](docs/zh-CN/architecture.md)
- [开发指南](docs/zh-CN/development.md)
- [发布指南](docs/zh-CN/releasing.md)
- [验证说明](docs/zh-CN/verification.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [更新日志](CHANGELOG.md)

## 安全提示

Haruha 会修改当前用户的系统代理设置。退出应用时会尝试关闭代理，但强制终止或系统崩溃可能使系统保留最后一次代理状态。若网络异常，请先在系统设置中关闭代理，再提交问题。

项目不包含遥测或分析模块。IP 查询、测速和站点图标功能会访问第三方网络服务，具体边界见[架构说明](docs/zh-CN/architecture.md#网络与隐私边界)。

## 许可证

本项目使用 [MIT License](LICENSE)。
