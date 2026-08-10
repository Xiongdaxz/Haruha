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
  refreshIpInfo,
  runProxySpeedTest,
  saveProfile,
  saveUnifiedLists,
  testProxy,
} from "../lib/api";
import type {
  AppLogLevel,
  IpInfo,
  PacRule,
  ProxyMode,
  ProxyProfile,
  ProxyState,
  QuickSite,
  QuickSiteCategory,
  SpeedTestHistoryEntry,
  SpeedTestResult,
  UnifiedLists,
} from "../lib/types";
import { normalizeBypassInput, normalizeRuleInput } from "../lib/rules";
import { OverviewPage } from "../pages/OverviewPage";
import { PacPage } from "../pages/PacPage";
import { ProxyConfigPage } from "../pages/ProxyConfigPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SplitResizer } from "../components/layout/SplitResizer";
import { Sidebar } from "../components/layout/Sidebar";
import { TopBar } from "../components/layout/TopBar";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { useSpeedTestConfig } from "../hooks/useSpeedTestConfig";
import { useSpeedTestHistory } from "../hooks/useSpeedTestHistory";
import { useNetworkTraffic } from "../hooks/useNetworkTraffic";
import { useSplitLayout } from "../hooks/useSplitLayout";
import { useThemePreference } from "../hooks/useThemePreference";
import { useToast } from "../hooks/useToast";
import { builtinDirectDomains, quickSiteCategories, quickSites } from "./constants";
import type { NavKey, PacRuleTab, SettingsKey } from "./types";

interface QueuedModeChange {
  id: number;
  mode: ProxyMode;
  profile: ProxyProfile;
  fallbackState: ProxyState;
}

