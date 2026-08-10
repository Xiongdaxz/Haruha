# Release Guide

English | [简体中文](../zh-CN/releasing.md)

This document covers the complete public release flow from a clean `main` branch. Windows is the current formal release baseline. List macOS or Linux assets as supported only after real-device validation on the corresponding platform.

## 1. Select the version

Use Semantic Versioning `MAJOR.MINOR.PATCH` and tags in the form `vMAJOR.MINOR.PATCH`. Update these together:

1. `version` in `package.json`
2. `version` in `src-tauri/Cargo.toml`
3. `version` in `src-tauri/tauri.conf.json`
4. Run `cargo check --manifest-path src-tauri/Cargo.toml` to synchronize the root package version in `Cargo.lock`, and confirm that no dependency was upgraded accidentally
5. `CHANGELOG.md`: move `Unreleased` entries into a dated version and keep Chinese/English bullets one-to-one

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

## 3. Build Windows assets

Check the environment, then build the MSI:

```powershell
.\scripts\check-environment.ps1 -Json
bun run tauri:build:windows
```

When a download proxy is required:

```powershell
bun run tauri:build:windows -- -Proxy http://127.0.0.1:7890
```

Typical output:

```text
src-tauri/target/release/proxy-manager-next.exe
src-tauri/target/release/bundle/msi/*.msi
```

Do not commit these binaries. Upload them only to the matching Release.

## 4. Verify artifacts

Install and run on a Windows machine or clean VM without the source tree. Test uninstall, upgrade, tray behavior, proxy recovery, and the Chinese installer UI. Record file names, byte sizes, and SHA-256 hashes:

```powershell
Get-FileHash .\src-tauri\target\release\proxy-manager-next.exe -Algorithm SHA256
Get-ChildItem .\src-tauri\target\release\bundle\msi\*.msi |
  Get-FileHash -Algorithm SHA256
```

Save the hashes as `SHA256SUMS.txt` and upload it with the Release. Code-sign public Windows binaries when possible; otherwise state clearly that they are unsigned.

## 5. Commit, tag, and create the GitHub Release

The version commit and tag must reference the same validated commit:

```powershell
git tag -s v0.1.0 -m "release: v0.1.0"
git push origin main
git push origin v0.1.0
```

If no signing key is available, use an annotated `git tag -a` and do not imply that the tag is signed. Create a draft with GitHub CLI:

```powershell
gh release create v0.1.0 --draft --verify-tag `
  --title "Haruha v0.1.0" `
  .\src-tauri\target\release\proxy-manager-next.exe `
  .\src-tauri\target\release\bundle\msi\*.msi `
  .\SHA256SUMS.txt
```

## 6. Release notes template

```markdown
## 中文

- 与 CHANGELOG 对应的变更 1
- 与 CHANGELOG 对应的变更 2

### 下载与校验

- Windows EXE：...
- Windows MSI：...
- SHA-256：见 SHA256SUMS.txt
- 已验证：Windows 11 x64
- 未验证：macOS、Linux

## English

- Change 1 matching the Chinese entry
- Change 2 matching the Chinese entry

### Downloads and verification

- Windows EXE: ...
- Windows MSI: ...
- SHA-256: see SHA256SUMS.txt
- Verified: Windows 11 x64
- Not verified: macOS, Linux
```

Before publishing, verify that meaning, order, artifact names, and validation boundaries match exactly in both languages.

## 7. Post-release and rollback

- Download from GitHub on a clean machine and re-check hashes, installation, and startup.
- Inspect the Release page, tag, source archives, and every link.
- For a severe issue, mark the release as a prerelease or remove affected assets and publish a security notice. Never move an existing tag to a different commit.
- Ship the fix as a new patch version and tag, preserving traceability of the original release.
