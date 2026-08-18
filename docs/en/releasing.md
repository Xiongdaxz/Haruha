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
- `.github/workflows/release.yml` runs when a `v*` tag is pushed. Five architecture packaging jobs run in parallel and upload assets to the same draft GitHub Release. After all builds succeed, one final job normalizes asset names, generates `update.json`, writes bilingual notes, and publishes the Release as Latest. Manual dispatch can rebuild portable Windows assets and refresh an existing Release.

Automated packaging matrix:

| Platform | Architecture | Assets |
| --- | --- | --- |
| Windows | x64 | Portable EXE, NSIS EXE, and MSI |
| Windows | ARM64 | Portable EXE, NSIS EXE, and MSI |
| macOS | Universal Intel + Apple Silicon | App and DMG |
| Linux | x64 | AppImage, DEB, and RPM |
| Linux | ARM64 | AppImage, DEB, and RPM |

32-bit Windows x86 packages are intentionally omitted. The macOS Universal build contains both x64 and ARM64, so users do not choose a chip-specific package. A successful Actions build is build evidence, not runtime validation on a real device. The workflow currently has no Windows code-signing certificate, Apple Developer ID or notarization credentials, or Linux package-signing key, so automated assets are unsigned by default.

Binary asset names do not use numeric prefixes. The bilingual download table keeps the fixed order Windows x64, Windows ARM64, macOS Universal, Linux x64, and Linux ARM64; each Windows group lists Portable, NSIS, then MSI. A Portable EXE runs without installation, but still depends on the system WebView2 runtime and stores data in the user configuration directory.

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

Do not imply that an unsigned tag is signed, and never move a published tag. After pushing the tag, inspect the `Release` workflow on GitHub Actions. A successful run publishes `Haruha v0.1.0` as the Latest Release.

## 5. Automated publication gates

Automation keeps the Release as a draft until the final job completes all gates:

1. All five packaging jobs must pass, and the tag must match the versions in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. The Release must contain exactly 14 expected binary assets before metadata generation; their final names contain no numeric prefixes.
3. Both Windows portable assets must expose valid GitHub SHA-256 digests. The final job uses those digests and sizes to generate and upload `update.json`.
4. Chinese and English notes are generated from the matching `CHANGELOG.md` version with one-to-one meaning and ordering, including unsigned and real-device-validation boundaries.
5. Only after every gate succeeds does the workflow publish the Release as Latest. A failed gate leaves the Release unpublished.

Automated gates do not replace real-device testing. Before claiming a platform as formally validated, install and run the asset on that operating system and record the OS version, architecture, installation, tray, proxy switching, PAC, update, and exit-recovery results.

Windows local hash example:

```powershell
Get-FileHash .\src-tauri\target\release\Haruha.exe -Algorithm SHA256
Get-ChildItem .\src-tauri\target\release\bundle\msi\*.msi |
  Get-FileHash -Algorithm SHA256
```

### Generate the in-app update manifest

After the portable Windows asset names are final, generate `update.json`. The script extracts up to six Chinese notes from the matching version section in `CHANGELOG.md` and calculates each local asset's byte size and SHA-256:

```powershell
bun run release:generate-update-manifest --tag v0.1.4 `
  --published-at 2026-08-18T08:00:00Z `
  --asset x64=C:\release\Haruha-x64.exe `
  --asset ARM64=C:\release\Haruha-ARM64.exe `
  --output update.json
```

Upload the manifest under its fixed name to the same Release:

```powershell
gh release upload v0.1.4 .\update.json --clobber
```

Clients read `https://github.com/Xiongdaxz/Haruha/releases/latest/download/update.json` by default. Generate and upload the manifest only after the portable assets have been uploaded with their final names. Missing manifests, HTTP failures, invalid JSON, or failed version, architecture, filename, size, SHA-256, and download-URL checks automatically fall back to the GitHub Release API.

The product `master` branch does not own the GitHub release workflow. On the release-only `main` branch, generate and upload `update.json` after asset normalization, allow that file in the release asset plan, and publish only after the manifest upload succeeds. Do not add a duplicate workflow at the same path on `master`.

For local integration, point `HARUHA_UPDATE_MANIFEST_URL` at a loopback HTTP manifest server and `HARUHA_UPDATE_API_URL` at a fallback API stub. Non-loopback download URLs in production builds must use HTTPS.

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
src-tauri/target/release/Haruha.exe
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
