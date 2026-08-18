const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { readFile, stat, writeFile } = require("node:fs/promises");
const path = require("node:path");

const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_UPDATE_BYTES = 300 * 1024 * 1024;
const ARCHITECTURES = ["x64", "ARM64"];
const DEFAULT_REPOSITORY = "Xiongdaxz/Haruha";

function expectedAssetName(tag, architecture) {
  return `Haruha-${tag}-Windows-${architecture}-Portable.exe`;
}

function extractChineseNotes(changelogSource, tag) {
  if (!TAG_PATTERN.test(tag)) {
    throw new Error(`Invalid stable release tag: ${tag}`);
  }

  const source = changelogSource.replace(/\r\n/g, "\n");
  const version = tag.slice(1);
  const versionHeader = new RegExp(
    `^##\\s+${version.replace(/\./g, "\\.")}\\s+-\\s+\\d{4}-\\d{2}-\\d{2}\\s*$`,
    "m",
  );
  const versionMatch = source.match(versionHeader);
  if (!versionMatch || versionMatch.index === undefined) {
    throw new Error(`Changelog section not found for ${tag}.`);
  }

  const afterVersion = source.slice(versionMatch.index + versionMatch[0].length);
  const nextVersionIndex = afterVersion.search(/^##\s+/m);
  const versionSection =
    nextVersionIndex >= 0
      ? afterVersion.slice(0, nextVersionIndex)
      : afterVersion;
  const chineseMatch = versionSection.match(/^###\s+中文\s*$/m);
  if (!chineseMatch || chineseMatch.index === undefined) {
    throw new Error(`Chinese changelog entries not found for ${tag}.`);
  }

  const afterChinese = versionSection.slice(
    chineseMatch.index + chineseMatch[0].length,
  );
  const nextHeadingIndex = afterChinese.search(/^###\s+/m);
  const chineseSection =
    nextHeadingIndex >= 0
      ? afterChinese.slice(0, nextHeadingIndex)
      : afterChinese;
  const notes = chineseSection
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).replace(/`/g, ""))
    .filter(Boolean)
    .slice(0, 6);
  if (notes.length === 0) {
    throw new Error(`Chinese changelog entries are empty for ${tag}.`);
  }
  return notes;
}

function validateDownloadUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid update download URL: ${value}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Update download URL must use HTTPS: ${value}`);
  }
  if (url.username || url.password) {
    throw new Error(`Update download URL must not contain credentials: ${value}`);
  }
  return url.toString();
}

function createUpdateManifest({ tag, publishedAt, notes, assets }) {
  if (!TAG_PATTERN.test(tag)) {
    throw new Error(`Invalid stable release tag: ${tag}`);
  }
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) {
    throw new Error(`Invalid publication time: ${publishedAt}`);
  }
  if (!Array.isArray(notes) || notes.length === 0) {
    throw new Error("At least one release note is required.");
  }
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error("At least one portable Windows asset is required.");
  }

  const seenArchitectures = new Set();
  const normalizedAssets = assets.map((asset) => {
    if (!ARCHITECTURES.includes(asset.architecture)) {
      throw new Error(`Unsupported architecture: ${asset.architecture}`);
    }
    if (seenArchitectures.has(asset.architecture)) {
      throw new Error(`Duplicate architecture: ${asset.architecture}`);
    }
    seenArchitectures.add(asset.architecture);

    const name = expectedAssetName(tag, asset.architecture);
    if (asset.name !== name) {
      throw new Error(`Unexpected asset name: ${asset.name}; expected ${name}`);
    }
    if (
      !Number.isSafeInteger(asset.sizeBytes) ||
      asset.sizeBytes <= 0 ||
      asset.sizeBytes > MAX_UPDATE_BYTES
    ) {
      throw new Error(`Invalid asset size for ${name}: ${asset.sizeBytes}`);
    }
    const sha256 = String(asset.sha256 || "").toLowerCase();
    if (!SHA256_PATTERN.test(sha256)) {
      throw new Error(`Invalid SHA-256 for ${name}.`);
    }

    return {
      name,
      architecture: asset.architecture,
      installKind: "portable",
      sizeBytes: asset.sizeBytes,
      sha256,
      downloadUrl: validateDownloadUrl(asset.downloadUrl),
    };
  });
  normalizedAssets.sort(
    (left, right) =>
      ARCHITECTURES.indexOf(left.architecture) -
      ARCHITECTURES.indexOf(right.architecture),
  );

  const normalizedNotes = notes
    .map((note) => String(note).trim().replace(/`/g, ""))
    .filter(Boolean)
    .slice(0, 6);
  if (normalizedNotes.length === 0) {
    throw new Error("At least one non-empty release note is required.");
  }

  return {
    schemaVersion: 1,
    version: tag.slice(1),
    tagName: tag,
    publishedAt: new Date(publishedAt).toISOString(),
    notes: normalizedNotes,
    assets: normalizedAssets,
  };
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function buildManifestFromLocalFiles({
  tag,
  publishedAt,
  notes,
  files,
  repository = DEFAULT_REPOSITORY,
}) {
  const assets = [];
  for (const architecture of ARCHITECTURES) {
    const filePath = files.get(architecture);
    if (!filePath) continue;
    const metadata = await stat(filePath);
    if (!metadata.isFile()) {
      throw new Error(`Portable asset is not a file: ${filePath}`);
    }
    const name = expectedAssetName(tag, architecture);
    assets.push({
      name,
      architecture,
      sizeBytes: metadata.size,
      sha256: await sha256File(filePath),
      downloadUrl: `https://github.com/${repository}/releases/download/${tag}/${name}`,
    });
  }
  return createUpdateManifest({ tag, publishedAt, notes, assets });
}

