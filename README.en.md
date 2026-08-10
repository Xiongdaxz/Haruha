# Haruha

English | [简体中文](README.md)

Haruha is a cross-platform system proxy manager built with Tauri 2, React 19, and Rust. It configures operating-system HTTP/HTTPS manual proxies and PAC auto-proxy settings, with rule management, connectivity tests, IP information, traffic summaries, and desktop tray controls.

> Haruha is not a proxy protocol implementation and does not provide proxy servers. You need an accessible upstream HTTP proxy before using it.

## Features

- Manual proxy, PAC auto-proxy, and proxy-off modes
- PAC proxy/direct rules and shared rule lists
- Windows desktop tray with quick mode switching
- Proxy connectivity, IP information, and download-speed tests
- Aggregate network-interface traffic overview
- Local configuration, logs, and favicon cache
- Read-only migration of legacy Windows configuration

## Platform status

| Platform | Source implementation | Current verification status |
| --- | --- | --- |
| Windows 10/11 | Registry and WinINet; EXE/MSI packaging | Main development and packaging flows verified |
| macOS | `networksetup` manual proxy and PAC | Implemented in source; real-Mac release validation is still required |
| Linux | `gsettings` on GNOME-family desktops | Experimental; KDE and other desktops are not fully supported |

See the [platform support guide](docs/en/platform-support.md) for details.

## Quick start

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

The first-run profile uses `127.0.0.1:1080` as a safe example. Replace it with your own proxy address in the UI.

## Common commands

```powershell
bun run check              # TypeScript static check
bun run build              # Frontend production build
bun run test:rust          # Rust unit tests
bun run format:rust:check  # Rust formatting check
bun run tauri:dev          # Desktop development mode
bun run tauri:build        # Production build for the current platform
```

To provide an explicit download proxy to Cargo:

```powershell
.\scripts\cargo-with-proxy.ps1 -Proxy http://127.0.0.1:7890 test
```

The script has no built-in proxy address. Without `-Proxy`, it uses the current environment.

## Documentation

- [Documentation index](docs/README.md)
- [Architecture](docs/en/architecture.md)
- [Development guide](docs/en/development.md)
- [Release guide](docs/en/releasing.md)
- [Verification guide](docs/en/verification.md)
- [Contributing](CONTRIBUTING.en.md)
- [Security policy](SECURITY.en.md)
- [Changelog](CHANGELOG.md)

## Safety note

Haruha changes the current user's system proxy settings. It attempts to disable the proxy during a normal exit, but a forced termination or system crash may leave the last settings active. If networking fails, disable the proxy in the operating-system settings before filing an issue.

The project contains no telemetry or analytics module. IP lookup, speed testing, and favicon features contact third-party services. See [Network and privacy boundaries](docs/en/architecture.md#network-and-privacy-boundaries).

## License

Licensed under the [MIT License](LICENSE).
