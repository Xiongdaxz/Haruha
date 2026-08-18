const { readFile } = require("node:fs/promises");
const {
  createUpdateManifestFromGithubRelease,
  extractChineseNotes,
} = require("./generate-update-manifest.cjs");

const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const UPDATE_MANIFEST_NAME = "update.json";

function buildAssetDefinitions(tag) {
  if (!TAG_PATTERN.test(tag)) {
    throw new Error("Invalid release tag: " + tag);
  }

  const version = tag.slice(1);
  const prefix = "Haruha-" + tag + "-";

  return [
    {
      sources: [
        prefix + "Windows-x64-Portable.exe",
        "01-" + prefix + "Windows-x64-Portable.exe",
      ],
      target: prefix + "Windows-x64-Portable.exe",
    },
    {
      sources: [
        "Haruha_" + version + "_x64-setup.exe",
        "02-" + prefix + "Windows-x64-NSIS-Setup.exe",
      ],
      target: prefix + "Windows-x64-NSIS-Setup.exe",
    },
    {
      sources: [
        "Haruha_" + version + "_x64_zh-CN.msi",
        "03-" + prefix + "Windows-x64-MSI-zh-CN.msi",
      ],
      target: prefix + "Windows-x64-MSI-zh-CN.msi",
    },
    {
      sources: [
        prefix + "Windows-ARM64-Portable.exe",
        "04-" + prefix + "Windows-ARM64-Portable.exe",
      ],
      target: prefix + "Windows-ARM64-Portable.exe",
    },
    {
      sources: [
        "Haruha_" + version + "_arm64-setup.exe",
        "05-" + prefix + "Windows-ARM64-NSIS-Setup.exe",
      ],
      target: prefix + "Windows-ARM64-NSIS-Setup.exe",
    },
    {
      sources: [
        "Haruha_" + version + "_arm64_zh-CN.msi",
        "06-" + prefix + "Windows-ARM64-MSI-zh-CN.msi",
      ],
      target: prefix + "Windows-ARM64-MSI-zh-CN.msi",
    },
    {
      sources: [
        "Haruha_" + version + "_universal.dmg",
        "07-" + prefix + "macOS-Universal.dmg",
      ],
      target: prefix + "macOS-Universal.dmg",
    },
    {
      sources: [
        "Haruha_universal.app.tar.gz",
        "08-" + prefix + "macOS-Universal-App.tar.gz",
      ],
      target: prefix + "macOS-Universal-App.tar.gz",
    },
    {
      sources: [
        "Haruha_" + version + "_amd64.AppImage",
        "09-" + prefix + "Linux-x64.AppImage",
      ],
      target: prefix + "Linux-x64.AppImage",
    },
    {
      sources: [
        "Haruha_" + version + "_amd64.deb",
        "10-" + prefix + "Linux-x64.deb",
      ],
      target: prefix + "Linux-x64.deb",
    },
    {
      sources: [
        "Haruha-" + version + "-1.x86_64.rpm",
        "11-" + prefix + "Linux-x64.rpm",
      ],
      target: prefix + "Linux-x64.rpm",
    },
    {
      sources: [
        "Haruha_" + version + "_aarch64.AppImage",
        "12-" + prefix + "Linux-ARM64.AppImage",
      ],
      target: prefix + "Linux-ARM64.AppImage",
    },
    {
      sources: [
        "Haruha_" + version + "_arm64.deb",
        "13-" + prefix + "Linux-ARM64.deb",
      ],
      target: prefix + "Linux-ARM64.deb",
    },
    {
      sources: [
        "Haruha-" + version + "-1.aarch64.rpm",
        "14-" + prefix + "Linux-ARM64.rpm",
      ],
      target: prefix + "Linux-ARM64.rpm",
    },
  ];
}

function planAssetRenames(tag, assetNames, allowedExtraNames = []) {
  const definitions = buildAssetDefinitions(tag);
  const names = new Set(assetNames);
  const knownNames = new Set(
    [
      ...definitions.flatMap(({ sources, target }) => [...sources, target]),
      ...allowedExtraNames,
    ],
  );
  const renames = [];
  const missing = [];
  const conflicts = [];

  for (const definition of definitions) {
    const hasTarget = names.has(definition.target);
    const presentSources = [
      ...new Set(
        definition.sources.filter(
          (source) => source !== definition.target && names.has(source),
        ),
      ),
    ];

    if (hasTarget && presentSources.length > 0) {
      conflicts.push(definition);
    } else if (hasTarget) {
      continue;
    } else if (presentSources.length === 1) {
      renames.push({ source: presentSources[0], target: definition.target });
    } else if (presentSources.length > 1) {
      conflicts.push(definition);
    } else {
      missing.push(definition);
    }
  }

  return {
    definitions,
    renames,
    missing,
    conflicts,
    unexpected: assetNames.filter((name) => !knownNames.has(name)),
  };
}

