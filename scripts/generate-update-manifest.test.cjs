const assert = require("node:assert/strict");
const {
  createUpdateManifest,
  createUpdateManifestFromGithubRelease,
  extractChineseNotes,
  parseArguments,
} = require("./generate-update-manifest.cjs");

function testManifestContract() {
  const tag = "v0.1.4";
  const manifest = createUpdateManifest({
    tag,
    publishedAt: "2026-08-18T08:00:00+08:00",
    notes: ["新增静态更新清单", "修复 `API` 限流回退"],
    assets: [
      {
        name: `Haruha-${tag}-Windows-ARM64-Portable.exe`,
        architecture: "ARM64",
        sizeBytes: 20,
        sha256: "B".repeat(64),
        downloadUrl: `https://github.com/Xiongdaxz/Haruha/releases/download/${tag}/Haruha-${tag}-Windows-ARM64-Portable.exe`,
      },
      {
        name: `Haruha-${tag}-Windows-x64-Portable.exe`,
        architecture: "x64",
        sizeBytes: 10,
        sha256: "a".repeat(64),
        downloadUrl: `https://github.com/Xiongdaxz/Haruha/releases/download/${tag}/Haruha-${tag}-Windows-x64-Portable.exe`,
      },
    ],
  });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.version, "0.1.4");
  assert.equal(manifest.publishedAt, "2026-08-18T00:00:00.000Z");
  assert.deepEqual(manifest.notes, ["新增静态更新清单", "修复 API 限流回退"]);
  assert.deepEqual(
    manifest.assets.map(({ architecture }) => architecture),
    ["x64", "ARM64"],
  );
  assert.equal(manifest.assets[1].sha256, "b".repeat(64));
  assert.equal(manifest.assets[0].installKind, "portable");
}

function testGithubReleaseMetadataConversion() {
  const tag = "v0.1.4";
  const name = `Haruha-${tag}-Windows-x64-Portable.exe`;
  const manifest = createUpdateManifestFromGithubRelease({
    release: {
      tag_name: tag,
      published_at: "2026-08-18T08:00:00Z",
    },
    releaseAssets: [
      {
        name,
        size: 1234,
        digest: `sha256:${"c".repeat(64)}`,
        browser_download_url: `https://github.com/Xiongdaxz/Haruha/releases/download/${tag}/${name}`,
      },
      { name: "update.json", size: 10 },
    ],
    notes: ["GitHub 元数据生成"],
  });

  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0].sha256, "c".repeat(64));
  assert.equal(manifest.assets[0].sizeBytes, 1234);
}

function testChangelogExtraction() {
  const changelog = `# Changelog

## 0.1.4 - 2026-08-18

### 中文

- 第一项
- 修复 \`portable\` 更新

### English

- First
- Fix portable update

## 0.1.3 - 2026-08-17
`;
  assert.deepEqual(extractChineseNotes(changelog, "v0.1.4"), [
    "第一项",
    "修复 portable 更新",
  ]);
}

function testCliArgumentsAndRejections() {
  const options = parseArguments([
    "--tag",
    "v0.1.4",
    "--asset",
    "x64=C:\\build\\Haruha.exe",
    "--output",
    "dist/update.json",
  ]);
  assert.equal(options.files.get("x64"), "C:\\build\\Haruha.exe");
  assert.equal(options.output, "dist/update.json");
  assert.throws(
    () =>
      createUpdateManifest({
        tag: "v0.1.4-beta.1",
        publishedAt: "2026-08-18T00:00:00Z",
        notes: ["预发布"],
        assets: [],
      }),
    /Invalid stable release tag/,
  );
}

testManifestContract();
testGithubReleaseMetadataConversion();
testChangelogExtraction();
testCliArgumentsAndRejections();
console.log("Update manifest generator tests passed.");
