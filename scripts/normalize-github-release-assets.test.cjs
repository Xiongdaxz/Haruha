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
  assert.match(body, /01-Haruha-v0\.1\.2-Windows-x64-Portable\.exe/);
  assert.match(body, /14-Haruha-v0\.1\.2-Linux-ARM64\.rpm/);
  assert.match(body, /默认未签名/);
  assert.match(body, /unsigned by default/);
}

async function testAutomaticLatestPublication() {
  const tag = "v0.1.2";
  const definitions = normalizeRelease.buildAssetDefinitions(tag);
  const release = { id: 12, draft: true, tag_name: tag };
  const assets = definitions.map(({ source }, index) => ({
    id: index + 100,
    name: source,
  }));
  const renamed = [];
  let updateReleaseInput;

  const repos = {
    listReleases() {},
    listReleaseAssets() {},
    async updateReleaseAsset(input) {
      renamed.push(input);
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
}

async function main() {
  await testBilingualReleaseNotes();
  await testAutomaticLatestPublication();
  console.log("Release automation tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
