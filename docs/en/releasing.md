# Release Guide

English | [简体中文](../zh-CN/releasing.md)

This document covers the complete public release flow from a clean `main` branch. GitHub Actions can compile assets for Windows, macOS, and Linux, but Windows remains the current formal runtime-validation baseline. Claim macOS or Linux support only after real-device validation on that platform.

## 1. Select the version

Use Semantic Versioning `MAJOR.MINOR.PATCH` and tags in the form `vMAJOR.MINOR.PATCH`. Update these together:

1. `version` in `package.json`
2. `version` in `src-tauri/Cargo.toml`
3. `version` in `src-tauri/tauri.conf.json`
4. Run `cargo check --manifest-path src-tauri/Cargo.toml` to synchronize the root package version in `Cargo.lock`, and confirm that no dependency was upgraded accidentally
5. `CHANGELOG.md`: move `Unreleased` entries into a dated version and keep Chinese/English bullets one-to-one

Check that all three version files agree. Passing a tag also verifies the full tag including its `v` prefix:

```powershell
bun run release:verify-version v0.1.0
```

Then run:

```powershell
bun install --frozen-lockfile
bun run check
bun run build
bun run format:rust:check
bun run test:rust
git diff --check
```

## 2. Validate platform behavior

At minimum, test:

- First launch and legacy configuration migration
- Manual proxy enable, address switch, and disable
- PAC availability, rule matching, and preferred-port fallback
- Close-to-tray, tray switching, and explicit exit
- Mode restoration after application restart
- Concrete errors for invalid addresses, missing permission, and failed system commands
- Network recovery after exit or failure

Do not describe a platform as “verified” merely because TypeScript or Rust compiles. Platform claims require runtime evidence on the real operating system.

## 3. GitHub automated checks and packaging

The repository contains two workflows:

- `.github/workflows/ci.yml` runs on pushes to `main`, pull requests, and manual dispatch. Frontend checks run on Ubuntu; Windows x64, macOS, and Linux x64/ARM64 run Rust tests, while Windows ARM64 receives a cross-compilation check.
- `.github/workflows/release.yml` runs when a `v*` tag is pushed. Five architecture packaging jobs run in parallel and upload assets to the same draft GitHub Release.

Automated packaging matrix:

| Platform | Architecture | Assets |
| --- | --- | --- |
| Windows | x64 | MSI and NSIS EXE installers |
| Windows | ARM64 | MSI and NSIS EXE installers |
| macOS | Universal Intel + Apple Silicon | App and DMG |
| Linux | x64 | AppImage, DEB, and RPM |
| Linux | ARM64 | AppImage, DEB, and RPM |

32-bit Windows x86 packages are intentionally omitted. The macOS Universal build contains both x64 and ARM64, so users do not choose a chip-specific package. A successful Actions build is build evidence, not runtime validation on a real device. The workflow currently has no Windows code-signing certificate, Apple Developer ID or notarization credentials, or Linux package-signing key, so automated assets are unsigned by default.

## 4. Commit and trigger a tagged release

The version commit and tag must reference the same validated commit. Push `main` and confirm that CI passes before creating the tag:

```powershell
git push origin main
git tag -s v0.1.0 -m "release: v0.1.0"
git push origin v0.1.0
```

If no Git signing key is available, use an annotated tag:

```powershell
git tag -a v0.1.0 -m "release: v0.1.0"
git push origin v0.1.0
```

Do not imply that an unsigned tag is signed, and never move a published tag. After pushing the tag, inspect the `Release` workflow on GitHub Actions. A successful run creates a draft Release titled `Haruha v0.1.0`.

## 5. Review the draft Release

Automation creates a draft only. Complete this review before clicking Publish:

1. Confirm that all five packaging jobs passed and the tag matches the versions in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Download all assets, record file names and byte sizes, and generate SHA-256 hashes. Save them as `SHA256SUMS.txt` and upload the file to the draft Release.
3. Install and run on every real operating system you plan to claim as supported. Record the OS version, architecture, installation, tray, proxy switching, PAC, and exit-recovery results.
4. Convert the matching `CHANGELOG.md` entries into Chinese and English release notes with one-to-one meaning and ordering.
5. State signing, notarization, and runtime-validation status for every platform. Do not omit unfinished items.

Windows local hash example:

```powershell
Get-FileHash .\src-tauri\target\release\proxy-manager-next.exe -Algorithm SHA256
Get-ChildItem .\src-tauri\target\release\bundle\msi\*.msi |
  Get-FileHash -Algorithm SHA256
```

## 6. Local Windows build fallback

To reproduce all Windows assets locally, check the environment and then build x64/ARM64 MSI and NSIS installers:

```powershell
.\scripts\check-environment.ps1 -Architecture all -Json
bun run tauri:build:windows:all
```

When a download proxy is required:

```powershell
bun run tauri:build:windows:all -- -Proxy http://127.0.0.1:7890
```

Typical output:

```text
src-tauri/target/release/proxy-manager-next.exe
src-tauri/target/release/bundle/msi/*.msi
src-tauri/target/release/bundle/nsis/*-setup.exe
src-tauri/target/aarch64-pc-windows-msvc/release/bundle/msi/*.msi
src-tauri/target/aarch64-pc-windows-msvc/release/bundle/nsis/*-setup.exe
```

Local Windows ARM64 cross-compilation requires the Visual Studio ARM64 C++ tools and a compatible Windows SDK; the script installs the Rust `aarch64-pc-windows-msvc` target when needed. A successful cross-build does not replace installation and proxy-behavior validation on a real Windows ARM64 device. The original `bun run tauri:build:windows` command remains available when only the x64 MSI is needed.

Do not commit binaries. Upload them only to the matching Release.

## 7. Release notes template

```markdown
## 中文

- 与 CHANGELOG 对应的变更 1
- 与 CHANGELOG 对应的变更 2

### 下载与校验

- Windows x64 MSI/NSIS：...
- Windows ARM64 MSI/NSIS：...
- macOS Universal App/DMG：...
- Linux x64 AppImage/DEB/RPM：...
- Linux ARM64 AppImage/DEB/RPM：...
- SHA-256：见 SHA256SUMS.txt
- 已验证：Windows 11 x64
- 未验证：Windows 11 ARM64、macOS、Linux

## English

- Change 1 matching the Chinese entry
- Change 2 matching the Chinese entry

### Downloads and verification

- Windows x64 MSI/NSIS: ...
- Windows ARM64 MSI/NSIS: ...
- macOS Universal App/DMG: ...
- Linux x64 AppImage/DEB/RPM: ...
- Linux ARM64 AppImage/DEB/RPM: ...
- SHA-256: see SHA256SUMS.txt
- Verified: Windows 11 x64
- Not verified: Windows 11 ARM64, macOS, Linux
```

Before publishing, verify that meaning, order, artifact names, and validation boundaries match exactly in both languages.

## 8. Post-release and rollback

- Download from GitHub on a clean machine and re-check hashes, installation, and startup.
- Inspect the Release page, tag, source archives, and every link.
- For a severe issue, mark the release as a prerelease or remove affected assets and publish a security notice. Never move an existing tag to a different commit.
- Ship the fix as a new patch version and tag, preserving traceability of the original release.
