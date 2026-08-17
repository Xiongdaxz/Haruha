import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  appendAppLog,
  defaultProfile,
  defaultSpeedTestConfig,
  disableProxy,
  enableManual,
  defaultUnifiedLists,
  enablePac,
  getConfigDirectory,
  getActiveProfile,
  getProxyState,
  getQuickSiteIcon,
  getUnifiedLists,
  listenProxyStateChanged,
  openConfigDirectory,
  openExternalUrl,
  openGoogle,
  refreshDirectIpInfo,
  refreshIpInfo,
  runNetworkSpeedTest,
  saveConfiguration,
  saveProfile,
  saveUnifiedLists,
  testProxy,
} from "../lib/api";
import type {
  AppLogLevel,
  DirectIpInfo,
  IpInfo,
  PacRule,
  ProxyMode,
  ProxyProfile,
  ProxyState,
  QuickSite,
  QuickSiteCategory,
  SpeedTestHistoryEntry,
  SpeedTestProgress,
  SpeedTestResult,
  SpeedTestTarget,
  UnifiedLists,
} from "../lib/types";
import { normalizeUnifiedRuleInput } from "../lib/rules";
import { ruleTypeLabel } from "../lib/format";
import { OverviewPage } from "../pages/OverviewPage";
import { PacPage } from "../pages/PacPage";
import { ProxyConfigPage } from "../pages/ProxyConfigPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SplitResizer } from "../components/layout/SplitResizer";
import { Sidebar } from "../components/layout/Sidebar";
import { TopBar } from "../components/layout/TopBar";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { TrafficMonitorProvider } from "../components/data/TrafficMonitorProvider";
import { useSpeedTestConfig } from "../hooks/useSpeedTestConfig";
import { useSpeedTestHistory } from "../hooks/useSpeedTestHistory";
import { useSplitLayout } from "../hooks/useSplitLayout";
import { useThemePreference } from "../hooks/useThemePreference";
import { useToast } from "../hooks/useToast";
import {
  DEFAULT_PAC_URL,
  OPEN_SOURCE_REPOSITORY_URL,
  quickSiteCategories,
  quickSites,
} from "./constants";
import type { NavKey, PacRuleTab, RuleListSortField, RuleListSortState, SettingsKey } from "./types";

interface QueuedModeChange {
  id: number;
  mode: ProxyMode;
  profile: ProxyProfile;
  fallbackState: ProxyState;
}

interface PendingUnifiedListsSave {
  lists: UnifiedLists;
  revision: number;
}

function unifiedRuleKey(value: string) {
  return value.trim().toLowerCase();
}

function pacRuleId(strategy: PacRule["strategy"], domain: string) {
  return `${strategy}:${unifiedRuleKey(domain)}`;
}

function buildPacRules(lists: UnifiedLists): PacRule[] {
  const disabledProxy = new Set(lists.disabledProxyDomains.map(unifiedRuleKey));
  const disabledDirect = new Set(lists.disabledDirectDomains.map(unifiedRuleKey));
  return [
    ...lists.proxyDomains.map((domain) => ({
      id: pacRuleId("proxy", domain),
      domain,
      strategy: "proxy" as const,
      enabled: !disabledProxy.has(unifiedRuleKey(domain)),
    })),
    ...lists.directDomains.map((domain) => ({
      id: pacRuleId("direct", domain),
      domain,
      strategy: "direct" as const,
      enabled: !disabledDirect.has(unifiedRuleKey(domain)),
    })),
  ];
}

function ruleOrdersMatch(left: string[], right: string[]) {
  return left.length === right.length && left.every((rule, index) => unifiedRuleKey(rule) === unifiedRuleKey(right[index]));
}

function restoreRuleOrder(baseline: string[], current: string[]) {
  const currentByKey = new Map(current.map((rule) => [unifiedRuleKey(rule), rule]));
  const restored: string[] = [];
  const restoredKeys = new Set<string>();

  for (const rule of baseline) {
    const key = unifiedRuleKey(rule);
    const currentRule = currentByKey.get(key);
    if (!currentRule || restoredKeys.has(key)) continue;
    restored.push(currentRule);
    restoredKeys.add(key);
  }
  for (const rule of current) {
    const key = unifiedRuleKey(rule);
    if (restoredKeys.has(key)) continue;
    restored.push(rule);
    restoredKeys.add(key);
  }
  return restored;
}

const domainRuleCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

