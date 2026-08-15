<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="Haruha project icon">
</p>

<h1 align="center">Haruha</h1>

<p align="center">A lightweight, modern cross-platform system proxy manager</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=0B1F33" alt="React 19">
  <img src="https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white" alt="Rust stable">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/License-MIT-2EA44F" alt="MIT License">
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-6E56CF" alt="Windows, macOS and Linux">
  <img src="https://img.shields.io/badge/Build-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white" alt="GitHub Actions">
</p>

<p align="center">English · <a href="README.md">简体中文</a></p>

Haruha is built with Tauri 2, React 19, and Rust. It configures operating-system HTTP/HTTPS manual proxies and PAC auto-proxy settings, with rule management, connectivity tests, IP information, traffic summaries, and desktop tray controls.

> Haruha is not a proxy protocol implementation and does not provide proxy servers. You need an accessible upstream HTTP proxy before using it.

## ✨ Features

- Manual proxy, PAC auto-proxy, and proxy-off modes
- PAC proxy/direct rules and shared rule lists
- Windows desktop tray with quick mode switching
- Proxy connectivity, IP information, and proxied/direct download-speed tests
- Windows live physical-interface traffic and per-application session totals (UAC required)
- Local configuration, logs, and favicon cache
- Read-only migration of legacy Windows configuration

## 🖥️ Platform status

| Platform | Source implementation | Current verification status |
| --- | --- | --- |
| Windows 10/11 | x64 and ARM64; automated MSI/NSIS packaging for each architecture | x64 development and packaging verified; ARM64 still requires real-device validation |
| macOS | x64 + ARM64 Universal; automated App/DMG packaging | Implemented in source; real-Mac release validation is still required |
| Linux | x64 and ARM64; automated AppImage/DEB/RPM packaging for each architecture | Experimental; KDE and other desktops are not fully supported |

See the [platform support guide](docs/en/platform-support.md) for details.

## 🚀 Quick start

Install:

- [Bun](https://bun.sh/) 1.3 or newer
- The stable [Rust](https://rustup.rs/) toolchain
- The [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/)
- Visual Studio 2022 Desktop development with C++ and a Windows SDK for Windows packaging

```powershell
cd proxy-manager-next
bun install --frozen-lockfile
bun run tauri:dev
```

The first-run profile and Restore Defaults prefill `192.168.0.6:10808`, but first launch does not change the system proxy automatically. Confirm or replace the address before enabling it.

## 🛠️ Common commands

```powershell
bun run check              # TypeScript static check
bun run build              # Frontend production build
bun run test:rust          # Rust unit tests
bun run format:rust:check  # Rust formatting check
bun run tauri:dev          # Desktop development mode
bun run tauri:build        # Production build for the current platform
bun run tauri:build:windows:all  # Windows x64/ARM64 MSI and NSIS
```

To provide an explicit download proxy to Cargo:

```powershell
.\scripts\cargo-with-proxy.ps1 -Proxy http://127.0.0.1:7890 test
```

The script has no built-in proxy address. Without `-Proxy`, it uses the current environment.

## 📦 GitHub automated builds

- On pushes to `main` and pull requests, CI checks the frontend, tests Windows x64, macOS, and Linux x64/ARM64, and cross-checks Windows ARM64 compilation.
- Pushing a tag such as `v0.1.0` runs five packaging jobs—Windows x64/ARM64, macOS Universal, and Linux x64/ARM64—and creates a draft GitHub Release.
- Automated artifacts are unsigned by default: they have no Windows code signature, macOS Developer ID signature, or notarization. Verify hashes, bilingual release notes, and real-device test evidence before publishing.
- A successful CI build proves that the source compiles on the runner; it does not prove formal validation of system-proxy behavior on that platform.

| Platform | Chip architectures | Formats per version | Package combinations |
| --- | --- | --- | --- |
| Windows | x64 and ARM64 | MSI and NSIS EXE | 4 |
| macOS | One Universal build containing x64 and ARM64 | App and DMG | 2 |
| Linux | x64 and ARM64 | AppImage, DEB, and RPM | 6 |

32-bit x86 builds are intentionally omitted; x64 and ARM64 cover the current mainstream desktop architectures.

See the [release guide](docs/en/releasing.md) for the complete flow and asset list.

## 📚 Documentation

- [Documentation index](docs/README.md)
- [Architecture](docs/en/architecture.md)
- [Development guide](docs/en/development.md)
- [Release guide](docs/en/releasing.md)
- [Verification guide](docs/en/verification.md)
- [Contributing](CONTRIBUTING.en.md)
- [Security policy](SECURITY.en.md)
- [Changelog](CHANGELOG.md)

## 🔒 Safety note

Haruha changes the current user's system proxy settings. It attempts to disable the proxy during a normal exit, but a forced termination or system crash may leave the last settings active. If networking fails, disable the proxy in the operating-system settings before filing an issue.

The project contains no telemetry or analytics module. Windows application totals accumulate only PID, direction, and byte count for the current monitoring session; they do not capture content, domains, IP addresses, ports, or history. IP lookup, speed testing, and favicon features contact third-party services. See [Network and privacy boundaries](docs/en/architecture.md#network-and-privacy-boundaries).

## 📄 License

Licensed under the [MIT License](LICENSE).
