# Contributing

English | [简体中文](CONTRIBUTING.md)

Thank you for improving Haruha. Search existing issues before submitting code. For platform behavior, configuration-format changes, or broad UI work, open an issue first and describe the problem, proposed design, and validation environment.

## Local development

```powershell
bun install --frozen-lockfile
bun run check
bun run build
bun run test:rust
bun run format:rust:check
```

Use `bun run tauri:dev` for desktop integration. Running only `bun run dev` uses browser mock data for system-proxy features and does not validate operating-system behavior.

## Submission rules

- Keep each pull request focused on one problem; avoid unrelated refactors.
- Use clear prefixes such as `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `build:`, or `chore:`.
- Do not commit `node_modules`, `dist`, `target`, installers, logs, downloaded tools, or local configuration.
- Never add proxy credentials, tokens, private keys, private-network addresses, or personal absolute paths.
- When system proxy or PAC semantics change, update both Chinese and English architecture/platform documentation.
- User-facing release notes in `CHANGELOG.md` must have matching Chinese and English entries.

## Pull request checklist

- [ ] TypeScript checks and the frontend build pass
- [ ] Rust formatting and unit tests pass
- [ ] Tested and untested platforms are stated explicitly
- [ ] New behavior has tests or clear manual verification steps
- [ ] Documentation matches the code
- [ ] No sensitive information or generated artifacts are included

See the [development guide](docs/en/development.md) for the complete environment and command reference.
