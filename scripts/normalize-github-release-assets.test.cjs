const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const normalizeRelease = require("./normalize-github-release-assets.cjs");

async function testBilingualReleaseNotes() {
  const changelogSource = await readFile("CHANGELOG.md", "utf8");
  const entries = normalizeRelease.extractChangelogEntries(
    changelogSource,
    "v0.1.2",
  );
  const body = normalizeRelease.createReleaseBody(
    "v0.1.2",
    changelogSource,
  );

  assert.equal(entries.chinese.length, 3);
  assert.equal(entries.english.length, 3);
  assert.match(body, /### 中文/);
  assert.match(body, /### English/);
  assert.match(body, /#### 更新内容/);
  assert.match(body, /#### What's changed/);
  assert.match(body, /Haruha-v0\.1\.2-Windows-x64-Portable\.exe/);
  assert.match(body, /Haruha-v0\.1\.2-Linux-ARM64\.rpm/);
  assert.doesNotMatch(body, /\b(?:0[1-9]|1[0-4])-Haruha-/);
  assert.match(body, /默认未签名/);
  assert.match(body, /unsigned by default/);
  assert.match(body, /update\.json.*不是安装包/);
  assert.match(body, /update\.json.*not an installer/);
}

async function testAutomaticLatestPublication() {
  const tag = "v0.1.2";
  const definitions = normalizeRelease.buildAssetDefinitions(tag);
  const release = {
    id: 12,
    draft: true,
    tag_name: tag,
    created_at: "2026-08-18T08:00:00Z",
  };
  const assets = definitions.map(({ sources }, index) => ({
    id: index + 100,
    name: sources[0],
    size: index + 1000,
    digest: `sha256:${String(index).padStart(64, "0")}`,
    browser_download_url: `https://github.com/Xiongdaxz/Haruha/releases/download/${tag}/${sources[0]}`,
  }));
  const renamed = [];
  let uploadedManifest;
  let updateReleaseInput;

  const repos = {
    listReleases() {},
    listReleaseAssets() {},
    async updateReleaseAsset(input) {
      renamed.push(input);
      const asset = assets.find(({ id }) => id === input.asset_id);
      asset.name = input.name;
      asset.browser_download_url = `https://github.com/Xiongdaxz/Haruha/releases/download/${tag}/${input.name}`;
    },
    async uploadReleaseAsset(input) {
      uploadedManifest = input;
    },
    async updateRelease(input) {
      updateReleaseInput = input;
    },
  };
  const github = {
    rest: { repos },
    async paginate(method) {
      return method === repos.listReleases ? [release] : assets;
    },
  };

  process.env.RELEASE_TAG = tag;
  await normalizeRelease({
    github,
    context: { repo: { owner: "Xiongdaxz", repo: "Haruha" } },
    core: { info() {} },
  });

  assert.equal(renamed.length, 12);
  assert.equal(updateReleaseInput.release_id, release.id);
  assert.equal(updateReleaseInput.draft, false);
  assert.equal(updateReleaseInput.prerelease, false);
  assert.equal(updateReleaseInput.make_latest, "true");
  assert.match(updateReleaseInput.body, /Haruha v0\.1\.2/);
  assert.equal(uploadedManifest.name, "update.json");
  assert.equal(uploadedManifest.headers["content-type"], "application/json");
  const manifest = JSON.parse(uploadedManifest.data.toString("utf8"));
  assert.deepEqual(
    manifest.assets.map(({ architecture }) => architecture),
    ["x64", "ARM64"],
  );
}

function testLegacyNumberedAssetRenames() {
  const tag = "v0.1.2";
  const definitions = normalizeRelease.buildAssetDefinitions(tag);
  const legacyNames = definitions.map(
    ({ sources }) => sources[sources.length - 1],
  );
  const plan = normalizeRelease.planAssetRenames(
    tag,
    [...legacyNames, "update.json"],
    ["update.json"],
  );

  assert.equal(plan.missing.length, 0);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.unexpected.length, 0);
  assert.equal(plan.renames.length, 14);
  assert.ok(plan.renames.every(({ target }) => !/^\d{2}-/.test(target)));
}

async function main() {
  await testBilingualReleaseNotes();
  await testAutomaticLatestPublication();
  testLegacyNumberedAssetRenames();
  console.log("Release automation tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
