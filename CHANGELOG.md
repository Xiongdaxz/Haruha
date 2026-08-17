# Changelog / 更新日志

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。每条中文说明都应有一条含义一致的英文说明。

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/). Every Chinese entry must have a matching English entry with the same meaning.

## Unreleased

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
- 统一 GitHub Release 资产的排序与平台命名，并新增 Windows x64/ARM64 免安装可执行文件和中英文下载对照表。

### English

- Improved proxy-mode switching and configuration reliability by serializing concurrent operations, restoring system state on failure, and adding atomic writes, valid backups, corrupt-file quarantine, and cross-platform single-instance protection.
- Improved proxy, direct, and PAC rule management with sorting, separate disabled counts, confirmed rule creation, and real system-proxy refresh when the window becomes visible again.
- Added separate proxied/direct speed tests, real progress animation, speed ratings, and categorized history; switching to a route without a result now runs one automatic test.
- Added Windows per-application traffic totals for downloads and uploads, reused the elevated helper within one run, and excluded virtual and loopback adapters from live system traffic.
- Refined overview cards, quick sites, the tray panel, and multi-theme switching, and unified the Haruha app, executable, and clean window titles.
- Updated the first-run and Restore Defaults proxy to `192.168.0.6:10808`, kept proxy mode off on first launch, and safely migrated the legacy default.
- Corrected Linux KDE capability reporting and stopped implicitly changing the Windows WinHTTP proxy to avoid affecting unrelated system services.
- Standardized GitHub Release asset ordering and platform names, and added portable Windows x64/ARM64 executables with a bilingual download guide.

## 0.1.0 - 2026-08-11

### 中文

- 为中英文 README 增加项目图标、技术栈、许可证、平台和 GitHub Actions 徽章，并补充自动构建入口。
- 新增 Windows x64/ARM64、macOS Universal、Linux x64/ARM64 的 GitHub CI 和标签自动打包流程，校验版本与标签并自动创建待人工审核的草稿 Release。
- 将 Haruha 整理为独立开源仓库结构，并补齐中英文项目、架构、开发、验证和发布文档。
- 将首次运行示例代理改为 `127.0.0.1:1080`，移除内网代理默认值和本机验证路径。
- 排除依赖、构建缓存、下载工具、日志和安装包等不可提交产物。
- 首次发布 Tauri 2、React 和 Rust 桌面应用。
- 支持手动代理、PAC 自动代理、统一直连/代理名单和本地 PAC 服务。
- 支持 Windows 托盘、代理测试、IP 查询、测速、流量概览、主题和本地配置迁移。

### English

- Added the project icon, technology, license, platform, and GitHub Actions badges to both READMEs, together with an automated-build entry point.
- Added GitHub CI and tag-driven packaging for Windows x64/ARM64, macOS Universal, and Linux x64/ARM64, validating versions and tags before creating draft Releases for manual review.
- Prepared Haruha as a standalone open-source repository with bilingual project, architecture, development, verification, and release documentation.
- Changed the first-run example proxy to `127.0.0.1:1080` and removed private-network defaults and machine-specific verification paths.
- Excluded dependencies, build caches, downloaded tools, logs, installers, and other generated artifacts.
- Initial Tauri 2, React, and Rust desktop application release.
- Added manual proxy, PAC auto-proxy, shared direct/proxy lists, and a local PAC server.
- Added the Windows tray, proxy tests, IP lookup, speed testing, traffic overview, themes, and local configuration migration.