function createUpdateManifestFromGithubRelease({
  release,
  releaseAssets,
  notes,
  repository = DEFAULT_REPOSITORY,
}) {
  const tag = release?.tag_name;
  const assets = [];
  for (const architecture of ARCHITECTURES) {
    const name = expectedAssetName(tag, architecture);
    const asset = releaseAssets.find((candidate) => candidate.name === name);
    if (!asset) continue;
    const digest = String(asset.digest || "");
    if (!digest.startsWith("sha256:")) {
      throw new Error(`GitHub asset is missing a SHA-256 digest: ${name}`);
    }
    assets.push({
      name,
      architecture,
      sizeBytes: asset.size,
      sha256: digest.slice("sha256:".length),
      downloadUrl:
        asset.browser_download_url ||
        `https://github.com/${repository}/releases/download/${tag}/${name}`,
    });
  }
  return createUpdateManifest({
    tag,
    publishedAt: release.published_at,
    notes,
    assets,
  });
}

function parseArguments(arguments_) {
  const options = {
    output: "update.json",
    changelog: "CHANGELOG.md",
    publishedAt: new Date().toISOString(),
    repository: DEFAULT_REPOSITORY,
    files: new Map(),
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--asset") {
      if (!value || !value.includes("=")) {
        throw new Error("--asset must use architecture=path.");
      }
      const separator = value.indexOf("=");
      const architecture = value.slice(0, separator);
      const filePath = value.slice(separator + 1);
      if (!ARCHITECTURES.includes(architecture) || !filePath) {
        throw new Error(`Invalid --asset value: ${value}`);
      }
      options.files.set(architecture, filePath);
      index += 1;
    } else if (
      ["--tag", "--output", "--changelog", "--published-at", "--repository"].includes(
        argument,
      )
    ) {
      if (!value) throw new Error(`Missing value for ${argument}.`);
      const key = {
        "--tag": "tag",
        "--output": "output",
        "--changelog": "changelog",
        "--published-at": "publishedAt",
        "--repository": "repository",
      }[argument];
      options[key] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.tag) throw new Error("--tag is required.");
  if (options.files.size === 0) throw new Error("At least one --asset is required.");
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const changelogSource = await readFile(options.changelog, "utf8");
  const notes = extractChineseNotes(changelogSource, options.tag);
  const manifest = await buildManifestFromLocalFiles({
    tag: options.tag,
    publishedAt: options.publishedAt,
    notes,
    files: options.files,
    repository: options.repository,
  });
  const outputPath = path.resolve(options.output);
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Generated ${outputPath} with ${manifest.assets.length} asset(s).`);
}

module.exports = {
  buildManifestFromLocalFiles,
  createUpdateManifest,
  createUpdateManifestFromGithubRelease,
  expectedAssetName,
  extractChineseNotes,
  parseArguments,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
