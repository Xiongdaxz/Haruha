# Changelog / 更新日志

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。每条中文说明都应有一条含义一致的英文说明。

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/). Every Chinese entry must have a matching English entry with the same meaning.

## Unreleased

### 中文

- 统一 GitHub Release 资产的排序与平台命名，并新增 Windows x64/ARM64 免安装可执行文件和中英文下载对照表。

### English

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
