# 平台支持说明

[English](../en/platform-support.md) | 简体中文

| 能力 | Windows | macOS | Linux |
| --- | --- | --- | --- |
| 读取系统代理 | 是 | 是 | GNOME 系桌面 |
| 写入 HTTP/HTTPS 手动代理 | 是 | 是 | GNOME 系桌面 |
| PAC Auto Proxy URL | 是 | 是 | GNOME 系桌面 |
| 绕过名单 | 是 | 是 | GNOME 系桌面 |
| 托盘面板 | 已实现并验证 | 当前能力声明为否 | 当前能力声明为否 |
| 自动打包配置 | x64/ARM64 MSI、NSIS | x64 + ARM64 Universal App、DMG | x64/ARM64 AppImage、DEB、RPM |
| 当前真实证据 | x64 EXE/MSI | 尚无正式 `.app`/`.dmg` 证据 | 尚无正式包证据 |

## Windows

通过当前用户注册表 `Internet Settings` 与 WinINet 刷新系统代理。主要开发和 x64 打包链路已经在 Windows 上运行过；ARM64 当前只有自动交叉编译配置，公开版本仍应按发布指南在对应架构的干净机器复验。

## macOS

源码使用 `networksetup` 遍历网络服务并写入 Web Proxy、Secure Web Proxy 和 Auto Proxy URL。正式支持前必须在真实 Mac 验证权限提示、Wi-Fi/有线网络切换、PAC 获取、应用重启、关闭/退出、强制终止恢复，以及目标应用是否遵循系统代理。当前只配置 HTTP/HTTPS，不配置 SOCKS。

## Linux

源码对 GNOME、Cinnamon 和 Unity 使用 `gsettings`。KDE 和未知桌面会返回限制信息，不应显示伪成功。正式支持前需要在各目标发行版真实验证桌面会话、权限、代理格式、PAC、重启和恢复。

## 通用限制

- 系统代理只影响遵循系统设置的应用。
- 手动模式无法表达 PAC 中所有 CIDR/URL 通配符语义。
- 流量概览是全部网卡流量，不是代理专用统计。
- 强制退出无法保证代理设置恢复。