export function HaruhaApp() {
  const [activeNav, setActiveNav] = useState<NavKey>("overview");
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSettings, setActiveSettings] = useState<SettingsKey>("appearance");
  const [isPacResetConfirmOpen, setPacResetConfirmOpen] = useState(false);
  const [isConfigResetConfirmOpen, setConfigResetConfirmOpen] = useState(false);
  const [configDirectoryPath, setConfigDirectoryPath] = useState("");
  const [profile, setProfile] = useState<ProxyProfile>(defaultProfile);
  const [state, setState] = useState<ProxyState | null>(null);
  const [unifiedLists, setUnifiedLists] = useState<UnifiedLists>(defaultUnifiedLists);
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(new Set());
  const [selectedBypassItems, setSelectedBypassItems] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [bypassQuery, setBypassQuery] = useState("");
  const [activePacTab, setActivePacTab] = useState<PacRuleTab>("proxy");
  const [ruleListSortState, setRuleListSortState] = useState<Record<PacRuleTab, RuleListSortState | null>>({
    direct: null,
    proxy: null,
  });
  const ruleListSortBaselineRef = useRef<Record<PacRuleTab, string[] | null>>({
    direct: null,
    proxy: null,
  });
  const unifiedListsRef = useRef<UnifiedLists>(defaultUnifiedLists);
  const confirmedUnifiedListsRef = useRef<UnifiedLists>(defaultUnifiedLists);
  const unifiedListsRevisionRef = useRef(0);
  const pendingUnifiedListsSaveRef = useRef<PendingUnifiedListsSave | null>(null);
  const unifiedListsSaveRunningRef = useRef(false);
  const configurationResetRunningRef = useRef(false);
  const [activeSiteCategory, setActiveSiteCategory] = useState<QuickSiteCategory>("ai");
  const [failedSiteIcons, setFailedSiteIcons] = useState<Set<string>>(new Set());
  const [quickSiteIconUrls, setQuickSiteIconUrls] = useState<Record<string, string>>({});
  const [quickSiteIconRetryTick, setQuickSiteIconRetryTick] = useState(0);
  const [speedTestResults, setSpeedTestResults] = useState<Partial<Record<SpeedTestTarget, SpeedTestResult>>>({});
  const [speedTestProgress, setSpeedTestProgress] = useState<Partial<Record<SpeedTestTarget, SpeedTestProgress>>>({});
  const [speedTestRunningTarget, setSpeedTestRunningTarget] = useState<SpeedTestTarget | null>(null);
  const [isSpeedSettingsOpen, setSpeedSettingsOpen] = useState(false);
  const [directIp, setDirectIp] = useState<DirectIpInfo>({});
  const [proxyIp, setProxyIp] = useState<IpInfo | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<ProxyMode | null>(null);
  const [hasModeInteraction, setHasModeInteraction] = useState(false);
  const hasBootstrappedRef = useRef(false);
  const quickSiteIconAttemptsRef = useRef<Record<string, number>>({});
  const queuedModeChangeRef = useRef<QueuedModeChange | null>(null);
  const modeChangeRunningRef = useRef(false);
  const modeChangeRequestIdRef = useRef(0);
  const confirmedProxyStateRef = useRef<ProxyState | null>(null);
  const speedTestRunningRef = useRef(false);
  const speedTestActiveTargetRef = useRef<SpeedTestTarget | null>(null);
  const pendingSpeedTestTargetRef = useRef<SpeedTestTarget | null>(null);
  const [, startNavigationTransition] = useTransition();
  const { showToast, toastMessage } = useToast();
  const { activeThemeIndex, resolvedTheme, resolvedThemeLabel, setThemePreference, themePreference } = useThemePreference();
  const { setSpeedTestConfig, speedTestConfig, updateSpeedTestConfig } = useSpeedTestConfig();
  const { addSpeedTestHistory, speedTestHistory } = useSpeedTestHistory();
  const { contentStyle, splitView, startSplitResize } = useSplitLayout(activeNav);

  useEffect(() => {
    unifiedListsRef.current = unifiedLists;
  }, [unifiedLists]);

  useEffect(() => {
    if (hasBootstrappedRef.current) return;
    hasBootstrappedRef.current = true;

    async function bootstrap() {
      setBusyAction("bootstrap");
      try {
        const [loadedProfile, currentState, loadedUnified, loadedConfigDirectory] = await Promise.all([
          getActiveProfile(),
          getProxyState(),
          getUnifiedLists(),
          getConfigDirectory(),
        ]);
        setProfile(loadedProfile);
        setState(currentState);
        confirmedProxyStateRef.current = currentState;
        setUnifiedLists(loadedUnified);
        unifiedListsRef.current = loadedUnified;
        confirmedUnifiedListsRef.current = loadedUnified;
        setConfigDirectoryPath(loadedConfigDirectory);
        appendLog("DEBUG", "配置加载完成");
      } catch (error) {
        appendLog("ERROR", error instanceof Error ? error.message : String(error));
      } finally {
        setBusyAction(null);
        void refreshAllIps();
      }
    }

    void bootstrap();
  }, []);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void listenProxyStateChanged((nextState) => {
      confirmedProxyStateRef.current = nextState;
      if (modeChangeRunningRef.current || queuedModeChangeRef.current) return;

      setState(nextState);
      setProfile((current) => ({ ...current, mode: nextState.mode }));
      setPendingMode(null);
      if (nextState.mode === "off") {
        setProxyIp(null);
        return;
      }
      void refreshIpInfo(true)
        .then(setProxyIp)
        .catch((error) => appendLog("WARN", `托盘切换后代理IP刷新失败：${error instanceof Error ? error.message : String(error)}`));
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!isSpeedSettingsOpen) return;

    function closeSpeedSettingsOnOutsideClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(".speed-settings-popover, .speed-settings-toggle")) return;
      setSpeedSettingsOpen(false);
    }

    document.addEventListener("click", closeSpeedSettingsOnOutsideClick);
    return () => document.removeEventListener("click", closeSpeedSettingsOnOutsideClick);
  }, [isSpeedSettingsOpen]);

  const disabledDirectRuleKeys = useMemo(
    () => new Set(unifiedLists.disabledDirectDomains.map(unifiedRuleKey)),
    [unifiedLists.disabledDirectDomains],
  );

  const pacRules = useMemo<PacRule[]>(() => buildPacRules(unifiedLists), [unifiedLists]);

  const filteredRules = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return pacRules.filter(
      (rule) =>
        rule.strategy === activePacTab &&
        (!keyword ||
          rule.domain.toLowerCase().includes(keyword) ||
          ruleTypeLabel(rule.domain).toLowerCase().includes(keyword)),
    );
  }, [activePacTab, pacRules, query]);

  const filteredBypassItems = useMemo(() => {
    const keyword = bypassQuery.trim().toLowerCase();
    return unifiedLists.directDomains.filter((item) => !keyword || item.toLowerCase().includes(keyword));
  }, [bypassQuery, unifiedLists.directDomains]);

  const filteredQuickSites = useMemo(
    () => quickSites.filter((site) => site.category === activeSiteCategory),
    [activeSiteCategory],
  );

  useEffect(() => {
    const missingSites = filteredQuickSites.filter(
      (site) => !quickSiteIconUrls[site.id] && (quickSiteIconAttemptsRef.current[site.id] ?? 0) < 2,
    );
    if (missingSites.length === 0) return;

    let disposed = false;
    missingSites.forEach((site) => {
      quickSiteIconAttemptsRef.current[site.id] = (quickSiteIconAttemptsRef.current[site.id] ?? 0) + 1;
    });
    void Promise.all(
      missingSites.map(async (site) => {
        try {
          const iconUrl = await getQuickSiteIcon(site.id, site.domain, site.faviconUrl);
          return [site.id, iconUrl] as const;
        } catch (error) {
          appendLog(
            "WARN",
            `快捷网站图标缓存失败，改用在线图标：${site.domain}（${error instanceof Error ? error.message : String(error)}）`,
          );
          return [site.id, site.faviconUrl] as const;
        }
      }),
    ).then((entries) => {
      if (disposed) return;
      const successfulEntries = entries.filter(([, iconUrl]) => Boolean(iconUrl));
      if (successfulEntries.length > 0) {
        setQuickSiteIconUrls((current) => {
          const next = { ...current };
          for (const [siteId, iconUrl] of successfulEntries) {
            next[siteId] = iconUrl;
          }
          return next;
        });
        setFailedSiteIcons((current) => {
          const next = new Set(current);
          successfulEntries.forEach(([siteId]) => next.delete(siteId));
          return next;
        });
      }
      const failedIds = entries.filter(([, iconUrl]) => !iconUrl).map(([siteId]) => siteId);
      if (failedIds.length > 0) {
        setFailedSiteIcons((current) => {
          const next = new Set(current);
          failedIds.forEach((siteId) => next.add(siteId));
          return next;
        });
        if (failedIds.some((siteId) => (quickSiteIconAttemptsRef.current[siteId] ?? 0) < 2)) {
          setQuickSiteIconRetryTick((current) => current + 1);
        }
      }
    });

    return () => {
      disposed = true;
    };
  }, [filteredQuickSites, quickSiteIconRetryTick, quickSiteIconUrls]);

  const allFilteredSelected =
    filteredRules.length > 0 && filteredRules.every((rule) => selectedRuleIds.has(rule.id));
  const selectedVisibleRuleCount = filteredRules.filter((rule) => selectedRuleIds.has(rule.id)).length;
  const allFilteredBypassSelected =
    filteredBypassItems.length > 0 && filteredBypassItems.every((item) => selectedBypassItems.has(item));
  const selectedVisibleBypassCount = filteredBypassItems.filter((item) => selectedBypassItems.has(item)).length;
  const activeSiteCategoryIndex = Math.max(
    0,
    quickSiteCategories.findIndex((category) => category.key === activeSiteCategory),
  );

  const effectiveState = state ?? {
    mode: profile.mode,
    address: `${profile.host}:${profile.port}`,
    platform: "Windows / macOS / Linux",
    capabilities: {
      manualProxy: true,
      pacProxy: true,
      tray: true,
      globalShortcut: false,
      autoStart: false,
      requiresElevatedPermission: false,
      details: ["Windows", "macOS", "Linux", "系统代理写入"],
    },
  };

  const proxyRuleCount = unifiedLists.proxyEnabled
    ? pacRules.filter((rule) => rule.strategy === "proxy" && rule.enabled).length
    : 0;
  const directRuleCount = unifiedLists.directEnabled
    ? pacRules.filter((rule) => rule.strategy === "direct" && rule.enabled).length
    : 0;
  const disabledProxyRuleCount = pacRules.filter(
    (rule) => rule.strategy === "proxy" && (!rule.enabled || !unifiedLists.proxyEnabled),
  ).length;
  const disabledDirectRuleCount = pacRules.filter(
    (rule) => rule.strategy === "direct" && (!rule.enabled || !unifiedLists.directEnabled),
  ).length;
  const disabledRuleCount = disabledProxyRuleCount + disabledDirectRuleCount;
  const pacUrl = effectiveState.pacUrl ?? DEFAULT_PAC_URL;
  const overviewMode =
    effectiveState.mode === "pac" ? "PAC自动代理" : effectiveState.mode === "manual" ? "手动代理" : "代理已关闭";
  const isModePending = pendingMode !== null;

  const handleNavChange = useCallback(
    (nav: NavKey) => {
      if (nav === activeNav) return;
      startNavigationTransition(() => setActiveNav(nav));
    },
    [activeNav, startNavigationTransition],
  );

  function appendLog(level: AppLogLevel, message: string) {
    const now = new Date();
    const timestamp = now.toLocaleString("zh-CN", { hour12: false });
    void appendAppLog(level, message, timestamp).catch(() => undefined);
  }

  async function handleOpenConfigDirectory() {
    try {
      await openConfigDirectory();
      showToast("已打开配置目录");
      appendLog("INFO", "已打开配置目录");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast("打开配置目录失败");
      appendLog("ERROR", `打开配置目录失败：${message}`);
    }
  }

  async function runAction<T>(
    key: string,
    action: () => Promise<T>,
    success: (value: T) => void,
    logMessage: string,
    toast?: string,
  ) {
    setBusyAction(key);
    try {
      const value = await action();
      success(value);
      appendLog("INFO", logMessage);
      if (toast) {
        showToast(toast);
      }
    } catch (error) {
      appendLog("ERROR", error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function refreshAllIps() {
    setBusyAction("refresh-ip");
    try {
      const [direct, proxy] = await Promise.all([refreshDirectIpInfo(), refreshIpInfo(true)]);
      setDirectIp(direct);
      setProxyIp(proxy);
      appendLog("DEBUG", "IP信息刷新完成");
    } catch (error) {
      appendLog("ERROR", error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  function refreshConnectionState() {
    void runAction(
      "refresh-connection",
      getProxyState,
      (nextState) => {
        setState(nextState);
        setProfile((current) => ({ ...current, mode: nextState.mode }));
      },
      "连接状态已刷新",
      "连接状态已刷新",
    );
  }

  function refreshDirectIp() {
    void runAction("refresh-direct-ip", refreshDirectIpInfo, setDirectIp, "本机IPv4与IPv6出口已刷新", "本机IP已刷新");
  }

  function refreshProxyIp() {
    void runAction("refresh-proxy-ip", () => refreshIpInfo(true), setProxyIp, "代理出口IP已刷新", "代理IP已刷新");
  }

  function refreshPacSummary() {
    void runAction(
      "refresh-pac-summary",
      async () => {
        const [loadedProfile, loadedUnified] = await Promise.all([getActiveProfile(), getUnifiedLists()]);
        return { loadedProfile, loadedUnified };
      },
      ({ loadedProfile, loadedUnified }) => {
        setProfile(loadedProfile);
        setUnifiedLists(loadedUnified);
        unifiedListsRef.current = loadedUnified;
        confirmedUnifiedListsRef.current = loadedUnified;
      },
      "PAC规则统计已刷新",
      "PAC规则已刷新",
    );
  }

  function updateProfile<K extends keyof ProxyProfile>(key: K, value: ProxyProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function handleSavedProfile(savedProfile: ProxyProfile) {
    setProfile(savedProfile);
    setSelectedRuleIds(new Set());
    setSelectedBypassItems(new Set());
  }

  function saveCurrentProfile(actionKey = "save") {
    const mode = effectiveState.mode;
    const nextProfile = { ...profile, mode };
    if (mode === "pac") {
      void runAction(
        actionKey,
        () => enablePac({ ...nextProfile, mode: "pac" }),
        (nextState) => {
          setState(nextState);
          setProfile({ ...nextProfile, mode: "pac" });
        },
        "配置保存成功并已应用PAC",
        "配置已保存并应用PAC",
      );
      return;
    }
    if (mode === "manual") {
      void runAction(
        actionKey,
        () => enableManual({ ...nextProfile, mode: "manual" }),
        (nextState) => {
          setState(nextState);
          setProfile({ ...nextProfile, mode: "manual" });
        },
        "配置保存成功并已应用手动代理",
        "配置已保存并应用手动代理",
      );
      return;
    }

    void runAction(actionKey, () => saveProfile(nextProfile), handleSavedProfile, "配置保存成功", "配置保存成功");
  }

  function persistProfileChange(nextProfile: ProxyProfile, logMessage: string) {
    const mode = effectiveState.mode;
    const profileForMode = { ...nextProfile, mode };
    const action =
      mode === "pac"
        ? enablePac({ ...profileForMode, mode: "pac" })
        : mode === "manual"
          ? enableManual({ ...profileForMode, mode: "manual" })
          : saveProfile(profileForMode);

    void action
      .then((result) => {
        if ("platform" in result) {
          setState(result);
        }
        appendLog("INFO", logMessage);
      })
      .catch((error) => {
        appendLog("ERROR", error instanceof Error ? error.message : String(error));
      });
  }

  function openGooglePage() {
    void runAction("open-google", openGoogle, () => undefined, "已打开 Google", "已打开 Google");
  }

  function openSourceRepository() {
    void runAction(
      "open-source-repository",
      () => openExternalUrl(OPEN_SOURCE_REPOSITORY_URL),
      () => undefined,
      "已打开 GitHub 开源仓库",
      "已打开 GitHub 开源仓库",
    );
  }

  function openQuickSite(site: QuickSite) {
    void runAction(
      `open-site-${site.id}`,
      () => openExternalUrl(site.url),
      () => undefined,
      `已打开网站：${site.name}`,
      `已打开 ${site.name}`,
    );
  }

  function handleQuickSiteIconError(siteId: string) {
    setFailedSiteIcons((current) => new Set(current).add(siteId));
    setQuickSiteIconUrls((current) => {
      if (!current[siteId]) return current;
      const next = { ...current };
      delete next[siteId];
      return next;
    });
    if ((quickSiteIconAttemptsRef.current[siteId] ?? 0) < 2) {
      setQuickSiteIconRetryTick((current) => current + 1);
    }
  }

  function runSpeedTest(target: SpeedTestTarget) {
    if (speedTestRunningRef.current) {
      pendingSpeedTestTargetRef.current =
        speedTestActiveTargetRef.current === target ? null : target;
      return;
    }

    pendingSpeedTestTargetRef.current = null;
    speedTestRunningRef.current = true;
    speedTestActiveTargetRef.current = target;
    setSpeedTestRunningTarget(target);
    const targetLabel = target === "proxy" ? "代理测速" : "直连测速";
    setSpeedTestProgress((current) => ({
      ...current,
      [target]: {
        target,
        latencyMs: 0,
        downloadMbps: 0,
        downloadedBytes: 0,
        elapsedMs: 0,
      },
    }));
    void runNetworkSpeedTest(profile, speedTestConfig, target, (progress) => {
      setSpeedTestProgress((current) => ({ ...current, [target]: progress }));
    })
      .then((result) => {
        setSpeedTestResults((current) => ({ ...current, [target]: result }));
        addSpeedTestHistory(result, target);
        appendLog("INFO", `${targetLabel}完成`);
      })
      .catch((error) => {
        appendLog("ERROR", error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        speedTestRunningRef.current = false;
        speedTestActiveTargetRef.current = null;
        setSpeedTestRunningTarget(null);
        setSpeedTestProgress((current) => {
          if (!current[target]) return current;
          const next = { ...current };
          delete next[target];
          return next;
        });
        const pendingTarget = pendingSpeedTestTargetRef.current;
        pendingSpeedTestTargetRef.current = null;
        if (pendingTarget !== null) runSpeedTest(pendingTarget);
      });
  }

  function restoreSpeedTestConfig() {
    setSpeedTestConfig(defaultSpeedTestConfig);
    setSpeedTestResults({});
    setSpeedTestProgress({});
    showToast("测速配置已恢复默认");
  }

  async function waitForPaint() {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)));
  }

  async function waitForUnifiedListsSaveIdle() {
    while (unifiedListsSaveRunningRef.current) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
    }
  }

  async function waitForModeChangeIdle() {
    while (modeChangeRunningRef.current || queuedModeChangeRef.current !== null) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
    }
  }

  function optimisticStateForMode(mode: ProxyMode): ProxyState {
    return {
      ...effectiveState,
      mode,
      address: mode === "manual" ? `${profile.host}:${profile.port}` : mode === "off" ? undefined : effectiveState.address,
      pacUrl: mode === "pac" ? pacUrl : undefined,
    };
  }

  function setMode(mode: ProxyMode) {
    if (configurationResetRunningRef.current) return;
    if (mode === effectiveState.mode) return;

    setHasModeInteraction(true);
    modeChangeRequestIdRef.current += 1;
    const nextProfile = { ...profile, mode };
    queuedModeChangeRef.current = {
      id: modeChangeRequestIdRef.current,
      mode,
      profile: nextProfile,
      fallbackState: confirmedProxyStateRef.current ?? effectiveState,
    };

    setPendingMode(mode);
    setState(optimisticStateForMode(mode));
    setProfile(nextProfile);
    void processQueuedModeChanges();
  }

  async function processQueuedModeChanges() {
    if (modeChangeRunningRef.current) return;
    modeChangeRunningRef.current = true;

    try {
      while (queuedModeChangeRef.current) {
        const request = queuedModeChangeRef.current;
        queuedModeChangeRef.current = null;

        await waitForPaint();
        if (request.id !== modeChangeRequestIdRef.current) continue;

        const logMessage =
          request.mode === "manual"
            ? "系统代理已切换为手动模式"
            : request.mode === "pac"
              ? "系统代理已切换为 PAC 自动模式"
              : "系统代理已关闭";
        const toast =
          request.mode === "manual"
            ? "已切换到手动代理"
            : request.mode === "pac"
              ? "已切换到PAC自动代理"
              : "代理已关闭";

        try {
          const nextState =
            request.mode === "manual"
              ? await enableManual(request.profile)
              : request.mode === "pac"
                ? await enablePac(request.profile)
                : await disableProxy();
          confirmedProxyStateRef.current = nextState;

          const isLatestRequest =
            request.id === modeChangeRequestIdRef.current && queuedModeChangeRef.current === null;
          if (!isLatestRequest) continue;

          setState(nextState);
          setProfile((current) => ({ ...current, mode: nextState.mode }));
          setPendingMode(null);
          refreshProxyIpAfterModeChange(nextState);
          appendLog("INFO", logMessage);
          showToast(toast);
        } catch (error) {
          const hasNewerRequest =
            request.id !== modeChangeRequestIdRef.current || queuedModeChangeRef.current !== null;
          if (hasNewerRequest) {
            appendLog("WARN", `中间代理切换未完成，继续应用最新选择：${error instanceof Error ? error.message : String(error)}`);
            continue;
          }

          const fallbackState = confirmedProxyStateRef.current ?? request.fallbackState;
          setState(fallbackState);
          setProfile((current) => ({ ...current, mode: fallbackState.mode }));
          setPendingMode(null);
          refreshProxyIpAfterModeChange(fallbackState);
          appendLog("ERROR", error instanceof Error ? error.message : String(error));
          showToast("切换失败，已恢复界面状态");
        }
      }
    } finally {
      modeChangeRunningRef.current = false;
      if (queuedModeChangeRef.current) void processQueuedModeChanges();
    }
  }

  function refreshProxyIpAfterModeChange(nextState: ProxyState) {
    if (nextState.mode === "off") {
      setProxyIp(null);
      return;
    }

    void refreshIpInfo(true)
      .then(setProxyIp)
      .catch((error) => appendLog("WARN", `代理切换后代理IP刷新失败：${error instanceof Error ? error.message : String(error)}`));
  }

  function commitDirectList(nextDirectDomains: string[]) {
    const currentLists = unifiedListsRef.current;
    const validRuleKeys = new Set(nextDirectDomains.map(unifiedRuleKey));
    updateUnifiedLists({
      ...currentLists,
      directDomains: nextDirectDomains,
      disabledDirectDomains: currentLists.disabledDirectDomains.filter((domain) =>
        validRuleKeys.has(unifiedRuleKey(domain)),
      ),
    });
    setSelectedBypassItems((current) => {
      const validItems = new Set(nextDirectDomains);
      return new Set(Array.from(current).filter((item) => validItems.has(item)));
    });
  }

  function updateUnifiedLists(next: UnifiedLists, preserveSortState = false) {
    if (configurationResetRunningRef.current) return;
    const currentLists = unifiedListsRef.current;
    if (!preserveSortState) {
      const directChanged = !ruleOrdersMatch(currentLists.directDomains, next.directDomains);
      const proxyChanged = !ruleOrdersMatch(currentLists.proxyDomains, next.proxyDomains);
      if (directChanged || proxyChanged) {
        if (directChanged) ruleListSortBaselineRef.current.direct = null;
        if (proxyChanged) ruleListSortBaselineRef.current.proxy = null;
        setRuleListSortState((current) => ({
          direct: directChanged ? null : current.direct,
          proxy: proxyChanged ? null : current.proxy,
        }));
      }
    }
    unifiedListsRef.current = next;
    setUnifiedLists(next);
    const revision = ++unifiedListsRevisionRef.current;
    pendingUnifiedListsSaveRef.current = { lists: next, revision };
    if (unifiedListsSaveRunningRef.current) return;

    unifiedListsSaveRunningRef.current = true;
    void (async () => {
      while (pendingUnifiedListsSaveRef.current) {
        const pending = pendingUnifiedListsSaveRef.current;
        pendingUnifiedListsSaveRef.current = null;
        try {
          const saved = await saveUnifiedLists(pending.lists);
          confirmedUnifiedListsRef.current = saved;
          if (pending.revision === unifiedListsRevisionRef.current) {
            unifiedListsRef.current = saved;
            setUnifiedLists(saved);
          }
          appendLog("INFO", "统一代理名单已更新并应用");
        } catch (error) {
          appendLog("ERROR", error instanceof Error ? error.message : String(error));
          if (
            pending.revision === unifiedListsRevisionRef.current &&
            pendingUnifiedListsSaveRef.current === null
          ) {
            let restored = confirmedUnifiedListsRef.current;
            try {
              restored = await getUnifiedLists();
            } catch (reloadError) {
              appendLog(
                "WARN",
                `重新读取统一代理名单失败：${reloadError instanceof Error ? reloadError.message : String(reloadError)}`,
              );
            }
            if (
              pending.revision === unifiedListsRevisionRef.current &&
              pendingUnifiedListsSaveRef.current === null
            ) {
              confirmedUnifiedListsRef.current = restored;
              unifiedListsRef.current = restored;
              setUnifiedLists(restored);
              ruleListSortBaselineRef.current = { direct: null, proxy: null };
              setRuleListSortState({ direct: null, proxy: null });
              showToast("规则保存失败，已恢复实际配置");
            }
          }
        }
      }
      unifiedListsSaveRunningRef.current = false;
    })();
  }

  function sortUnifiedList(kind: PacRuleTab, field: RuleListSortField) {
    const currentLists = unifiedListsRef.current;
    const currentSort = ruleListSortState[kind];
    const source = kind === "direct" ? currentLists.directDomains : currentLists.proxyDomains;
    const sameField = currentSort?.field === field;
    const shouldRestoreDefault = sameField && currentSort.direction === "desc";
    const listLabel = kind === "direct" ? "直连名单" : "代理名单";

    if (shouldRestoreDefault) {
      const restored = restoreRuleOrder(ruleListSortBaselineRef.current[kind] ?? source, source);
      updateUnifiedLists(
        kind === "direct"
          ? { ...currentLists, directDomains: restored }
          : { ...currentLists, proxyDomains: restored },
        true,
      );
      ruleListSortBaselineRef.current[kind] = null;
      setRuleListSortState((current) => ({ ...current, [kind]: null }));
      showToast(`${listLabel}已恢复默认顺序`);
      appendLog("INFO", `${listLabel}已恢复默认顺序`);
      return;
    }

    if (!ruleListSortBaselineRef.current[kind]) {
      ruleListSortBaselineRef.current[kind] = [...source];
    }
    const direction = sameField && currentSort.direction === "asc" ? "desc" : "asc";
    const disabledKeys = new Set(
      (kind === "direct" ? currentLists.disabledDirectDomains : currentLists.disabledProxyDomains).map(
        unifiedRuleKey,
      ),
    );

    function compareByField(left: string, right: string) {
      if (field === "status") {
        const leftDisabled = disabledKeys.has(unifiedRuleKey(left));
        const rightDisabled = disabledKeys.has(unifiedRuleKey(right));
        return Number(leftDisabled) - Number(rightDisabled);
      }
      if (field === "type") {
        return domainRuleCollator.compare(ruleTypeLabel(left), ruleTypeLabel(right));
      }
      if (field === "strategy") {
        return 0;
      }
      return domainRuleCollator.compare(unifiedRuleKey(left), unifiedRuleKey(right));
    }

    const sorted = source
      .map((domain, index) => ({ domain, index }))
      .sort((left, right) => {
        const fieldCompared = compareByField(left.domain, right.domain);
        const compared =
          fieldCompared ||
          domainRuleCollator.compare(unifiedRuleKey(left.domain), unifiedRuleKey(right.domain));
        if (compared !== 0) return direction === "asc" ? compared : -compared;
        return left.index - right.index;
      })
      .map(({ domain }) => domain);

    updateUnifiedLists(
      kind === "direct"
        ? { ...currentLists, directDomains: sorted }
        : { ...currentLists, proxyDomains: sorted },
      true,
    );
    setRuleListSortState((current) => ({
      ...current,
      [kind]: { field, direction },
    }));
    const fieldLabel =
      field === "domain" ? "域名" : field === "strategy" ? "策略" : field === "type" ? "类型" : "状态";
    const directionLabel = direction === "asc" ? "升序" : "降序";
    showToast(`${listLabel}已按${fieldLabel}${directionLabel}排列`);
    appendLog("INFO", `${listLabel}已按${fieldLabel}${directionLabel}排列`);
  }

  function addPacRule(ruleInput = query) {
    const domain = normalizeUnifiedRuleInput(ruleInput);
    if (!domain || /\s/.test(domain)) {
      showToast("请输入有效域名或规则");
      appendLog("WARN", "请输入有效域名后再添加PAC名单");
      return;
    }
    const existingRule = pacRules.find((rule) => unifiedRuleKey(rule.domain) === unifiedRuleKey(domain));
    if (existingRule) {
      const strategyLabel = existingRule.strategy === "proxy" ? "代理" : "直连";
      showToast(`${domain} 已存在于${strategyLabel}规则`);
      appendLog("WARN", `${domain} 已存在于${strategyLabel}规则`);
      return;
    }

    const next =
      activePacTab === "proxy"
        ? {
            ...unifiedLists,
            proxyDomains: [...unifiedLists.proxyDomains, domain],
            disabledProxyDomains: unifiedLists.disabledProxyDomains.filter(
              (item) => unifiedRuleKey(item) !== unifiedRuleKey(domain),
            ),
          }
        : {
            ...unifiedLists,
            directDomains: [...unifiedLists.directDomains, domain],
            disabledDirectDomains: unifiedLists.disabledDirectDomains.filter(
              (item) => unifiedRuleKey(item) !== unifiedRuleKey(domain),
            ),
          };
    updateUnifiedLists(next);
    setQuery("");
    showToast(`已添加${activePacTab === "proxy" ? "代理" : "直连"}规则`);
    appendLog("INFO", `已添加${activePacTab === "proxy" ? "代理" : "直连"}规则：${domain}`);
  }

  function addBypassItem(ruleInput = bypassQuery) {
    const item = normalizeUnifiedRuleInput(ruleInput);
    if (!item || /\s/.test(item)) {
      showToast("请输入有效地址");
      appendLog("WARN", "请输入有效地址后再添加不走代理规则");
      return;
    }
    if (unifiedLists.directDomains.some((current) => current.toLowerCase() === item)) {
      showToast(`${item} 已存在`);
      appendLog("WARN", `${item} 已存在于直连名单`);
      return;
    }

    commitDirectList([...unifiedLists.directDomains, item]);
    setBypassQuery("");
    showToast("已添加不走代理规则");
    appendLog("INFO", `已添加不走代理规则：${item}`);
  }

  function togglePacItemSelected(key: string) {
    setSelectedRuleIds((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleBypassSelected(item: string) {
    setSelectedBypassItems((current) => {
      const next = new Set(current);
      if (next.has(item)) {
        next.delete(item);
      } else {
        next.add(item);
      }
      return next;
    });
  }

  function toggleAllPacItems() {
    setSelectedRuleIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        filteredRules.forEach((rule) => next.delete(rule.id));
      } else {
        filteredRules.forEach((rule) => next.add(rule.id));
      }
      return next;
    });
  }

  function toggleAllFilteredBypassItems() {
    setSelectedBypassItems((current) => {
      const next = new Set(current);
      if (allFilteredBypassSelected) {
        filteredBypassItems.forEach((item) => next.delete(item));
      } else {
        filteredBypassItems.forEach((item) => next.add(item));
      }
      return next;
    });
  }

  function deleteSelectedPacItems() {
    const selectedRules = filteredRules.filter((rule) => selectedRuleIds.has(rule.id));
    if (selectedRules.length === 0) {
      appendLog("WARN", "请先选择要删除的PAC规则");
      return;
    }
    const selectedKeys = new Set(selectedRules.map((rule) => unifiedRuleKey(rule.domain)));
    const next = {
      ...unifiedLists,
      directDomains: unifiedLists.directDomains.filter((domain) => !selectedKeys.has(unifiedRuleKey(domain))),
      disabledDirectDomains: unifiedLists.disabledDirectDomains.filter(
        (domain) => !selectedKeys.has(unifiedRuleKey(domain)),
      ),
      proxyDomains: unifiedLists.proxyDomains.filter((domain) => !selectedKeys.has(unifiedRuleKey(domain))),
      disabledProxyDomains: unifiedLists.disabledProxyDomains.filter(
        (domain) => !selectedKeys.has(unifiedRuleKey(domain)),
      ),
    };
    updateUnifiedLists(next);
    setSelectedRuleIds(new Set());
    appendLog("INFO", `已删除 ${selectedRules.length} 条PAC规则`);
  }

  function deleteSelectedBypassItems() {
    const selectedFilteredItems = new Set(filteredBypassItems.filter((item) => selectedBypassItems.has(item)));
    if (selectedFilteredItems.size === 0) {
      appendLog("WARN", "请先选择要删除的不走代理规则");
      return;
    }
    const selectedCount = selectedFilteredItems.size;
    commitDirectList(unifiedLists.directDomains.filter((item) => !selectedFilteredItems.has(item)));
    appendLog("INFO", `已删除 ${selectedCount} 条不走代理规则`);
  }

  function updatePacRule(ruleId: string, updater: (rule: PacRule) => PacRule, logMessage: string) {
    const currentLists = unifiedListsRef.current;
    const currentRule = buildPacRules(currentLists).find((rule) => rule.id === ruleId);
    if (!currentRule) return;

    const nextRule = updater(currentRule);
    const currentKey = unifiedRuleKey(currentRule.domain);
    const nextKey = unifiedRuleKey(nextRule.domain);

    if (currentRule.strategy === nextRule.strategy && currentKey === nextKey) {
      const nextDisabledDomains = (domains: string[]) => {
        const withoutCurrentRule = domains.filter((domain) => unifiedRuleKey(domain) !== currentKey);
        return nextRule.enabled ? withoutCurrentRule : [...withoutCurrentRule, currentRule.domain];
      };
      const next =
        currentRule.strategy === "direct"
          ? {
              ...currentLists,
              disabledDirectDomains: nextDisabledDomains(currentLists.disabledDirectDomains),
            }
          : {
              ...currentLists,
              disabledProxyDomains: nextDisabledDomains(currentLists.disabledProxyDomains),
            };

      updateUnifiedLists(next);
      showToast(logMessage);
      appendLog("INFO", logMessage);
      return;
    }

    let next: UnifiedLists = {
      ...currentLists,
      directDomains: currentLists.directDomains.filter((domain) => unifiedRuleKey(domain) !== currentKey),
      disabledDirectDomains: currentLists.disabledDirectDomains.filter(
        (domain) => unifiedRuleKey(domain) !== currentKey,
      ),
      proxyDomains: currentLists.proxyDomains.filter((domain) => unifiedRuleKey(domain) !== currentKey),
      disabledProxyDomains: currentLists.disabledProxyDomains.filter(
        (domain) => unifiedRuleKey(domain) !== currentKey,
      ),
    };

    if (nextRule.strategy === "direct") {
      next = {
        ...next,
        directDomains: [...next.directDomains.filter((domain) => unifiedRuleKey(domain) !== nextKey), nextRule.domain],
        disabledDirectDomains: nextRule.enabled
          ? next.disabledDirectDomains
          : [...next.disabledDirectDomains, nextRule.domain],
      };
    } else {
      next = {
        ...next,
        proxyDomains: [...next.proxyDomains.filter((domain) => unifiedRuleKey(domain) !== nextKey), nextRule.domain],
        disabledProxyDomains: nextRule.enabled
          ? next.disabledProxyDomains
          : [...next.disabledProxyDomains, nextRule.domain],
      };
    }

    updateUnifiedLists(next);
    setSelectedRuleIds(new Set());
    showToast(logMessage);
    appendLog("INFO", logMessage);
  }

  function activatePausedRule(ruleId: string) {
    const currentLists = unifiedListsRef.current;
    const currentRule = buildPacRules(currentLists).find((rule) => rule.id === ruleId);
    if (!currentRule) return;

    const ruleKey = unifiedRuleKey(currentRule.domain);
    const listLabel = currentRule.strategy === "direct" ? "直连名单" : "代理名单";
    const next =
      currentRule.strategy === "direct"
        ? {
            ...currentLists,
            directEnabled: true,
            disabledDirectDomains: currentLists.directDomains.filter(
              (domain) => unifiedRuleKey(domain) !== ruleKey,
            ),
          }
        : {
            ...currentLists,
            proxyEnabled: true,
            disabledProxyDomains: currentLists.proxyDomains.filter(
              (domain) => unifiedRuleKey(domain) !== ruleKey,
            ),
          };

    updateUnifiedLists(next);
    showToast(`${currentRule.domain} 已启用，其他${listLabel}规则保持停用`);
    appendLog("INFO", `${currentRule.domain} 已启用，${listLabel}总开关已开启，其他规则保持停用`);
  }

  function deletePacRule(ruleId: string) {
    const rule = pacRules.find((item) => item.id === ruleId);
    if (!rule) return;
    const key = unifiedRuleKey(rule.domain);
    const next = {
      ...unifiedLists,
      directDomains: unifiedLists.directDomains.filter((item) => unifiedRuleKey(item) !== key),
      disabledDirectDomains: unifiedLists.disabledDirectDomains.filter((item) => unifiedRuleKey(item) !== key),
      proxyDomains: unifiedLists.proxyDomains.filter((item) => unifiedRuleKey(item) !== key),
      disabledProxyDomains: unifiedLists.disabledProxyDomains.filter((item) => unifiedRuleKey(item) !== key),
    };
    updateUnifiedLists(next);
    setSelectedRuleIds((current) => {
      const selected = new Set(current);
      selected.delete(ruleId);
      return selected;
    });
    appendLog("INFO", `已删除PAC规则：${rule.domain}`);
  }

  function deleteBypassItem(item: string) {
    commitDirectList(unifiedLists.directDomains.filter((current) => current !== item));
    appendLog("INFO", `已删除不走代理规则：${item}`);
  }

  function resetDefaults() {
    setConfigResetConfirmOpen(true);
  }

  async function confirmDefaultsReset() {
    setConfigResetConfirmOpen(false);
    if (busyAction !== null || configurationResetRunningRef.current) return;

    configurationResetRunningRef.current = true;
    setBusyAction("reset-config");
    try {
      await Promise.all([waitForUnifiedListsSaveIdle(), waitForModeChangeIdle()]);
      const nextProfile = {
        ...defaultProfile,
        mode: confirmedProxyStateRef.current?.mode ?? effectiveState.mode,
      };
      const nextLists = {
        ...unifiedListsRef.current,
        directDomains: [...defaultUnifiedLists.directDomains],
        disabledDirectDomains: [],
      };
      const saved = await saveConfiguration(nextProfile, nextLists);
      setProfile(saved.profile);
      setState(saved.proxyState);
      confirmedProxyStateRef.current = saved.proxyState;
      unifiedListsRevisionRef.current += 1;
      pendingUnifiedListsSaveRef.current = null;
      confirmedUnifiedListsRef.current = saved.unifiedLists;
      unifiedListsRef.current = saved.unifiedLists;
      setUnifiedLists(saved.unifiedLists);
      setSelectedRuleIds(new Set());
      setSelectedBypassItems(new Set());
      setBypassQuery("");
      setQuery("");
      showToast("已恢复默认配置");
      appendLog("INFO", "已恢复默认配置");
    } catch (error) {
      showToast("恢复默认配置失败");
      appendLog("ERROR", error instanceof Error ? error.message : String(error));
    } finally {
      configurationResetRunningRef.current = false;
      setBusyAction(null);
    }
  }

  function resetPacRules() {
    updateUnifiedLists({
      ...unifiedLists,
      directDomains: [...defaultUnifiedLists.directDomains],
      disabledDirectDomains: [],
      proxyDomains: [...defaultUnifiedLists.proxyDomains],
      disabledProxyDomains: [],
    });
    setQuery("");
    showToast("PAC名单已恢复默认");
    appendLog("INFO", "PAC名单已恢复默认");
  }

  function confirmPacRulesReset() {
    setPacResetConfirmOpen(false);
    resetPacRules();
  }

  function copyText(value: string | undefined, label: string) {
    const text = value?.trim();
    if (!text) {
      showToast(`${label}为空，无法复制`);
      appendLog("WARN", `${label}为空，无法复制`);
      return;
    }

    void (async () => {
      try {
        const clipboard = globalThis.navigator?.clipboard;
        if (clipboard?.writeText) {
          await clipboard.writeText(text);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.setAttribute("readonly", "true");
          textarea.style.position = "fixed";
          textarea.style.left = "-9999px";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        }
        showToast(`${label}已复制`);
        appendLog("INFO", `${label}已复制：${text}`);
      } catch {
        showToast(`${label}复制失败`);
        appendLog("WARN", `${label}复制失败`);
      }
    })();
  }

  function renderActiveContent() {
    switch (activeNav) {
      case "overview":
        return (
          <OverviewPage
            activeSiteCategory={activeSiteCategory}
            activeSiteCategoryIndex={activeSiteCategoryIndex}
            animateModeValues={hasModeInteraction}
            busyAction={busyAction}
            directIp={directIp}
            directRuleCount={directRuleCount}
            disabledDirectRuleCount={disabledDirectRuleCount}
            disabledProxyRuleCount={disabledProxyRuleCount}
            effectiveState={effectiveState}
            failedSiteIcons={failedSiteIcons}
            filteredQuickSites={filteredQuickSites}
            isSpeedSettingsOpen={isSpeedSettingsOpen}
            onCopy={copyText}
            onOpenQuickSite={openQuickSite}
            onRefreshConnection={refreshConnectionState}
            onRefreshDirectIp={refreshDirectIp}
            onRefreshPacSummary={refreshPacSummary}
            onRefreshProxyIp={refreshProxyIp}
            onRestoreSpeedTestConfig={restoreSpeedTestConfig}
            onRunSpeedTest={runSpeedTest}
            onSiteCategoryChange={setActiveSiteCategory}
            onSiteIconError={handleQuickSiteIconError}
            onToggleSpeedSettings={() => setSpeedSettingsOpen((current) => !current)}
            onUpdateSpeedTestConfig={updateSpeedTestConfig}
            overviewMode={overviewMode}
            pacUrl={pacUrl}
            proxyIp={proxyIp}
            proxyRuleCount={proxyRuleCount}
            quickSiteIconUrls={quickSiteIconUrls}
            speedTestConfig={speedTestConfig}
            speedTestHistory={speedTestHistory as SpeedTestHistoryEntry[]}
            speedTestProgress={speedTestProgress}
            speedTestResults={speedTestResults}
            speedTestRunningTarget={speedTestRunningTarget}
          />
        );

      case "config":
        return (
          <>
            <ProxyConfigPage
              allFilteredBypassSelected={allFilteredBypassSelected}
              busyAction={busyAction}
              bypassQuery={bypassQuery}
              bypassListEnabled={unifiedLists.directEnabled}
              disabledBypassItemKeys={disabledDirectRuleKeys}
              filteredBypassItems={filteredBypassItems}
              onAddBypassItem={addBypassItem}
              onActivatePausedBypassItem={(item) => activatePausedRule(pacRuleId("direct", item))}
              onBypassQueryChange={setBypassQuery}
              onDeleteBypassItem={deleteBypassItem}
              onDeleteSelectedBypassItems={deleteSelectedBypassItems}
              onOpenGoogle={openGooglePage}
              onResetDefaults={resetDefaults}
              onSaveProfile={() => saveCurrentProfile("save-config")}
              onTestProxy={() =>
                void runAction(
                  "test",
                  () => testProxy(profile),
                  () => undefined,
                  "代理连接测试完成",
                  "代理测试完成",
                )
              }
              onToggleAllFilteredBypassItems={toggleAllFilteredBypassItems}
              onToggleBypassItemEnabled={(item) =>
                updatePacRule(
                  pacRuleId("direct", item),
                  (rule) => ({ ...rule, enabled: !rule.enabled }),
                  `${item} 已${disabledDirectRuleKeys.has(unifiedRuleKey(item)) ? "启用" : "停用"}`,
                )
              }
              onSortBypassItems={(field) => sortUnifiedList("direct", field)}
              sortState={ruleListSortState.direct}
              onToggleBypassSelected={toggleBypassSelected}
              onUpdateProfile={updateProfile}
              profile={profile}
              selectedBypassItems={selectedBypassItems}
              selectedVisibleBypassCount={selectedVisibleBypassCount}
            />
            <SplitResizer onPointerDown={startSplitResize} view={splitView} />
          </>
        );

      case "pac":
        return (
          <>
            <PacPage
              activePacTab={activePacTab}
              allFilteredSelected={allFilteredSelected}
              directRuleCount={directRuleCount}
              disabledRuleCount={disabledRuleCount}
              filteredRules={filteredRules}
              listEnabled={activePacTab === "proxy" ? unifiedLists.proxyEnabled : unifiedLists.directEnabled}
              onAddRule={addPacRule}
              onActivatePausedRule={activatePausedRule}
              onCopy={copyText}
              onDeleteRule={deletePacRule}
              onDeleteSelectedRules={deleteSelectedPacItems}
              onPacTabChange={setActivePacTab}
              onQueryChange={setQuery}
              onResetRules={() => setPacResetConfirmOpen(true)}
              onSortRules={(field) => sortUnifiedList(activePacTab, field)}
              onToggleAllFilteredRules={toggleAllPacItems}
              onToggleRuleSelected={togglePacItemSelected}
              onUpdateRule={updatePacRule}
              pacUrl={pacUrl}
              sortState={ruleListSortState[activePacTab]}
              proxyRuleCount={proxyRuleCount}
              query={query}
              selectedRuleIds={selectedRuleIds}
              selectedVisibleRuleCount={selectedVisibleRuleCount}
            />
            <SplitResizer onPointerDown={startSplitResize} view={splitView} />
          </>
        );

      case "settings":
        return (
          <SettingsPage
            activeSettings={activeSettings}
            activeThemeIndex={activeThemeIndex}
            configDirectoryPath={configDirectoryPath}
            onChangeUnifiedLists={updateUnifiedLists}
            onSortUnifiedList={sortUnifiedList}
            sortStates={ruleListSortState}
            onCopy={copyText}
            onOpenConfigDirectory={() => void handleOpenConfigDirectory()}
            onOpenRepository={openSourceRepository}
            onSettingsChange={setActiveSettings}
            onThemePreferenceChange={setThemePreference}
            resolvedTheme={resolvedTheme}
            resolvedThemeLabel={resolvedThemeLabel}
            themePreference={themePreference}
            unifiedLists={unifiedLists}
          />
        );
    }
  }

  return (
    <TrafficMonitorProvider active={activeNav === "overview"}>
      <div
        className={`app-shell app-mode-${effectiveState.mode}${isSidebarCollapsed ? " sidebar-collapsed" : ""}`}
        data-theme={resolvedTheme}
      >
      <Sidebar
        activeNav={activeNav}
        isCollapsed={isSidebarCollapsed}
        onNavChange={handleNavChange}
        onToggle={() => setSidebarCollapsed((current) => !current)}
      />

      <main className="workspace">
        <TopBar
          animateModeValues={hasModeInteraction}
          state={effectiveState}
          pacUrl={pacUrl}
          isModePending={isModePending}
          onCopy={copyText}
          onModeChange={setMode}
        />

        <section className={`content-grid view-${activeNav}`} key={activeNav} style={contentStyle}>
          {renderActiveContent()}
        </section>
      </main>
      {toastMessage ? <div className="toast-message">{toastMessage}</div> : null}
      <ConfirmDialog
        confirmLabel="确认恢复"
        description="当前代理/直连名单将被默认名单替换，并恢复已删除或停用的内置直连规则。此操作会覆盖你对名单所做的修改。"
        isOpen={isPacResetConfirmOpen}
        onCancel={() => setPacResetConfirmOpen(false)}
        onConfirm={confirmPacRulesReset}
        title="恢复默认 PAC 名单？"
      />
      <ConfirmDialog
        confirmLabel="确认恢复"
        description="代理地址与不走代理名单将恢复为默认值，已添加的自定义不走代理规则会被移除。此操作会覆盖当前配置。"
        isOpen={isConfigResetConfirmOpen}
        onCancel={() => setConfigResetConfirmOpen(false)}
        onConfirm={confirmDefaultsReset}
        title="恢复默认配置？"
      />
      </div>
    </TrafficMonitorProvider>
  );
}
