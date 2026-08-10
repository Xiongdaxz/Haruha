# 开发指南

[English](../en/development.md) | 简体中文

## 环境要求

- Bun 1.3+
- Rust stable（通过 rustup 安装）
- Node.js 仅供部分工具链兼容使用，日常包管理使用 Bun
- 当前操作系统对应的 Tauri 2 系统依赖
- Windows：Visual Studio 2022“使用 C++ 的桌面开发”和 Windows 10/11 SDK
- 可选：Python 3 + Pillow，用于重新生成图标

Windows 可先运行：

```powershell
.\scripts\check-environment.ps1
.\scripts\check-environment.ps1 -Json
```

## 安装和运行

```powershell
bun install --frozen-lockfile
bun run tauri:dev
```

`bun run dev` 只启动 `127.0.0.1:1420` 的前端页面，适合查看布局；系统代理命令会使用模拟数据。完整行为必须在 Tauri 窗口中验证。

## 质量命令

```powershell
bun run check
bun run build
bun run format:rust:check
bun run test:rust
```

需要代理下载 Rust 依赖时显式传入：

```powershell
.\scripts\cargo-with-proxy.ps1 -Proxy http://127.0.0.1:7890 test
```

不传 `-Proxy` 时脚本不写代理环境变量。`-NoProxy` 会在子进程中清除 `HTTP_PROXY`、`HTTPS_PROXY` 和 `ALL_PROXY`。

## 目录约定

```text
.
├── .github/             # CI 与 Pull Request 模板
├── docs/                # 中英文架构、开发、平台、验证和发布文档
├── scripts/             # 可复现的开发/构建辅助脚本
├── src/                 # React + TypeScript 前端
├── src-tauri/           # Rust/Tauri 后端与平台适配器
├── CHANGELOG.md         # 一一对应的中英文发布说明
├── package.json         # 前端依赖和统一命令
└── bun.lock             # 可复现前端依赖锁
```

生成目录已加入 `.gitignore`，不要提交 `node_modules`、`dist`、任何 `target`、`.restart-*`、`tools`、日志和安装包。

## 前端修改

- 跨页面状态和模式切换优先从 `src/app/HaruhaApp.tsx` 开始。
- 后端调用集中在 `src/lib/api.ts`，页面组件不要散落直接 `invoke`。
- 沿用 `src/styles.css` 的 design tokens 和小型自有组件，不新增大型 UI 框架。
- 动效优先使用 `transform`/`opacity`，并支持 `prefers-reduced-motion`。
- 浏览器预览只能验证界面；系统代理和托盘必须在 Tauri 运行时验证。

## Rust 和平台修改

- 命令编排放在 `src-tauri/src/lib.rs`。
- 配置迁移和持久化放在 `config.rs`，新字段必须兼容旧 JSON。
- PAC 规则与生成放在 `pac.rs` 并补单元测试。
- 操作系统差异只放在 `platform/windows.rs`、`macos.rs`、`linux.rs`。
- 阻塞系统调用不得直接占用异步执行线程。

## 图标再生成

现有构建不要求重新生成图标。修改品牌源图后可运行：

```powershell
python -m pip install Pillow
python .\scripts\generate-tauri-icon.py
```

托盘源图的高级生成参数见 `scripts/generate-tray-assets.py --help`。提交前检查小尺寸、明暗主题和透明背景。

## 提交前

执行四项质量命令，确认 `git status` 只包含预期文件，并用敏感信息扫描检查令牌、私钥、`.env`、真实内网地址和个人绝对路径。涉及平台行为时，在 Pull Request 中明确“在哪个平台真实验证”和“哪些平台仅源码检查”。
