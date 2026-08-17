const { readFile } = require("node:fs/promises");

const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function buildAssetDefinitions(tag) {
  if (!TAG_PATTERN.test(tag)) {
    throw new Error("Invalid release tag: " + tag);
  }

  const version = tag.slice(1);
  const prefix = "Haruha-" + tag + "-";

  return [
    {
      source: "01-" + prefix + "Windows-x64-Portable.exe",
      target: "01-" + prefix + "Windows-x64-Portable.exe",
    },
    {
      source: "Haruha_" + version + "_x64-setup.exe",
      target: "02-" + prefix + "Windows-x64-NSIS-Setup.exe",
    },
    {
      source: "Haruha_" + version + "_x64_zh-CN.msi",
      target: "03-" + prefix + "Windows-x64-MSI-zh-CN.msi",
    },
    {
      source: "04-" + prefix + "Windows-ARM64-Portable.exe",
      target: "04-" + prefix + "Windows-ARM64-Portable.exe",
    },
    {
      source: "Haruha_" + version + "_arm64-setup.exe",
      target: "05-" + prefix + "Windows-ARM64-NSIS-Setup.exe",
    },
    {
      source: "Haruha_" + version + "_arm64_zh-CN.msi",
      target: "06-" + prefix + "Windows-ARM64-MSI-zh-CN.msi",
    },
    {
      source: "Haruha_" + version + "_universal.dmg",
      target: "07-" + prefix + "macOS-Universal.dmg",
    },
    {
      source: "Haruha_universal.app.tar.gz",
      target: "08-" + prefix + "macOS-Universal-App.tar.gz",
    },
    {
      source: "Haruha_" + version + "_amd64.AppImage",
      target: "09-" + prefix + "Linux-x64.AppImage",
    },
    {
      source: "Haruha_" + version + "_amd64.deb",
      target: "10-" + prefix + "Linux-x64.deb",
    },
    {
      source: "Haruha-" + version + "-1.x86_64.rpm",
      target: "11-" + prefix + "Linux-x64.rpm",
    },
    {
      source: "Haruha_" + version + "_aarch64.AppImage",
      target: "12-" + prefix + "Linux-ARM64.AppImage",
    },
    {
      source: "Haruha_" + version + "_arm64.deb",
      target: "13-" + prefix + "Linux-ARM64.deb",
    },
    {
      source: "Haruha-" + version + "-1.aarch64.rpm",
      target: "14-" + prefix + "Linux-ARM64.rpm",
    },
  ];
}

function planAssetRenames(tag, assetNames) {
  const definitions = buildAssetDefinitions(tag);
  const names = new Set(assetNames);
  const knownNames = new Set(
    definitions.flatMap(({ source, target }) => [source, target]),
  );
  const renames = [];
  const missing = [];
  const conflicts = [];

  for (const definition of definitions) {
    const hasSource = names.has(definition.source);
    const hasTarget = names.has(definition.target);

    if (definition.source === definition.target) {
      if (!hasTarget) {
        missing.push(definition);
      }
    } else if (hasSource && hasTarget) {
      conflicts.push(definition);
    } else if (hasSource) {
      renames.push(definition);
    } else if (!hasTarget) {
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
    "Haruha " + tag + " 已完成自动构建并公开发布。资产按 Windows、macOS、Linux 和架构固定排序，文件名已明确标注平台与安装包格式。",
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
    "- 自动构建成功不代表对应平台的系统代理行为已经完成正式验证。",
    "",
    "### English",
    "",
    "Haruha " + tag + " has completed automated builds and is now publicly available. Assets use a stable Windows, macOS, and Linux order, with platform, architecture, and package format stated explicitly in every filename.",
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
    "- A successful automated build does not mean system-proxy behavior has been formally validated on that platform.",
  ].join("\n");
}

async function normalizeGithubReleaseAssets({ github, context, core }) {
  const tag = process.env.RELEASE_TAG;
  const changelogSource = await readFile("CHANGELOG.md", "utf8");
  const releases = await github.paginate(github.rest.repos.listReleases, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    per_page: 100,
  });
  const release = releases.find(
    (candidate) => candidate.draft && candidate.tag_name === tag,
  );

  if (!release) {
    throw new Error("Draft release not found for tag " + tag + ".");
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
      " assets for release " +
      tag +
      ".",
  );
}

module.exports = normalizeGithubReleaseAssets;
module.exports.buildAssetDefinitions = buildAssetDefinitions;
module.exports.planAssetRenames = planAssetRenames;
module.exports.extractChangelogEntries = extractChangelogEntries;
module.exports.createReleaseBody = createReleaseBody;