export function HaruhaApp() {
  const [activeNav, setActiveNav] = useState<NavKey>("overview");
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSettings, setActiveSettings] = useState<SettingsKey>("appearance");
  const [isPacResetConfirmOpen, setPacResetConfirmOpen] = useState(false);
  const [configDirectoryPath, setConfigDirectoryPath] = useState("");
  const [profile, setProfile] = useState<ProxyProfile>(defaultProfile);
  const [state, setState] = useState<ProxyState | null>(null);
  const [rules, setRules] = useState<PacRule[]>(defaultProfile.pacRules);
  const [unifiedLists, setUnifiedLists] = useState<UnifiedLists>(defaultUnifiedLists);
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(new Set());
  const [selectedBypassItems, setSelectedBypassItems] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [bypassQuery, setBypassQuery] = useState("");
  const [activePacTab, setActivePacTab] = useState<PacRuleTab>("proxy");
  const [activeSiteCategory, setActiveSiteCategory] = useState<QuickSiteCategory>("ai");
  const [failedSiteIcons, setFailedSiteIcons] = useState<Set<string>>(new Set());
  const [quickSiteIconUrls, setQuickSiteIconUrls] = useState<Record<string, string>>({});
  const [quickSiteIconRetryTick, setQuickSiteIconRetryTick] = useState(0);
  const [speedTestResult, setSpeedTestResult] = useState<SpeedTestResult | null>(null);
  const [isSpeedSettingsOpen, setSpeedSettingsOpen] = useState(false);
  const [directIp, setDirectIp] = useState<IpInfo | null>(null);
  const [proxyIp, setProxyIp] = useState<IpInfo | null>(null);
  const [isTrafficMonitorEnabled, setTrafficMonitorEnabled] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<ProxyMode | null>(null);
  const [hasModeInteraction, setHasModeInteraction] = useState(false);
  const hasBootstrappedRef = useRef(false);
  const quickSiteIconAttemptsRef = useRef<Record<string, number>>({});
  const queuedModeChangeRef = useRef<QueuedModeChange | null>(null);
  const modeChangeRunningRef = useRef(false);
  const modeChangeRequestIdRef = useRef(0);
  const confirmedProxyStateRef = useRef<ProxyState | null>(null);
  const [, startNavigationTransition] = useTransition();
  const { showToast, toastMessage } = useToast();
  const { activeThemeIndex, resolvedTheme, resolvedThemeLabel, setThemePreference, themePreference } = useThemePreference();
  const { setSpeedTestConfig, speedTestConfig, updateSpeedTestConfig } = useSpeedTestConfig();
  const { addSpeedTestHistory, speedTestHistory } = useSpeedTestHistory();
  const { contentStyle, splitView, startSplitResize } = useSplitLayout(activeNav);
  const isTrafficMonitorVisible = activeNav === "overview" && isTrafficMonitorEnabled;
  const { error: networkTrafficError, points: networkTrafficPoints } = useNetworkTraffic(isTrafficMonitorVisible);

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
        setRules(loadedProfile.pacRules);
        setState(currentState);
        confirmedProxyStateRef.current = currentState;
        setUnifiedLists(loadedUnified);
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

    function closeSpeedSettingsOnOutsideClick(event: PointerEvent) {
      if (event.target instanceof Element && !event.target.closest(".speed-card")) {
        setSpeedSettingsOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeSpeedSettingsOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeSpeedSettingsOnOutsideClick);
  }, [isSpeedSettingsOpen]);

  const builtinDirectRules = useMemo<PacRule[]>(() => {
    const removedBuiltinDirectDomains = new Set(
      profile.removedBuiltinDirectDomains.map((domain) => normalizeRuleInput(domain)),
    );
    const disabledBuiltinDirectDomains = new Set(
      profile.disabledBuiltinDirectDomains.map((domain) => normalizeRuleInput(domain)),
    );
    const enabledUserDirectDomains = new Set(
      rules
        .filter((rule) => rule.enabled && rule.strategy === "direct")
        .map((rule) => normalizeRuleInput(rule.domain)),
    );

    return builtinDirectDomains
      .filter((domain) => {
        const normalizedDomain = normalizeRuleInput(domain);
        return !removedBuiltinDirectDomains.has(normalizedDomain) && !enabledUserDirectDomains.has(normalizedDomain);
      })
      .map((domain) => ({
        id: `builtin-direct-${domain}`,
        domain,
        strategy: "direct",
        enabled: !disabledBuiltinDirectDomains.has(normalizeRuleInput(domain)),
        note: "PAC内置直连",
        readonly: true,
        source: "builtin",
      }));
  }, [profile.disabledBuiltinDirectDomains, profile.removedBuiltinDirectDomains, rules]);

  const pacDisplayRules = useMemo(
    () => (activePacTab === "direct" ? [...rules, ...builtinDirectRules] : rules),
    [activePacTab, builtinDirectRules, rules],
  );

  const filteredRules = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return pacDisplayRules.filter((rule) => {
      const matchesTab = rule.strategy === activePacTab;
      const matchesKeyword =
        !keyword || rule.domain.toLowerCase().includes(keyword) || rule.note?.toLowerCase().includes(keyword);
      return matchesTab && matchesKeyword;
    });
  }, [activePacTab, pacDisplayRules, query]);

  const filteredBypassItems = useMemo(() => {
    const keyword = bypassQuery.trim().toLowerCase();
    return profile.bypassList.filter((item) => !keyword || item.toLowerCase().includes(keyword));
  }, [bypassQuery, profile.bypassList]);

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

  const selectableFilteredRules = filteredRules.filter((rule) => !rule.readonly || rule.source === "builtin");
  const allFilteredSelected =
    selectableFilteredRules.length > 0 && selectableFilteredRules.every((rule) => selectedRuleIds.has(rule.id));
  const selectedVisibleRuleCount = selectableFilteredRules.filter((rule) => selectedRuleIds.has(rule.id)).length;
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

  const proxyRuleCount = rules.filter((rule) => rule.enabled && rule.strategy === "proxy").length;
  const directRuleCount =
    rules.filter((rule) => rule.enabled && rule.strategy === "direct").length +
    builtinDirectRules.filter((rule) => rule.enabled).length;
  const disabledRuleCount =
    rules.filter((rule) => !rule.enabled).length + builtinDirectRules.filter((rule) => !rule.enabled).length;
  const pacUrl = effectiveState.pacUrl ?? "http://127.0.0.1:18765/proxy.pac";
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
      const [direct, proxy] = await Promise.all([refreshIpInfo(false), refreshIpInfo(true)]);
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
    void runAction("refresh-direct-ip", () => refreshIpInfo(false), setDirectIp, "本机出口IP已刷新", "本机IP已刷新");
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
        setRules(loadedProfile.pacRules);
        setUnifiedLists(loadedUnified);
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
    setRules(savedProfile.pacRules);
    setSelectedRuleIds(new Set());
    setSelectedBypassItems(new Set());
  }

  function saveCurrentProfile(actionKey = "save") {
    const mode = effectiveState.mode;
    const nextProfile = { ...profile, pacRules: rules, mode };
    if (mode === "pac") {
      void runAction(
        actionKey,
        () => enablePac({ ...nextProfile, mode: "pac" }),
        (nextState) => {
          setState(nextState);
          setProfile({ ...nextProfile, mode: "pac" });
          setRules(nextProfile.pacRules);
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
          setRules(nextProfile.pacRules);
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

  function runSpeedTest() {
    void runAction(
      "speed-test",
      () => runProxySpeedTest({ ...profile, pacRules: rules }, speedTestConfig),
      (result) => {
        setSpeedTestResult(result);
        addSpeedTestHistory(result);
      },
      "代理测速完成",
    );
  }

  function restoreSpeedTestConfig() {
    setSpeedTestConfig(defaultSpeedTestConfig);
    setSpeedTestResult(null);
    showToast("测速配置已恢复默认");
  }

  async function waitForPaint() {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)));
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
    if (mode === effectiveState.mode) return;

    setHasModeInteraction(true);
    modeChangeRequestIdRef.current += 1;
    const nextProfile = { ...profile, pacRules: rules, mode };
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

  function commitRules(nextRules: PacRule[]) {
    commitPacRuleState(
      nextRules,
      profile.removedBuiltinDirectDomains,
      profile.disabledBuiltinDirectDomains,
    );
  }

  function commitPacRuleState(
    nextRules: PacRule[],
    removedBuiltinDirectDomains: string[],
    disabledBuiltinDirectDomains: string[],
  ) {
    const normalizedRemovedDomains = Array.from(
      new Set(removedBuiltinDirectDomains.map((domain) => normalizeRuleInput(domain)).filter(Boolean)),
    );
    const removedDomainSet = new Set(normalizedRemovedDomains);
    const normalizedDisabledDomains = Array.from(
      new Set(disabledBuiltinDirectDomains.map((domain) => normalizeRuleInput(domain)).filter(Boolean)),
    ).filter((domain) => !removedDomainSet.has(domain));
    const nextProfile = {
      ...profile,
      pacRules: nextRules,
      removedBuiltinDirectDomains: normalizedRemovedDomains,
      disabledBuiltinDirectDomains: normalizedDisabledDomains,
    };
    setRules(nextRules);
    setProfile(nextProfile);
    setSelectedRuleIds(new Set());
    persistProfileChange(
      nextProfile,
      effectiveState.mode === "pac" ? "PAC规则已更新并应用" : "PAC规则已保存",
    );
  }

  function commitBypassList(nextBypassList: string[]) {
    const nextProfile = { ...profile, bypassList: nextBypassList };
    setProfile(nextProfile);
    setSelectedBypassItems((current) => {
      const validItems = new Set(nextBypassList);
      return new Set(Array.from(current).filter((item) => validItems.has(item)));
    });
    persistProfileChange(
      nextProfile,
      effectiveState.mode === "manual" ? "不走代理规则已更新并应用" : "不走代理规则已保存",
    );
  }

  function updateUnifiedLists(next: UnifiedLists) {
    setUnifiedLists(next);
    void saveUnifiedLists(next)
      .then((saved) => {
        setUnifiedLists(saved);
        appendLog("INFO", "统一代理名单已更新并应用");
      })
      .catch((error) => {
        appendLog("ERROR", error instanceof Error ? error.message : String(error));
      });
  }

  function addRule() {
    const domain = normalizeRuleInput(query);
    if (!domain || /\s/.test(domain)) {
      showToast("请输入有效域名");
      appendLog("WARN", "请输入有效域名后再添加PAC规则");
      return;
    }
    if (rules.some((rule) => rule.domain === domain)) {
      showToast(`${domain} 已存在`);
      appendLog("WARN", `${domain} 已存在`);
      return;
    }
    if (activePacTab === "direct" && builtinDirectDomains.some((item) => normalizeRuleInput(item) === domain)) {
      showToast(`${domain} 已在内置直连规则中`);
      appendLog("WARN", `${domain} 已存在于PAC内置直连规则`);
      return;
    }

    const nextRule: PacRule = {
      id: domain,
      domain,
      strategy: activePacTab,
      enabled: true,
      note: activePacTab === "proxy" ? "自定义代理" : "自定义直连",
    };
    commitRules([...rules, nextRule]);
    setQuery("");
    showToast(`已添加${activePacTab === "proxy" ? "代理" : "直连"}规则`);
    appendLog("INFO", `已添加${activePacTab === "proxy" ? "代理" : "直连"}规则：${domain}`);
  }

  function addBypassItem() {
    const item = normalizeBypassInput(bypassQuery);
    if (!item || /\s/.test(item)) {
      showToast("请输入有效地址");
      appendLog("WARN", "请输入有效地址后再添加不走代理规则");
      return;
    }
    if (profile.bypassList.some((current) => current.toLowerCase() === item.toLowerCase())) {
      showToast(`${item} 已存在`);
      appendLog("WARN", `${item} 已存在于不走代理列表`);
      return;
    }

    commitBypassList([...profile.bypassList, item]);
    setBypassQuery("");
    showToast("已添加不走代理规则");
    appendLog("INFO", `已添加不走代理规则：${item}`);
  }

  function toggleRuleSelected(ruleId: string) {
    const rule = filteredRules.find((item) => item.id === ruleId);
    if (rule?.readonly && rule.source !== "builtin") {
      return;
    }
    setSelectedRuleIds((current) => {
      const next = new Set(current);
      if (next.has(ruleId)) {
        next.delete(ruleId);
      } else {
        next.add(ruleId);
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

  function toggleAllFilteredRules() {
    setSelectedRuleIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        selectableFilteredRules.forEach((rule) => next.delete(rule.id));
      } else {
        selectableFilteredRules.forEach((rule) => next.add(rule.id));
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

  function deleteSelectedRules() {
    const selectedRules = selectableFilteredRules.filter((rule) => selectedRuleIds.has(rule.id));
    if (selectedRules.length === 0) {
      appendLog("WARN", "请先选择要删除的PAC规则");
      return;
    }
    const selectedUserIds = new Set(
      selectedRules.filter((rule) => rule.source !== "builtin").map((rule) => rule.id),
    );
    const removedBuiltinDomains = selectedRules
      .filter((rule) => rule.source === "builtin")
      .map((rule) => rule.domain);
    commitPacRuleState(
      rules.filter((rule) => !selectedUserIds.has(rule.id)),
      [...profile.removedBuiltinDirectDomains, ...removedBuiltinDomains],
      profile.disabledBuiltinDirectDomains,
    );
    appendLog("INFO", `已删除 ${selectedRules.length} 条PAC规则`);
  }

  function deleteSelectedBypassItems() {
    const selectedFilteredItems = new Set(filteredBypassItems.filter((item) => selectedBypassItems.has(item)));
    if (selectedFilteredItems.size === 0) {
      appendLog("WARN", "请先选择要删除的不走代理规则");
      return;
    }
    const selectedCount = selectedFilteredItems.size;
    commitBypassList(profile.bypassList.filter((item) => !selectedFilteredItems.has(item)));
    appendLog("INFO", `已删除 ${selectedCount} 条不走代理规则`);
  }

  function deleteRule(ruleId: string) {
    const rule = rules.find((item) => item.id === ruleId);
    if (!rule) {
      const builtinRule = builtinDirectRules.find((item) => item.id === ruleId);
      if (!builtinRule) {
        appendLog("WARN", "未找到要删除的PAC规则");
        return;
      }
      commitPacRuleState(
        rules,
        [...profile.removedBuiltinDirectDomains, builtinRule.domain],
        profile.disabledBuiltinDirectDomains,
      );
      appendLog("INFO", `已删除PAC内置直连规则：${builtinRule.domain}`);
      return;
    }
    commitRules(rules.filter((item) => item.id !== ruleId));
    appendLog("INFO", `已删除PAC规则：${rule?.domain ?? ruleId}`);
  }

  function deleteBypassItem(item: string) {
    commitBypassList(profile.bypassList.filter((current) => current !== item));
    appendLog("INFO", `已删除不走代理规则：${item}`);
  }

  function updateRule(ruleId: string, updater: (rule: PacRule) => PacRule, logMessage: string) {
    const userRule = rules.find((rule) => rule.id === ruleId);
    if (!userRule) {
      const builtinRule = builtinDirectRules.find((rule) => rule.id === ruleId);
      if (!builtinRule) {
        appendLog("WARN", "未找到要更新的PAC规则");
        return;
      }
      const nextBuiltinRule = updater(builtinRule);
      const disabledDomains = new Set(
        profile.disabledBuiltinDirectDomains.map((domain) => normalizeRuleInput(domain)),
      );
      const normalizedDomain = normalizeRuleInput(builtinRule.domain);
      if (nextBuiltinRule.enabled) {
        disabledDomains.delete(normalizedDomain);
      } else {
        disabledDomains.add(normalizedDomain);
      }
      commitPacRuleState(
        rules,
        profile.removedBuiltinDirectDomains,
        Array.from(disabledDomains),
      );
      appendLog("INFO", logMessage);
      return;
    }
    commitRules(rules.map((rule) => (rule.id === ruleId ? updater(rule) : rule)));
    appendLog("INFO", logMessage);
  }

  function resetDefaults() {
    setProfile(defaultProfile);
    setRules(defaultProfile.pacRules);
    setSelectedRuleIds(new Set());
    setSelectedBypassItems(new Set());
    setBypassQuery("");
    appendLog("INFO", "已恢复默认配置");
  }

  function resetPacRules() {
    commitPacRuleState(defaultProfile.pacRules, [], []);
    setQuery("");
    showToast("PAC规则和内置直连状态已恢复默认");
    appendLog("INFO", "PAC规则和内置直连状态已恢复默认");
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
            disabledRuleCount={disabledRuleCount}
            effectiveState={effectiveState}
            failedSiteIcons={failedSiteIcons}
            filteredQuickSites={filteredQuickSites}
            isSpeedSettingsOpen={isSpeedSettingsOpen}
            onToggleTrafficMonitor={() => setTrafficMonitorEnabled((current) => !current)}
            trafficMonitorEnabled={isTrafficMonitorEnabled}
            trafficMonitorError={networkTrafficError}
            trafficMonitorPoints={networkTrafficPoints}
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
            proxyIp={proxyIp}
            proxyRuleCount={proxyRuleCount}
            quickSiteIconUrls={quickSiteIconUrls}
            speedTestConfig={speedTestConfig}
            speedTestHistory={speedTestHistory as SpeedTestHistoryEntry[]}
            speedTestResult={speedTestResult}
          />
        );

      case "config":
        return (
          <>
            <ProxyConfigPage
              allFilteredBypassSelected={allFilteredBypassSelected}
              busyAction={busyAction}
              bypassQuery={bypassQuery}
              filteredBypassItems={filteredBypassItems}
              onAddBypassItem={addBypassItem}
              onBypassQueryChange={setBypassQuery}
              onDeleteBypassItem={deleteBypassItem}
              onDeleteSelectedBypassItems={deleteSelectedBypassItems}
              onOpenGoogle={openGooglePage}
              onResetDefaults={resetDefaults}
              onSaveProfile={() => saveCurrentProfile("save-config")}
              onTestProxy={() =>
                void runAction(
                  "test",
                  () => testProxy({ ...profile, pacRules: rules }),
                  () => undefined,
                  "代理连接测试完成",
                  "代理测试完成",
                )
              }
              onToggleAllFilteredBypassItems={toggleAllFilteredBypassItems}
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
              onAddRule={addRule}
              onCopy={copyText}
              onDeleteRule={deleteRule}
              onDeleteSelectedRules={deleteSelectedRules}
              onPacTabChange={setActivePacTab}
              onQueryChange={setQuery}
              onResetRules={() => setPacResetConfirmOpen(true)}
              onToggleAllFilteredRules={toggleAllFilteredRules}
              onToggleRuleSelected={toggleRuleSelected}
              onUpdateRule={updateRule}
              pacUrl={pacUrl}
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
            onCopy={copyText}
            onOpenConfigDirectory={() => void handleOpenConfigDirectory()}
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
        description="当前 PAC 规则将被默认规则替换，并恢复已删除或停用的内置直连规则。此操作会覆盖你对规则列表所做的修改。"
        isOpen={isPacResetConfirmOpen}
        onCancel={() => setPacResetConfirmOpen(false)}
        onConfirm={confirmPacRulesReset}
        title="恢复默认 PAC 规则？"
      />
    </div>
  );
}
