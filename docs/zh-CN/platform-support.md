# 平台支持说明

[English](../en/platform-support.md) | 简体中文

| 能力 | Windows | macOS | Linux |
| --- | --- | --- | --- |
| 读取系统代理 | 是 | 是 | GNOME 系桌面 |
| 写入 HTTP/HTTPS 手动代理 | 是 | 是 | GNOME 系桌面 |
| PAC Auto Proxy URL | 是 | 是 | GNOME 系桌面 |
| 绕过名单 | 是 | 是 | GNOME 系桌面 |
| 系统物理网卡实时流量 | 是 | 暂不支持 | 暂不支持 |
| 应用本次累计流量 | 是，需要 UAC | 暂不支持 | 暂不支持 |
| 托盘面板 | 已实现并验证 | 当前能力声明为否 | 当前能力声明为否 |
| 自动打包配置 | x64/ARM64 MSI、NSIS | x64 + ARM64 Universal App、DMG | x64/ARM64 AppImage、DEB、RPM |
| 当前真实证据 | x64 EXE/MSI | 尚无正式 `.app`/`.dmg` 证据 | 尚无正式包证据 |

## Windows

通过当前用户注册表 `Internet Settings` 与 WinINet 刷新系统代理。应用流量统计在每次 Haruha 运行期间首次开启时通过 UAC 启动独立 Helper；关闭监控会停止 ETW 但保留空闲 Helper，因此同一运行期间再次开启不再提示 UAC。采集覆盖 TCP/UDP 和 IPv4/IPv6，排除回环并按可执行文件合并多进程。主要开发和 x64 打包链路已经在 Windows 上运行过；ARM64 当前只有自动交叉编译配置。公开版本仍应按发布指南在对应架构的干净机器复验 UAC 取消、采集异常、反复关开、休眠/恢复和退出清理。

## macOS

源码使用 `networksetup` 遍历网络服务并写入 Web Proxy、Secure Web Proxy 和 Auto Proxy URL。正式支持前必须在真实 Mac 验证权限提示、Wi-Fi/有线网络切换、PAC 获取、应用重启、关闭/退出、强制终止恢复，以及目标应用是否遵循系统代理。当前只配置 HTTP/HTTPS，不配置 SOCKS。

## Linux

源码对 GNOME、Cinnamon 和 Unity 使用 `gsettings`。KDE 和未知桌面会返回限制信息，不应显示伪成功。正式支持前需要在各目标发行版真实验证桌面会话、权限、代理格式、PAC、重启和恢复。

## 通用限制

- 系统代理只影响遵循系统设置的应用。
- 手动模式无法表达 PAC 中所有 CIDR/URL 通配符语义。
- 流量概览是已启用物理网卡的流量，不是代理专用统计；虚拟和回环网卡不会计入。
- macOS/Linux 暂不支持系统网卡曲线或按应用拆分。
- Windows 应用统计仅保留本次开启后的内存累计，不提供应用实时速率或历史记录。
- 强制退出无法保证代理设置恢复。
