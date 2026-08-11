# Verification Guide

English | [简体中文](../zh-CN/verification.md)

## Evidence levels

1. Static: TypeScript, formatting, and source review.
2. Unit: Rust configuration, rule, and PAC behavior.
3. Build: frontend bundle, Rust binary, or installer creation.
4. Runtime: proxy, PAC, tray, and recovery on the real target operating system.
5. Release: download from the public Release, verify hashes, and install on a clean machine.

Every conclusion must identify its evidence level. HTTP 200, a successful build, or source availability does not replace real platform validation.

## Every pull request

```powershell
bun install --frozen-lockfile
bun run check
bun run build
bun run format:rust:check
bun run test:rust
git diff --check
```

CI runs frontend checks and Rust formatting on an Ubuntu runner. Windows x64, macOS, and Linux x64/ARM64 run Rust unit tests, while Windows ARM64 receives a cross-compilation check. Platform behavior changes also require documented manual steps and results.

The Release workflow triggered by `v*` tags runs five packaging jobs—Windows x64/ARM64, macOS Universal, and Linux x64/ARM64—and creates a draft Release. That outcome is evidence level 3; only checks on the corresponding real devices can raise it to level 4 or 5.

## Manual checklist

- Frontend: no overflow at primary viewports, readable themes, visible keyboard focus, and no console errors.
- Manual proxy: correct write, switch, disable, and bypass semantics for the platform.
- PAC: loopback URL is reachable, proxy/direct precedence is correct, and a busy preferred port falls back.
- Tray: main/tray state remains synchronized; repeated open and exit leave no orphan windows.
- Failures: invalid proxy, offline state, missing permission, and third-party failures produce visible errors.
- Recovery: restart restores the saved mode; explicit exit disables the system proxy; force-exit recovery is documented.

## Current baseline

The open-source migration snapshot passed these checks on 2026-08-10:

- `bun install --frozen-lockfile`
- `bun run check`
- `bun run build`
- `bun run format:rust:check`
- `bun run test:rust`: 20 passed, 0 failed
- Local links in Chinese/English Markdown, PowerShell syntax, and JSON parsing
- `bun run tauri:build:windows -- -NoBundle`: generated the Windows release EXE

Historical project evidence also covers a Windows MSI and primary tray interaction. This migration did not rebuild the MSI or run a new installer/runtime E2E. macOS and Linux still have no formal real-device delivery evidence. Current repository CI/local output remains the source of truth for exact command results.

The multi-platform CI/Release configuration added on 2026-08-11 has only undergone local static checks until it is pushed to GitHub; it is not yet evidence of a successful Actions run.