function code(filename) {
  return "<code>" + filename + "</code>";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractChangelogEntries(changelogSource, tag) {
  if (!TAG_PATTERN.test(tag)) {
    throw new Error("Invalid release tag: " + tag);
  }

  const normalizedSource = changelogSource.replace(/\r\n/g, "\n");
  const version = tag.slice(1);
  const headerPattern = new RegExp(
    "^##\\s+" + escapeRegExp(version) + "\\s+-\\s+\\d{4}-\\d{2}-\\d{2}\\s*$",
    "m",
  );
  const headerMatch = normalizedSource.match(headerPattern);
  if (!headerMatch || headerMatch.index === undefined) {
    throw new Error("Changelog section not found for " + tag + ".");
  }

  const afterHeader = normalizedSource.slice(
    headerMatch.index + headerMatch[0].length,
  );
  const nextVersionIndex = afterHeader.search(/^##\s+/m);
  const versionSection =
    nextVersionIndex >= 0 ? afterHeader.slice(0, nextVersionIndex) : afterHeader;

  function entriesFor(heading) {
    const headingPattern = new RegExp(
      "^###\\s+" + escapeRegExp(heading) + "\\s*$",
      "m",
    );
    const headingMatch = versionSection.match(headingPattern);
    if (!headingMatch || headingMatch.index === undefined) {
      throw new Error(
        "Changelog heading " + heading + " not found for " + tag + ".",
      );
    }

    const afterHeading = versionSection.slice(
      headingMatch.index + headingMatch[0].length,
    );
    const nextHeadingIndex = afterHeading.search(/^###\s+/m);
    const headingBody =
      nextHeadingIndex >= 0
        ? afterHeading.slice(0, nextHeadingIndex)
        : afterHeading;
    return headingBody
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2));
  }

  const chinese = entriesFor("中文");
  const english = entriesFor("English");
  if (chinese.length === 0 || chinese.length !== english.length) {
    throw new Error(
      "Changelog entries must be non-empty and paired for " +
        tag +
        ": Chinese=" +
        chinese.length +
        ", English=" +
        english.length +
        ".",
    );
  }

  return { chinese, english };
}

function createReleaseBody(tag, changelogSource) {
  const assets = buildAssetDefinitions(tag).map(({ target }) => target);
  const changelog = extractChangelogEntries(changelogSource, tag);

  return [
    "### 中文",
    "",
    "Haruha " + tag + " 已完成自动构建并公开发布。资产按平台与架构分组，文件名不使用序号前缀，并明确标注平台、架构与安装包格式。",
    "",
    "#### 更新内容",
    "",
    ...changelog.chinese.map((entry) => "- " + entry),
    "",
    "#### 下载说明",
    "",
    "| 平台 | 架构 | 推荐下载 | 其他格式 |",
    "| --- | --- | --- | --- |",
    "| Windows | x64（Intel / AMD） | " + code(assets[0]) + "（免安装） | " + code(assets[1]) + "<br>" + code(assets[2]) + " |",
    "| Windows | ARM64 | " + code(assets[3]) + "（免安装） | " + code(assets[4]) + "<br>" + code(assets[5]) + " |",
    "| macOS | Universal（Intel + Apple Silicon） | " + code(assets[6]) + " | " + code(assets[7]) + " |",
    "| Linux | x64 | " + code(assets[8]) + " | " + code(assets[9]) + "<br>" + code(assets[10]) + " |",
    "| Linux | ARM64 | " + code(assets[11]) + " | " + code(assets[12]) + "<br>" + code(assets[13]) + " |",
    "",
    "- Windows、macOS 和 Linux 资产默认未签名。",
    "- GitHub 会在每个资产旁显示 SHA-256 摘要。",
    "- `update.json` 是应用内更新元数据，不是安装包。",
    "- 自动构建成功不代表对应平台的系统代理行为已经完成正式验证。",
    "",
    "### English",
    "",
    "Haruha " + tag + " has completed automated builds and is now publicly available. Assets are grouped by platform and architecture without numeric filename prefixes, with platform, architecture, and package format stated explicitly in every filename.",
    "",
    "#### What's changed",
    "",
    ...changelog.english.map((entry) => "- " + entry),
    "",
    "#### Downloads",
    "",
    "| Platform | Architecture | Recommended | Alternative |",
    "| --- | --- | --- | --- |",
    "| Windows | x64 (Intel / AMD) | " + code(assets[0]) + " (portable) | " + code(assets[1]) + "<br>" + code(assets[2]) + " |",
    "| Windows | ARM64 | " + code(assets[3]) + " (portable) | " + code(assets[4]) + "<br>" + code(assets[5]) + " |",
    "| macOS | Universal (Intel + Apple Silicon) | " + code(assets[6]) + " | " + code(assets[7]) + " |",
    "| Linux | x64 | " + code(assets[8]) + " | " + code(assets[9]) + "<br>" + code(assets[10]) + " |",
    "| Linux | ARM64 | " + code(assets[11]) + " | " + code(assets[12]) + "<br>" + code(assets[13]) + " |",
    "",
    "- Windows, macOS, and Linux assets are unsigned by default.",
    "- GitHub displays a SHA-256 digest next to every asset.",
    "- `update.json` contains in-app update metadata and is not an installer.",
    "- A successful automated build does not mean system-proxy behavior has been formally validated on that platform.",
  ].join("\n");
}

function createUpdateManifestAsset({
  tag,
  changelogSource,
  release,
  releaseAssets,
  repository,
}) {
  const manifest = createUpdateManifestFromGithubRelease({
    release: {
      ...release,
      tag_name: tag,
      published_at:
        release.published_at || release.created_at || new Date().toISOString(),
    },
    releaseAssets,
    notes: extractChineseNotes(changelogSource, tag),
    repository,
  });
  if (manifest.assets.length !== 2) {
    throw new Error(
      "Update manifest requires both Windows portable assets; found " +
        manifest.assets.length +
        ".",
    );
  }
  return {
    name: UPDATE_MANIFEST_NAME,
    data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"),
    manifest,
  };
}

async function normalizeGithubReleaseAssets({ github, context, core }) {
  const tag = process.env.RELEASE_TAG;
  const changelogSource = await readFile("CHANGELOG.md", "utf8");
  const releases = await github.paginate(github.rest.repos.listReleases, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    per_page: 100,
  });
  const release = releases.find((candidate) => candidate.tag_name === tag);

  if (!release) {
    if (process.env.ALLOW_MISSING_RELEASE === "true") {
      core.info("Release not found for " + tag + "; nothing to refresh.");
      return;
    }
    throw new Error("Release not found for tag " + tag + ".");
  }

  const releaseAssets = await github.paginate(
    github.rest.repos.listReleaseAssets,
    {
      owner: context.repo.owner,
      repo: context.repo.repo,
      release_id: release.id,
      per_page: 100,
    },
  );
  const plan = planAssetRenames(
    tag,
    releaseAssets.map(({ name }) => name),
    [UPDATE_MANIFEST_NAME],
  );

  if (
    plan.missing.length > 0 ||
    plan.conflicts.length > 0 ||
    plan.unexpected.length > 0
  ) {
    throw new Error(
      "Release asset set does not match the expected plan:\n" +
        JSON.stringify(
          {
            missing: plan.missing,
            conflicts: plan.conflicts,
            unexpected: plan.unexpected,
          },
          null,
          2,
        ),
    );
  }

  for (const { source, target } of plan.renames) {
    const asset = releaseAssets.find((candidate) => candidate.name === source);
    await github.rest.repos.updateReleaseAsset({
      owner: context.repo.owner,
      repo: context.repo.repo,
      asset_id: asset.id,
      name: target,
    });
    core.info("Renamed " + source + " -> " + target);
  }

  const existingManifest = releaseAssets.find(
    ({ name }) => name === UPDATE_MANIFEST_NAME,
  );
  if (existingManifest) {
    await github.rest.repos.deleteReleaseAsset({
      owner: context.repo.owner,
      repo: context.repo.repo,
      asset_id: existingManifest.id,
    });
    core.info("Removed existing " + UPDATE_MANIFEST_NAME + ".");
  }

  const normalizedReleaseAssets = await github.paginate(
    github.rest.repos.listReleaseAssets,
    {
      owner: context.repo.owner,
      repo: context.repo.repo,
      release_id: release.id,
      per_page: 100,
    },
  );
  const updateManifest = createUpdateManifestAsset({
    tag,
    changelogSource,
    release,
    releaseAssets: normalizedReleaseAssets,
    repository: context.repo.owner + "/" + context.repo.repo,
  });
  await github.rest.repos.uploadReleaseAsset({
    owner: context.repo.owner,
    repo: context.repo.repo,
    release_id: release.id,
    name: updateManifest.name,
    data: updateManifest.data,
    headers: {
      "content-type": "application/json",
      "content-length": updateManifest.data.length,
    },
  });
  core.info(
    "Uploaded " +
      UPDATE_MANIFEST_NAME +
      " with " +
      updateManifest.manifest.assets.length +
      " Windows portable assets.",
  );

  await github.rest.repos.updateRelease({
    owner: context.repo.owner,
    repo: context.repo.repo,
    release_id: release.id,
    tag_name: tag,
    name: "Haruha " + tag,
    body: createReleaseBody(tag, changelogSource),
    draft: false,
    prerelease: false,
    make_latest: "true",
  });

  core.info(
    "Normalized and published " +
      plan.definitions.length +
      " binary assets plus " +
      UPDATE_MANIFEST_NAME +
      " for release " +
      tag +
      ".",
  );
}

module.exports = normalizeGithubReleaseAssets;
module.exports.buildAssetDefinitions = buildAssetDefinitions;
module.exports.planAssetRenames = planAssetRenames;
module.exports.extractChangelogEntries = extractChangelogEntries;
module.exports.createReleaseBody = createReleaseBody;
module.exports.createUpdateManifestAsset = createUpdateManifestAsset;
