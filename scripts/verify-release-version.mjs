import { readFile } from "node:fs/promises";

const [packageSource, tauriSource, cargoSource] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8"),
]);

const packageVersion = JSON.parse(packageSource).version;
const tauriVersion = JSON.parse(tauriSource).version;
const cargoPackage = cargoSource.match(/^\[package\]\s*$([\s\S]*?)^\[/m)?.[1];
const cargoVersion = cargoPackage?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];

const versions = {
  "package.json": packageVersion,
  "src-tauri/tauri.conf.json": tauriVersion,
  "src-tauri/Cargo.toml": cargoVersion,
};

if (
  !packageVersion ||
  Object.values(versions).some((version) => version !== packageVersion)
) {
  console.error("Release versions are missing or inconsistent:");
  for (const [file, version] of Object.entries(versions)) {
    console.error(`- ${file}: ${version ?? "<missing>"}`);
  }
  process.exit(1);
}

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const expectedTag = `v${packageVersion}`;

if (tag && tag !== expectedTag) {
  console.error(`Release tag mismatch: expected ${expectedTag}, received ${tag}.`);
  process.exit(1);
}

console.log(
  tag
    ? `Release versions and tag match: ${tag}.`
    : `Release versions match: ${packageVersion}.`,
);
