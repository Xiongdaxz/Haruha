# Changelog / 更新日志

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。每条中文说明都应有一条含义一致的英文说明。

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/). Every Chinese entry must have a matching English entry with the same meaning.

## Unreleased

## 0.1.3 - 2026-08-17

### 中文

- 新增本机 IPv4 与 IPv6 出口的并行检测和卡片切换；单一协议不可用时仍可展示另一协议的查询结果。

### English

- Added parallel detection and card switching for direct IPv4 and IPv6 egress; when one protocol is unavailable, the result for the other remains visible.

## 0.1.2 - 2026-08-17

### 中文

- 精简托盘快捷面板：代理模式和主题使用紧凑的分段切换，支持键盘导航，并仅在用户主动切换时播放滑动反馈。
- 更新应用与托盘图标的透明画布和显示比例，使不同代理状态在系统托盘中更清晰。
- 修复旧版内置直连规则的迁移：历史配置仅清理一次，迁移后用户重新添加的同名规则会被保留。

### English

- Streamlined the tray panel with compact segmented controls for proxy modes and themes, keyboard navigation, and sliding feedback only after user-initiated switches.
- Updated the transparent canvas and scale of the app and tray icons so different proxy states are clearer in the system tray.
- Fixed migration of a legacy built-in direct rule so historical configurations are cleaned once while the same rule remains available when users add it again later.

## 0.1.1 - 2026-08-15

### 中文

- 提升代理模式切换和配置可靠性：串行处理并发操作，失败时恢复原系统状态，并使用原子写入、有效备份、损坏文件隔离和跨平台单实例保护。
- 改进代理、直连与 PAC 规则管理：支持规则排序、分别统计停用数量、确认新增规则，并在窗口恢复显示时刷新真实系统代理状态。
- 新增代理/直连双测速、真实进度动画、速度评级与分类历史；切换到尚无结果的线路时会自动测速一次。
- 新增 Windows 应用流量统计，按应用展示下载、上传和累计流量；同一次运行复用提权 Helper，系统实时流量排除虚拟和回环网卡。
- 优化总览卡片、快捷网站、托盘面板和多主题切换，并统一 Haruha 应用、可执行文件与简洁窗口标题。
- 将首次运行与恢复默认的代理地址更新为 `192.168.0.6:10808`，首次启动保持代理关闭，并安全迁移旧默认值。
- 修正 Linux KDE 能力提示，并停止隐式修改 Windows WinHTTP 代理，避免影响不相关的系统服务。

### English

- Improved proxy-mode switching and configuration reliability by serializing concurrent operations, restoring system state on failure, and adding atomic writes, valid backups, corrupt-file quarantine, and cross-platform single-instance protection.
- Improved proxy, direct, and PAC rule management with sorting, separate disabled counts, confirmed rule creation, and real system-proxy refresh when the window becomes visible again.
- Added separate proxied/direct speed tests, real progress animation, speed ratings, and categorized history; switching to a route without a result now runs one automatic test.
- Added Windows per-application traffic totals for downloads and uploads, reused the elevated helper within one run, and excluded virtual and loopback adapters from live system traffic.
- Refined overview cards, quick sites, the tray panel, and multi-theme switching, and unified the Haruha app, executable, and clean window titles.
- Updated the first-run and Restore Defaults proxy to `192.168.0.6:10808`, kept proxy mode off on first launch, and safely migrated the legacy default.
- Corrected Linux KDE capability reporting and stopped implicitly changing the Windows WinHTTP proxy to avoid affecting unrelated system services.

## 0.1.0 - 2026-08-10

### 中文

- 首次发布 Tauri 2、React 和 Rust 桌面应用。
- 支持手动代理、PAC 自动代理、统一直连/代理名单和本地 PAC 服务。
- 支持 Windows 托盘、代理测试、IP 查询、测速、流量概览、主题和本地配置迁移。

### English

- Initial Tauri 2, React, and Rust desktop application release.
- Added manual proxy, PAC auto-proxy, shared direct/proxy lists, and a local PAC server.
- Added the Windows tray, proxy tests, IP lookup, speed testing, traffic overview, themes, and local configuration migration.
