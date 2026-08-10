# Development Guide

English | [简体中文](../zh-CN/development.md)

## Requirements

- Bun 1.3+
- Stable Rust installed through rustup
- Node.js for compatibility with parts of the toolchain; Bun remains the package manager
- Tauri 2 system prerequisites for the current operating system
- Windows: Visual Studio 2022 Desktop development with C++ and a Windows 10/11 SDK
- Optional: Python 3 and Pillow to regenerate icons

On Windows, start with:

```powershell
.\scripts\check-environment.ps1
.\scripts\check-environment.ps1 -Json
```

## Install and run

```powershell
bun install --frozen-lockfile
bun run tauri:dev
```

`bun run dev` starts only the frontend at `127.0.0.1:1420` and is useful for layout work. System-proxy commands use mock data there. Validate complete behavior inside the Tauri window.

## Quality commands

```powershell
bun run check
bun run build
bun run format:rust:check
bun run test:rust
```

Provide a download proxy to Cargo explicitly when needed:

```powershell
.\scripts\cargo-with-proxy.ps1 -Proxy http://127.0.0.1:7890 test
```

Without `-Proxy`, the script does not set proxy environment variables. `-NoProxy` removes `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` for the child process.

## Repository layout

```text
.
├── .github/             # CI and pull request template
├── docs/                # Bilingual architecture, development, platform, verification, and release docs
├── scripts/             # Reproducible development/build helpers
├── src/                 # React and TypeScript frontend
├── src-tauri/           # Rust/Tauri backend and platform adapters
├── CHANGELOG.md         # One-to-one Chinese and English release notes
├── package.json         # Frontend dependencies and unified commands
└── bun.lock             # Reproducible frontend dependency lock
```

Generated directories are ignored. Never commit `node_modules`, `dist`, any `target`, `.restart-*`, `tools`, logs, or installers.

## Frontend changes

- Start cross-page state and mode-switching work in `src/app/HaruhaApp.tsx`.
- Keep backend calls in `src/lib/api.ts`; page components should not scatter direct `invoke` calls.
- Reuse the design tokens and small local components in `src/styles.css`; do not add a large UI framework.
- Prefer `transform`/`opacity` motion and support `prefers-reduced-motion`.
- Browser preview validates UI only. System proxy and tray changes require the Tauri runtime.

## Rust and platform changes

- Keep command orchestration in `src-tauri/src/lib.rs`.
- Keep configuration migration and persistence in `config.rs`; new fields must remain compatible with old JSON.
- Keep PAC behavior in `pac.rs` and add unit tests.
- Isolate operating-system differences in `platform/windows.rs`, `macos.rs`, and `linux.rs`.
- Do not run blocking system calls directly on async executor threads.

## Regenerating icons

Existing builds do not require icon regeneration. After changing the brand source image:

```powershell
python -m pip install Pillow
python .\scripts\generate-tauri-icon.py
```

See `scripts/generate-tray-assets.py --help` for advanced tray source options. Inspect small sizes, light/dark themes, and transparency before committing.

## Before submitting

Run all four quality commands, confirm that `git status` contains only intended files, and scan for tokens, private keys, `.env` files, real private-network addresses, and personal absolute paths. For platform changes, state which operating system was tested on real hardware and which received source-only review.
