import {
  Activity,
  AppWindow,
  ArrowDown,
  ArrowUp,
  Bike,
  CarFront,
  ExternalLink,
  Gauge,
  Globe2,
  Loader2,
  MapPin,
  Plane,
  RotateCcw,
  Rocket,
  Search,
  Send,
  Settings,
  TrainFront,
  X,
} from "lucide-react";
import {
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
} from "react";
import { ProxyIcon, quickSiteCategories, quickSites } from "../app/constants";
import { useTrafficMonitor } from "../components/data/TrafficMonitorProvider";
import { RollingText } from "../components/feedback/RollingText";
import { formatMbps, getSpeedLevel, speedLevelOptions } from "../lib/format";
import type {
  DirectIpFamily,
  DirectIpInfo,
  IpInfo,
  NetworkTrafficPoint,
  ProxyState,
  QuickSite,
  QuickSiteCategory,
  SpeedTestConfig,
  SpeedTestHistoryEntry,
  SpeedTestProgress,
  SpeedTestResult,
  SpeedTestTarget,
  TrafficMonitorCapability,
  TrafficMonitorSnapshot,
} from "../lib/types";

interface OverviewPageProps {
  effectiveState: ProxyState;
  pacUrl: string;
  overviewMode: string;
  animateModeValues: boolean;
  directIp: DirectIpInfo;
  proxyIp: IpInfo | null;
  proxyRuleCount: number;
  directRuleCount: number;
  disabledProxyRuleCount: number;
  disabledDirectRuleCount: number;
  speedTestConfig: SpeedTestConfig;
  speedTestHistory: SpeedTestHistoryEntry[];
  speedTestProgress: Partial<Record<SpeedTestTarget, SpeedTestProgress>>;
  speedTestResults: Partial<Record<SpeedTestTarget, SpeedTestResult>>;
  speedTestRunningTarget: SpeedTestTarget | null;
  isSpeedSettingsOpen: boolean;
  busyAction: string | null;
  activeSiteCategory: QuickSiteCategory;
  activeSiteCategoryIndex: number;
  filteredQuickSites: QuickSite[];
  failedSiteIcons: Set<string>;
  quickSiteIconUrls: Record<string, string>;
  onToggleSpeedSettings: () => void;
  onRunSpeedTest: (target: SpeedTestTarget) => void;
  onRefreshConnection: () => void;
  onRefreshDirectIp: () => void;
  onRefreshProxyIp: () => void;
  onRefreshPacSummary: () => void;
  onUpdateSpeedTestConfig: <K extends keyof SpeedTestConfig>(key: K, value: SpeedTestConfig[K]) => void;
  onRestoreSpeedTestConfig: () => void;
  onSiteCategoryChange: (category: QuickSiteCategory) => void;
  onSiteIconError: (siteId: string) => void;
  onOpenQuickSite: (site: QuickSite) => void;
  onCopy: (value: string | undefined, label: string) => void;
}

export function OverviewPage({
  effectiveState,
  pacUrl,
  overviewMode,
  animateModeValues,
  directIp,
  proxyIp,
  proxyRuleCount,
  directRuleCount,
  disabledProxyRuleCount,
  disabledDirectRuleCount,
  speedTestConfig,
  speedTestHistory,
  speedTestProgress,
  speedTestResults,
  speedTestRunningTarget,
  isSpeedSettingsOpen,
  busyAction,
  activeSiteCategory,
  activeSiteCategoryIndex,
  filteredQuickSites,
  failedSiteIcons,
  quickSiteIconUrls,
  onToggleSpeedSettings,
  onRunSpeedTest,
  onRefreshConnection,
  onRefreshDirectIp,
  onRefreshProxyIp,
  onRefreshPacSummary,
  onUpdateSpeedTestConfig,
  onRestoreSpeedTestConfig,
  onSiteCategoryChange,
  onSiteIconError,
  onOpenQuickSite,
  onCopy,
}: OverviewPageProps) {
  const [isQuickSiteSearchOpen, setQuickSiteSearchOpen] = useState(false);
  const [quickSiteQuery, setQuickSiteQuery] = useState("");
  const [directIpFamily, setDirectIpFamily] = useState<DirectIpFamily>("ipv4");
  const [speedTestTarget, setSpeedTestTarget] = useState<SpeedTestTarget>(effectiveState.mode === "off" ? "direct" : "proxy");
  const [hasSpeedTargetInteraction, setHasSpeedTargetInteraction] = useState(false);
  const quickSiteSearchRef = useRef<HTMLDivElement>(null);
  const quickSiteSearchInputRef = useRef<HTMLInputElement>(null);
  const pendingAutoSpeedTargetRef = useRef<SpeedTestTarget | null>(null);
  const normalizedQuickSiteQuery = quickSiteQuery.trim().toLocaleLowerCase();
  const quickSiteSearchMatches = useMemo(() => {
    if (!normalizedQuickSiteQuery) return [];
    return quickSites.filter((site) => {
      const categoryLabel = quickSiteCategories.find((category) => category.key === site.category)?.label ?? "";
      return [site.name, site.domain, categoryLabel].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuickSiteQuery),
      );
    });
  }, [normalizedQuickSiteQuery]);
  const visibleQuickSiteSearchMatches = quickSiteSearchMatches.slice(0, 8);

  useEffect(() => {
    pendingAutoSpeedTargetRef.current = null;
    setSpeedTestTarget(effectiveState.mode === "off" ? "direct" : "proxy");
  }, [effectiveState.mode]);

  useEffect(() => {
    if (directIp[directIpFamily]) return;
    const fallbackFamily: DirectIpFamily = directIpFamily === "ipv4" ? "ipv6" : "ipv4";
    if (directIp[fallbackFamily]) setDirectIpFamily(fallbackFamily);
  }, [directIp, directIpFamily]);

  useEffect(() => {
    const target = pendingAutoSpeedTargetRef.current;
    if (!target || target !== speedTestTarget || speedTestRunningTarget !== null) return;

    pendingAutoSpeedTargetRef.current = null;
    const hasSuccessfulResult =
      speedTestResults[target]?.ok === true ||
      speedTestHistory.some((entry) => entry.target === target && entry.ok);
    if (!hasSuccessfulResult && !speedTestProgress[target]) {
      onRunSpeedTest(target);
    }
  }, [onRunSpeedTest, speedTestHistory, speedTestProgress, speedTestResults, speedTestRunningTarget, speedTestTarget]);

  useEffect(() => {
    if (!isQuickSiteSearchOpen) return;
    quickSiteSearchInputRef.current?.focus();

    function closeOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !quickSiteSearchRef.current?.contains(event.target)) {
        closeQuickSiteSearch();
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeQuickSiteSearch();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isQuickSiteSearchOpen]);

  function closeQuickSiteSearch() {
    setQuickSiteSearchOpen(false);
    setQuickSiteQuery("");
  }

  function openQuickSiteSearchResult(site: QuickSite) {
    closeQuickSiteSearch();
    onOpenQuickSite(site);
  }

  function updateDownloadSize(value: string) {
    const megabytes = Math.min(50, Math.max(1, Number(value) || 1));
    const bytes = megabytes * 1024 * 1024;
    onUpdateSpeedTestConfig("downloadBytesLimit", bytes);
    if (/^https:\/\/speed\.cloudflare\.com\/__down\?bytes=\d+$/.test(speedTestConfig.downloadUrl)) {
      onUpdateSpeedTestConfig("downloadUrl", `https://speed.cloudflare.com/__down?bytes=${bytes}`);
    }
  }

  function selectSpeedTestTarget(target: SpeedTestTarget) {
    if (target === speedTestTarget) return;

    pendingAutoSpeedTargetRef.current = null;
    setHasSpeedTargetInteraction(true);
    setSpeedTestTarget(target);

    const hasSuccessfulResult =
      speedTestResults[target]?.ok === true ||
      speedTestHistory.some((entry) => entry.target === target && entry.ok);
    if (hasSuccessfulResult || speedTestProgress[target]) return;
    if (speedTestRunningTarget !== null) {
      pendingAutoSpeedTargetRef.current = target;
      return;
    }
    onRunSpeedTest(target);
  }

  const activeDownloadUrlKey = speedTestTarget === "proxy" ? "downloadUrl" : "directDownloadUrl";

  const speedTestResult = speedTestResults[speedTestTarget] ?? null;
  const currentSpeedProgress = speedTestProgress[speedTestTarget] ?? null;
  const latestSpeedResult = speedTestResult?.ok
    ? speedTestResult
    : speedTestHistory.find((entry) => entry.target === speedTestTarget && entry.ok);
  const displayedDownloadMbps = currentSpeedProgress?.downloadMbps ?? latestSpeedResult?.downloadMbps;
  const shouldResetSpeedMetrics = currentSpeedProgress?.elapsedMs === 0;
  const animatedDownloadMbps = useAnimatedMetricValue(displayedDownloadMbps, shouldResetSpeedMetrics);
  const displayedLatencyMs = currentSpeedProgress
    ? currentSpeedProgress.latencyMs
    : latestSpeedResult?.latencyMs;
  const animatedLatencyMs = useAnimatedMetricValue(displayedLatencyMs, shouldResetSpeedMetrics, 260);
  const speedLevel = getSpeedLevel(animatedDownloadMbps);
  const displayedDirectIp = directIp[directIpFamily] ?? null;
  const directIpFamilyLabel = directIpFamily === "ipv4" ? "IPv4" : "IPv6";
  const alternateDirectIpFamily: DirectIpFamily = directIpFamily === "ipv4" ? "ipv6" : "ipv4";
  const alternateDirectIpFamilyLabel = alternateDirectIpFamily === "ipv4" ? "IPv4" : "IPv6";
  const canSwitchDirectIpFamily = Boolean(directIp.ipv4 && directIp.ipv6);
  const isDirectIpRefreshing = busyAction === "refresh-ip" || busyAction === "refresh-direct-ip";
  const isProxyDisabled = effectiveState.mode === "off" || proxyIp?.source === "proxy-disabled";
  const proxySourceText =
    proxyIp?.source && proxyIp.source !== "mock" && !isProxyDisabled ? proxyIp.source : isProxyDisabled ? "代理未启用" : "代理出口";
  const directLocation = displayedDirectIp?.location || (isDirectIpRefreshing ? "正在获取位置..." : "位置未知");
  const directSourceText = displayedDirectIp?.source && !displayedDirectIp.source.startsWith("mock")
    ? displayedDirectIp.source
    : `${directIpFamilyLabel}本机出口`;
  const proxyLocation = isProxyDisabled
    ? ""
    : proxyIp?.location || "美国 加利福尼亚州 圣何塞";
  const pacRuleSummary = `代理 ${proxyRuleCount} / 直连 ${directRuleCount}`;
  const rollingModeOrder = modeOrder[effectiveState.mode];
  const connectionValue = effectiveState.mode === "pac" ? pacUrl : effectiveState.address;
  const connectionLabel = effectiveState.mode === "pac" ? "PAC地址" : "代理地址";
  const connectionFallback = effectiveState.mode === "pac" ? "未设置PAC地址" : "未设置代理地址";
  return (
    <section className="overview-panel">
      <section className="panel overview-card connection-card">
        <div className="overview-card-top">
          <span>链接状态</span>
          <button
            className="overview-card-icon refresh-card-button success"
            disabled={busyAction !== null}
            onClick={onRefreshConnection}
            title="刷新连接状态"
            type="button"
          >
            {busyAction === "refresh-connection" ? <Loader2 className="spin" size={18} /> : <ProxyIcon size={18} />}
          </button>
        </div>
        <CopyableCardValue
          animate={animateModeValues}
          label="代理状态"
          onCopy={onCopy}
          order={rollingModeOrder}
          sizerValue="PAC自动代理"
          value={overviewMode}
          variant="main"
        />
        <CopyableCardValue
          animate={animateModeValues}
          fallback={connectionFallback}
          label={connectionLabel}
          onCopy={onCopy}
          order={rollingModeOrder}
          value={connectionValue}
          variant="muted"
        />
        <div className="overview-card-foot">
          <i />
          <span>连接正常</span>
        </div>
      </section>
      <section className="panel overview-card ip-overview-card">
        <div className="overview-card-top">
          <div className="ip-card-title">
            <span>我的IP</span>
            <button
              aria-label={canSwitchDirectIpFamily ? `切换到${alternateDirectIpFamilyLabel}` : `当前仅检测到${directIpFamilyLabel}`}
              className="ip-family-toggle"
              disabled={!canSwitchDirectIpFamily}
              onClick={() => setDirectIpFamily(alternateDirectIpFamily)}
              title={canSwitchDirectIpFamily ? `点击切换到${alternateDirectIpFamilyLabel}` : `当前仅检测到${directIpFamilyLabel}`}
              type="button"
            >
              {directIpFamilyLabel}
            </button>
          </div>
          <button
            className="overview-card-icon refresh-card-button"
            disabled={busyAction !== null}
            onClick={onRefreshDirectIp}
            title="刷新我的IP"
            type="button"
          >
            {isDirectIpRefreshing ? <Loader2 className="spin" size={18} /> : <MapPin size={18} />}
          </button>
        </div>
        <CopyableCardValue
          fallback={isDirectIpRefreshing ? `正在检测${directIpFamilyLabel}...` : `未检测到${directIpFamilyLabel}`}
          label={`我的${directIpFamilyLabel}`}
          onCopy={onCopy}
          value={displayedDirectIp?.ip}
          variant="main"
        />
        <CopyableCardValue label={`${directIpFamilyLabel}位置`} onCopy={onCopy} value={directLocation} variant="muted" />
        <IpCardMeta
          copyLabel={`${directIpFamilyLabel}来源`}
          latencyMs={displayedDirectIp?.latencyMs}
          onCopy={onCopy}
          source={directSourceText}
        />
      </section>
      <section className="panel overview-card ip-overview-card">
        <div className="overview-card-top">
          <span>代理IP</span>
          <button
            className="overview-card-icon refresh-card-button violet"
            disabled={busyAction !== null}
            onClick={onRefreshProxyIp}
            title="刷新代理IP"
            type="button"
          >
            {busyAction === "refresh-proxy-ip" ? <Loader2 className="spin" size={18} /> : <ProxyIcon size={18} />}
          </button>
        </div>
        <CopyableCardValue
          animate={animateModeValues}
          fallback={isProxyDisabled ? "代理已关闭" : "198.51.100.23"}
          label="代理IP"
          onCopy={onCopy}
          order={rollingModeOrder}
          value={isProxyDisabled ? undefined : proxyIp?.ip}
          variant="main"
        />
        <CopyableCardValue
          animate={animateModeValues}
          label="代理位置"
          onCopy={onCopy}
          order={rollingModeOrder}
          sizerValue="美国 加利福尼亚州 圣何塞"
          value={proxyLocation}
          variant="muted"
        />
        <IpCardMeta
          animate={animateModeValues}
          copyLabel="代理IP来源"
          latencyMs={isProxyDisabled ? undefined : proxyIp?.latencyMs}
          onCopy={onCopy}
          order={rollingModeOrder}
          source={proxySourceText}
        />
      </section>
      <section className="panel overview-card pac-summary-card">
        <div className="overview-card-top">
          <span>PAC规则</span>
          <button
            className="overview-card-icon refresh-card-button amber"
            disabled={busyAction !== null}
            onClick={onRefreshPacSummary}
            title="刷新PAC规则"
            type="button"
          >
            {busyAction === "refresh-pac-summary" ? <Loader2 className="spin" size={18} /> : <Globe2 size={18} />}
          </button>
        </div>
        <CopyableCardValue label="代理规则数量" onCopy={onCopy} value={String(proxyRuleCount)} variant="main" />
        <CopyableCardValue label="PAC规则统计" onCopy={onCopy} value={pacRuleSummary} variant="muted" />
        <div className="pac-disabled-summary">
          停用：代理 {disabledProxyRuleCount} / 直连 {disabledDirectRuleCount}
        </div>
      </section>
      <section className={`panel overview-card overview-card-wide speed-card${isSpeedSettingsOpen ? " speed-card-open" : ""}`}>
        <div className="overview-card-top">
          <span>网络测速</span>
          <div className="overview-card-actions speed-card-actions">
            <div
              aria-label="测速线路"
              className={`speed-target-switch${hasSpeedTargetInteraction || animateModeValues ? " is-animated" : ""}`}
              role="radiogroup"
              style={{ "--speed-target-index": speedTestTarget === "proxy" ? 0 : 1 } as CSSProperties}
            >
              <span className="speed-target-indicator" aria-hidden="true" />
              <button
                aria-checked={speedTestTarget === "proxy"}
                className={speedTestTarget === "proxy" ? "active" : ""}
                onClick={() => selectSpeedTestTarget("proxy")}
                role="radio"
                title="通过已配置的代理测速"
                type="button"
              >
                代理测速
              </button>
              <button
                aria-checked={speedTestTarget === "direct"}
                className={speedTestTarget === "direct" ? "active" : ""}
                onClick={() => selectSpeedTestTarget("direct")}
                role="radio"
                title="绕过代理直接连接测速"
                type="button"
              >
                直连测速
              </button>
            </div>
            <button
              className="overview-icon-button speed-tool-button speed-settings-toggle"
              onClick={onToggleSpeedSettings}
              title="设置测速地址"
              type="button"
            >
              <Settings size={16} />
            </button>
            <div className="overview-card-icon success speed-status-icon">
              <Gauge size={18} />
            </div>
          </div>
        </div>
        <div className="speed-orbs">
          <div className="speed-orb">
            <span>延迟</span>
            <strong className={currentSpeedProgress ? "speed-live-value" : undefined}>
              {typeof animatedLatencyMs === "number" ? `${Math.round(animatedLatencyMs)}ms` : "--"}
            </strong>
          </div>
          <div className="speed-orb">
            <span>下行</span>
            <strong className={currentSpeedProgress ? "speed-live-value" : undefined}>
              {typeof animatedDownloadMbps === "number" ? formatMbps(animatedDownloadMbps) : "--"}
            </strong>
          </div>
          <button
            className="speed-test-orb"
            disabled={speedTestRunningTarget !== null}
            onClick={() => onRunSpeedTest(speedTestTarget)}
          >
            {speedTestRunningTarget !== null ? <Loader2 className="spin" size={21} /> : <Send size={21} />}
            <span>{speedTestRunningTarget !== null ? "测速中" : "开始测速"}</span>
          </button>
        </div>
        <span className="speed-level-watermark" data-rank={speedLevel.rank} aria-hidden="true">
          <SpeedLevelIcon rank={speedLevel.rank} size={320} />
        </span>
        <span
          aria-describedby="speed-level-tooltip"
          aria-label="查看速度参考说明"
          className="speed-level-trigger"
          tabIndex={0}
        >
          <span className="speed-level-icon" data-rank={speedLevel.rank} aria-hidden="true">
            <SpeedLevelIcon rank={speedLevel.rank} size={18} />
          </span>
          <span className="speed-level-tooltip" id="speed-level-tooltip" role="tooltip">
            <span className="speed-level-tooltip-head">
              <span className="speed-level-tooltip-title">速度参考</span>
              <span className="speed-level-tooltip-hint">由慢到快</span>
            </span>
            <span className="speed-level-tooltip-list">
              {speedLevelOptions.map((option) => (
                <span
                  className={speedLevel.rank === option.rank ? "speed-level-tooltip-item is-active" : "speed-level-tooltip-item"}
                  data-rank={option.rank}
                  key={option.rank}
                >
                  <span className="speed-level-tooltip-icon" aria-hidden="true">
                    <SpeedLevelIcon rank={option.rank} size={16} />
                  </span>
                  <span className="speed-level-tooltip-range">{option.range}</span>
                  <span className="speed-level-tooltip-description">{option.description}</span>
                </span>
              ))}
            </span>
          </span>
        </span>
        {speedTestResult?.ok === false ? (
          <div className="speed-card-footer">
            <div className="speed-summary">
              <span className="speed-message error">{speedTestResult.message}</span>
            </div>
          </div>
        ) : null}
        {isSpeedSettingsOpen ? (
          <div className="speed-settings-popover">
            <label>
              {speedTestTarget === "proxy" ? "代理下载测速地址" : "直连下载测速地址"}
              <input
                value={speedTestConfig[activeDownloadUrlKey]}
                onChange={(event) => onUpdateSpeedTestConfig(activeDownloadUrlKey, event.target.value)}
              />
            </label>
            <label>
              下载大小(MB)
              <input
                max={50}
                min={1}
                type="number"
                value={Math.round(speedTestConfig.downloadBytesLimit / 1024 / 1024)}
                onChange={(event) => updateDownloadSize(event.target.value)}
              />
            </label>
            <button className="outline compact-setting" onClick={onRestoreSpeedTestConfig}>
              <RotateCcw size={16} />
              恢复默认
            </button>
          </div>
        ) : null}
      </section>
      <section className="panel overview-card overview-card-wide quick-sites-card">
        <div className="overview-card-top quick-site-card-head">
          <span className="quick-site-card-title">快捷网站</span>
          <div className="quick-site-head-controls">
            <div
              aria-label="快捷网站分类"
              className="quick-site-tabs"
              role="group"
              style={
                {
                  "--quick-site-count": quickSiteCategories.length,
                  "--quick-site-index": activeSiteCategoryIndex,
                } as CSSProperties
              }
            >
              <span className="quick-site-tab-indicator" aria-hidden="true" />
              {quickSiteCategories.map((category) => (
                <button
                  aria-pressed={activeSiteCategory === category.key}
                  className={activeSiteCategory === category.key ? "active" : ""}
                  key={category.key}
                  onClick={() => onSiteCategoryChange(category.key)}
                  type="button"
                >
                  {category.label}
                </button>
              ))}
            </div>
            <div className="quick-site-search-shell" ref={quickSiteSearchRef}>
              <button
                aria-expanded={isQuickSiteSearchOpen}
                aria-label={isQuickSiteSearchOpen ? "关闭网站搜索" : "搜索全部快捷网站"}
                className={`overview-icon-button quick-site-search-button${isQuickSiteSearchOpen ? " active" : ""}`}
                onClick={() => {
                  if (isQuickSiteSearchOpen) {
                    closeQuickSiteSearch();
                    return;
                  }
                  setQuickSiteSearchOpen(true);
                }}
                title="搜索全部快捷网站"
                type="button"
              >
                {isQuickSiteSearchOpen ? <X size={17} /> : <Search size={17} />}
              </button>
              {isQuickSiteSearchOpen ? (
                <div className="quick-site-search-popover">
                  <label className="quick-site-search-field">
                    <Search aria-hidden="true" size={17} />
                    <input
                      aria-label="搜索网站名称或域名"
                      onChange={(event) => setQuickSiteQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && visibleQuickSiteSearchMatches[0]) {
                          openQuickSiteSearchResult(visibleQuickSiteSearchMatches[0]);
                        }
                      }}
                      placeholder="搜索网站名称或域名"
                      ref={quickSiteSearchInputRef}
                      value={quickSiteQuery}
                    />
                    {quickSiteQuery ? (
                      <button
                        aria-label="清空搜索"
                        className="quick-site-search-clear"
                        onClick={() => {
                          setQuickSiteQuery("");
                          quickSiteSearchInputRef.current?.focus();
                        }}
                        type="button"
                      >
                        <X size={14} />
                      </button>
                    ) : null}
                  </label>
                  <div className="quick-site-search-meta">
                    <span>
                      {normalizedQuickSiteQuery
                        ? quickSiteSearchMatches.length > visibleQuickSiteSearchMatches.length
                          ? `找到 ${quickSiteSearchMatches.length} 个，显示前 ${visibleQuickSiteSearchMatches.length} 个`
                          : `找到 ${quickSiteSearchMatches.length} 个网站`
                        : `可搜索全部 ${quickSites.length} 个网站`}
                    </span>
                    <kbd>ESC</kbd>
                  </div>
                  {normalizedQuickSiteQuery ? (
                    visibleQuickSiteSearchMatches.length > 0 ? (
                      <div className="quick-site-search-results">
                        {visibleQuickSiteSearchMatches.map((site) => (
                          <button
                            className="quick-site-search-result"
                            key={site.id}
                            onClick={() => openQuickSiteSearchResult(site)}
                            type="button"
                          >
                            {!failedSiteIcons.has(site.id) ? (
                              <img
                                alt=""
                                className="quick-site-search-result-icon"
                                onError={() => onSiteIconError(site.id)}
                                onLoad={normalizeQuickSiteIcon}
                                src={quickSiteIconUrls[site.id] ?? site.faviconUrl}
                              />
                            ) : (
                              <span className="quick-site-search-result-mark">
                                {site.name.slice(0, 1).toUpperCase()}
                              </span>
                            )}
                            <span className="quick-site-search-result-copy">
                              <strong>{site.name}</strong>
                              <small>{site.domain}</small>
                            </span>
                            <span className="quick-site-search-result-category">
                              {quickSiteCategories.find((category) => category.key === site.category)?.label}
                            </span>
                            <ExternalLink aria-hidden="true" size={14} />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="quick-site-search-empty">没有找到匹配的网站</div>
                    )
                  ) : (
                    <div className="quick-site-search-hint">输入关键词后，按 Enter 可直接打开第一个结果</div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="quick-site-grid">
          {filteredQuickSites.map((site, index) => (
            <button
              aria-label={`${site.name} · ${site.domain}`}
              className={`quick-site-button ${quickSiteTooltipClass(index, filteredQuickSites.length)}`}
              key={site.id}
              onClick={() => onOpenQuickSite(site)}
            >
              {!failedSiteIcons.has(site.id) && quickSiteIconUrls[site.id] ? (
                <img
                  alt=""
                  src={quickSiteIconUrls[site.id]}
                  onError={() => onSiteIconError(site.id)}
                  onLoad={normalizeQuickSiteIcon}
                />
              ) : (
                <span className="quick-site-fallback">{site.name.slice(0, 1).toUpperCase()}</span>
              )}
              <span className="quick-site-tooltip">
                <strong>{site.name}</strong>
                <small>{site.domain}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
      <TrafficMonitorSection />
    </section>
  );
}

function useAnimatedMetricValue(value: number | undefined, resetImmediately: boolean, durationMs = 180) {
  const [displayedValue, setDisplayedValue] = useState(value);
  const displayedValueRef = useRef(value);

  useEffect(() => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      displayedValueRef.current = undefined;
      setDisplayedValue(undefined);
      return;
    }

    if (resetImmediately || typeof displayedValueRef.current !== "number") {
      displayedValueRef.current = value;
      setDisplayedValue(value);
      return;
    }

    const from = displayedValueRef.current;
    const difference = value - from;
    if (Math.abs(difference) < 0.01) {
      displayedValueRef.current = value;
      setDisplayedValue(value);
      return;
    }

    const startedAt = performance.now();
    let animationFrame = 0;
    const animate = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - startedAt) / durationMs);
      const easedProgress = 1 - (1 - progress) ** 3;
      const nextValue = from + difference * easedProgress;
      displayedValueRef.current = nextValue;
      setDisplayedValue(nextValue);
      if (progress < 1) animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [resetImmediately, value]);

  return resetImmediately ? value : displayedValue;
}

function SpeedLevelIcon({ rank, size }: { rank: number; size: number }) {
  if (rank <= 0) return <Gauge aria-hidden="true" size={size} />;
  if (rank === 1) return <Bike aria-hidden="true" size={size} />;
  if (rank === 2) return <MotorcycleIcon size={size} />;
  if (rank === 3) return <CarFront aria-hidden="true" size={size} />;
  if (rank === 4) return <TrainFront aria-hidden="true" size={size} />;
  if (rank === 5) return <Plane aria-hidden="true" size={size} />;
  return <Rocket aria-hidden="true" size={size} />;
}

function MotorcycleIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <circle cx="5" cy="17" r="3" />
      <circle cx="19" cy="17" r="3" />
      <path d="M8 17h4l3-6h3l1 3" />
      <path d="m12 17-3-7H6" />
      <path d="M10 11h5" />
      <path d="M16 8h3" />
    </svg>
  );
}

interface TrafficMonitorCardProps {
  chartId: string;
  title: string;
  subtitle: string;
  tooltip: string;
  points: NetworkTrafficPoint[];
  error: string | null;
  monitorEnabled: boolean;
  monitorToggling: boolean;
  onMonitorToggle: () => void;
  totalDownloadBytes: number;
  totalUploadBytes: number;
}

function TrafficMonitorSection() {
  const traffic = useTrafficMonitor();
  return (
    <div className="traffic-monitor-grid">
      <TrafficMonitorCard
        chartId="network"
        error={traffic.networkError}
        monitorEnabled={traffic.networkEnabled}
        monitorToggling={false}
        onMonitorToggle={traffic.toggleNetwork}
        points={traffic.networkPoints}
        subtitle="系统网卡实时曲线 · 最近 60 秒"
        title="实时流量"
        tooltip="每秒读取一次系统网卡收发流量"
        totalDownloadBytes={traffic.networkDownloadBytes}
        totalUploadBytes={traffic.networkUploadBytes}
      />
      <MemoizedApplicationTrafficPanel
        capability={traffic.applicationCapability}
        applicationIconUrls={traffic.applicationIconUrls}
        failedApplicationIcons={traffic.failedApplicationIcons}
        monitorEnabled={traffic.applicationEnabled}
        monitorToggling={traffic.applicationToggling}
        onApplicationIconError={traffic.onApplicationIconError}
        onMonitorToggle={traffic.toggleApplication}
        snapshot={traffic.applicationSnapshot}
      />
    </div>
  );
}

function TrafficMonitorCard({
  chartId,
  title,
  subtitle,
  tooltip,
  points,
  error,
  monitorEnabled,
  monitorToggling,
  onMonitorToggle,
  totalDownloadBytes,
  totalUploadBytes,
}: TrafficMonitorCardProps) {
  const latestPoint = points.at(-1);
  let peakDownloadRate = 0;
  let peakUploadRate = 0;
  for (const point of points) {
    peakDownloadRate = Math.max(peakDownloadRate, point.downloadBytesPerSecond);
    peakUploadRate = Math.max(peakUploadRate, point.uploadBytesPerSecond);
  }
  const scaleMax = Math.max(32 * 1024, peakDownloadRate, peakUploadRate) * 1.12;
  const downloadCoordinates = trafficCoordinates(points, "downloadBytesPerSecond", scaleMax);
  const uploadCoordinates = trafficCoordinates(points, "uploadBytesPerSecond", scaleMax);
  const downloadPath = trafficCurvePath(downloadCoordinates);
  const uploadPath = trafficCurvePath(uploadCoordinates);
  const downloadArea = trafficAreaPath(downloadCoordinates);
  const uploadArea = trafficAreaPath(uploadCoordinates);
  const statusClass = !monitorEnabled ? " idle" : error ? " error" : "";
  const statusText = monitorToggling
    ? monitorEnabled ? "正在启动" : "正在关闭"
    : !monitorEnabled
    ? "监控已关闭"
    : error
      ? "采样异常"
      : points.length > 0 ? "实时监控" : "正在采样";
  const emptyText = !monitorEnabled ? "流量监控已关闭" : error ?? "正在建立采样基线…";
  const downloadFillId = `traffic-${chartId}-download-fill`;
  const uploadFillId = `traffic-${chartId}-upload-fill`;

  return (
    <section className="panel overview-card traffic-monitor-card">
      <div className="overview-card-top traffic-monitor-head">
        <div className="traffic-monitor-title">
          <span>{title}</span>
          <small>{subtitle}</small>
        </div>
        <div className="traffic-monitor-actions">
          <button
            aria-label={`${monitorEnabled ? "关闭" : "开启"}${title}`}
            aria-pressed={monitorEnabled}
            className={`traffic-live-status traffic-monitor-toggle${statusClass}`}
            disabled={monitorToggling}
            onClick={onMonitorToggle}
            title={monitorEnabled ? `${error ?? tooltip}，点击关闭` : `点击开启${title}`}
            type="button"
          >
            <i />
            <Activity size={15} />
            <span>{statusText}</span>
          </button>
        </div>
      </div>
      <div className="traffic-system-pane">
        <div className="traffic-metrics">
          <div className="traffic-metric download">
            <span><ArrowDown size={17} />下行</span>
            <strong>{formatTrafficRate(latestPoint?.downloadBytesPerSecond)}</strong>
            <small className="traffic-metric-details">
              <span>峰值 {formatTrafficRate(peakDownloadRate)}</span>
              <span>累计 {formatTrafficBytes(totalDownloadBytes)}</span>
            </small>
          </div>
          <div className="traffic-metric upload">
            <span><ArrowUp size={17} />上行</span>
            <strong>{formatTrafficRate(latestPoint?.uploadBytesPerSecond)}</strong>
            <small className="traffic-metric-details">
              <span>峰值 {formatTrafficRate(peakUploadRate)}</span>
              <span>累计 {formatTrafficBytes(totalUploadBytes)}</span>
            </small>
          </div>
        </div>
        <div className="traffic-chart-wrap">
          <div className="traffic-chart-scale">
            <span>{formatTrafficRate(scaleMax)}</span>
            <span>{formatTrafficRate(scaleMax / 2)}</span>
            <span>0 B/s</span>
          </div>
          <div className="traffic-chart-canvas">
            <svg aria-label={`${title}最近60秒实时上行和下行`} preserveAspectRatio="none" role="img" viewBox="0 0 1000 220">
              <defs>
                <linearGradient id={downloadFillId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgb(15 107 255)" stopOpacity="0.24" />
                  <stop offset="100%" stopColor="rgb(15 107 255)" stopOpacity="0.01" />
                </linearGradient>
                <linearGradient id={uploadFillId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgb(16 167 107)" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="rgb(16 167 107)" stopOpacity="0.01" />
                </linearGradient>
              </defs>
              {[18, 79, 140, 201].map((y) => (
                <line className="traffic-grid-line" key={y} x1="0" x2="1000" y1={y} y2={y} />
              ))}
              {[0, 200, 400, 600, 800, 1000].map((x) => (
                <line className="traffic-grid-line vertical" key={x} x1={x} x2={x} y1="18" y2="201" />
              ))}
              {downloadArea ? <path d={downloadArea} fill={`url(#${downloadFillId})`} /> : null}
              {uploadArea ? <path d={uploadArea} fill={`url(#${uploadFillId})`} /> : null}
              {downloadPath ? <path className="traffic-line download" d={downloadPath} /> : null}
              {uploadPath ? <path className="traffic-line upload" d={uploadPath} /> : null}
            </svg>
            {points.length === 0 ? (
              <div className={`traffic-chart-empty${error ? " error" : ""}`}>{emptyText}</div>
            ) : null}
          </div>
          <div className="traffic-chart-footer">
            <span>60 秒前</span>
            <div className="traffic-chart-legend">
              <span className="download"><i />下行</span>
              <span className="upload"><i />上行</span>
            </div>
            <span>现在</span>
          </div>
        </div>
      </div>
    </section>
  );
}

interface ApplicationTrafficPanelProps {
  capability: TrafficMonitorCapability | null;
  applicationIconUrls: Record<string, string>;
  failedApplicationIcons: Set<string>;
  monitorEnabled: boolean;
  monitorToggling: boolean;
  onApplicationIconError: (applicationId: string) => void;
  onMonitorToggle: () => void;
  snapshot: TrafficMonitorSnapshot;
}

function ApplicationTrafficPanel({
  capability,
  applicationIconUrls,
  failedApplicationIcons,
  monitorEnabled,
  monitorToggling,
  onApplicationIconError,
  onMonitorToggle,
  snapshot,
}: ApplicationTrafficPanelProps) {
  const applications = snapshot.applications;
  let applicationDownloadBytes = 0;
  let applicationUploadBytes = 0;
  for (const application of applications) {
    applicationDownloadBytes += application.downloadBytes;
    applicationUploadBytes += application.uploadBytes;
  }
  const largestTotal = Math.max(1, ...applications.map((application) => application.totalBytes));
  const snapshotUpdatedTime = snapshot.updatedAtMs > 0
    ? new Date(snapshot.updatedAtMs).toLocaleTimeString("zh-CN", { hour12: false })
    : null;
  const monitorStatusClass = !monitorEnabled ? " idle" : snapshot.status === "error" ? " error" : "";
  const monitorStatusText = monitorToggling
    ? monitorEnabled ? "正在启动" : "正在关闭"
    : !monitorEnabled
      ? "应用监控已关闭"
      : snapshot.status === "error" ? "采集异常" : `${applications.length} 个应用监控中`;

  function handleListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const list = event.currentTarget;
    if (list.scrollHeight <= list.clientHeight) return;

    let nextTop: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        nextTop = list.scrollTop + 55;
        break;
      case "ArrowUp":
        nextTop = list.scrollTop - 55;
        break;
      case "PageDown":
        nextTop = list.scrollTop + list.clientHeight;
        break;
      case "PageUp":
        nextTop = list.scrollTop - list.clientHeight;
        break;
      case "Home":
        nextTop = 0;
        break;
      case "End":
        nextTop = list.scrollHeight;
        break;
      default:
        return;
    }
    event.preventDefault();
    list.scrollTo({ top: nextTop });
  }

  let emptyText = snapshot.error ?? "等待应用产生网络流量…";
  if (!monitorEnabled) {
    emptyText = snapshot.error ?? "开启监控后统计各应用本次使用的流量";
  } else if (capability === null) {
    emptyText = "正在检测当前平台的应用流量统计能力…";
  } else if (!capability.supported) {
    emptyText = `${capability.reason ?? "当前平台暂不支持按应用统计流量"}，系统总流量仍可正常监控`;
  } else if (snapshot.status === "starting") {
    emptyText = "正在启动应用采集…本次运行首次开启可能需要管理员授权";
  } else if (snapshot.status === "idle") {
    emptyText = snapshot.error ?? "应用采集器未运行，请关闭监控后重试";
  } else if (snapshot.status === "error") {
    emptyText = snapshot.error ?? "应用流量采集器已停止，请关闭监控后重试";
  }

  return (
    <section className="panel overview-card application-traffic-card" aria-label="应用流量">
      <div className="overview-card-top application-traffic-head">
        <div>
          <strong>应用流量</strong>
          <small>
            自开启监控后累计
            {snapshotUpdatedTime ? ` · ${snapshotUpdatedTime}` : ""}
          </small>
        </div>
        <div className="application-traffic-actions">
          <span
            aria-label={`累计下载 ${formatTrafficBytes(applicationDownloadBytes)}，累计上传 ${formatTrafficBytes(applicationUploadBytes)}`}
            className="application-traffic-total"
            role="group"
          >
            <span className="download" aria-label={`累计下载 ${formatTrafficBytes(applicationDownloadBytes)}`}>
              <ArrowDown aria-hidden="true" size={12} />
              <b>{formatTrafficBytes(applicationDownloadBytes)}</b>
            </span>
            <i aria-hidden="true" />
            <span className="upload" aria-label={`累计上传 ${formatTrafficBytes(applicationUploadBytes)}`}>
              <ArrowUp aria-hidden="true" size={12} />
              <b>{formatTrafficBytes(applicationUploadBytes)}</b>
            </span>
          </span>
          <button
            aria-label={`${monitorEnabled ? "关闭" : "开启"}应用流量监控`}
            aria-pressed={monitorEnabled}
            className={`traffic-live-status traffic-monitor-toggle${monitorStatusClass}`}
            disabled={monitorToggling}
            onClick={onMonitorToggle}
            title={monitorEnabled ? "关闭应用流量详细统计" : "开启应用流量详细统计，本次运行首次开启需要管理员授权"}
            type="button"
          >
            <i />
            <Activity size={14} />
            <span>{monitorStatusText}</span>
          </button>
        </div>
      </div>
      {snapshot.error && applications.length > 0 ? (
        <div className="application-traffic-error" role="status">{snapshot.error}</div>
      ) : null}
      <div
        aria-label={applications.length > 5 ? "全部应用流量，可滚动" : "全部应用流量"}
        className="application-traffic-list"
        onKeyDown={applications.length > 5 ? handleListKeyDown : undefined}
        tabIndex={applications.length > 5 ? 0 : undefined}
      >
        {applications.length > 0 ? applications.map((application) => {
          const totalRatio = Math.max(0.025, application.totalBytes / largestTotal);
          const downloadRatio = application.totalBytes > 0 ? application.downloadBytes / application.totalBytes : 0;
          const iconUrl = applicationIconUrls[application.id];
          const showIcon = iconUrl && !failedApplicationIcons.has(application.id);
          return (
            <div className="application-traffic-row" key={application.id}>
              <div className="application-traffic-icon" aria-hidden="true">
                {showIcon ? <img alt="" onError={() => onApplicationIconError(application.id)} src={iconUrl} /> : application.id === "system-unknown" ? (
                  <AppWindow size={17} />
                ) : (
                  <span>{application.name.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="application-traffic-copy">
                <div className="application-traffic-name-line">
                  <strong title={application.name}>{application.name}</strong>
                  <span>{formatTrafficBytes(application.totalBytes)}</span>
                </div>
                <div className="application-traffic-breakdown">
                  <span className="download"><ArrowDown size={12} />{formatTrafficBytes(application.downloadBytes)}</span>
                  <span className="upload"><ArrowUp size={12} />{formatTrafficBytes(application.uploadBytes)}</span>
                  <span>{application.processCount > 0 ? `${application.processCount} 个进程` : "已退出"}</span>
                </div>
                <div className="application-traffic-bar" aria-hidden="true">
                  <span className="application-traffic-bar-total" style={{ width: `${totalRatio * 100}%` }}>
                    <i className="download" style={{ width: `${downloadRatio * 100}%` }} />
                    <i className="upload" style={{ width: `${(1 - downloadRatio) * 100}%` }} />
                  </span>
                </div>
              </div>
            </div>
          );
        }) : <div className="application-traffic-empty">{emptyText}</div>}
      </div>
    </section>
  );
}

const MemoizedApplicationTrafficPanel = memo(ApplicationTrafficPanel);

type TrafficRateKey = "downloadBytesPerSecond" | "uploadBytesPerSecond";

function trafficCoordinates(points: NetworkTrafficPoint[], key: TrafficRateKey, maxRate: number) {
  const chartTop = 18;
  const chartBottom = 201;
  const chartHeight = chartBottom - chartTop;
  return points.map((point, index) => {
    const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * 1000;
    const ratio = Math.min(Math.max(point[key] / maxRate, 0), 1);
    return [x, chartBottom - ratio * chartHeight] as const;
  });
}

function trafficAreaPath(coordinates: ReadonlyArray<readonly [number, number]>) {
  if (coordinates.length === 0) return "";
  const curve = trafficCurvePath(coordinates);
  const firstX = coordinates[0]?.[0] ?? 0;
  const lastX = coordinates.at(-1)?.[0] ?? 0;
  return `${curve} L ${lastX.toFixed(2)} 201 L ${firstX.toFixed(2)} 201 Z`;
}

function trafficCurvePath(coordinates: ReadonlyArray<readonly [number, number]>) {
  if (coordinates.length === 0) return "";
  const [startX, startY] = coordinates[0];
  if (coordinates.length === 1) return `M ${startX.toFixed(2)} ${startY.toFixed(2)}`;

  const commands = [`M ${startX.toFixed(2)} ${startY.toFixed(2)}`];
  for (let index = 1; index < coordinates.length; index += 1) {
    const previousPrevious = coordinates[index - 2] ?? coordinates[index - 1];
    const previous = coordinates[index - 1];
    const current = coordinates[index];
    const next = coordinates[index + 1] ?? current;
    const control1X = previous[0] + (current[0] - previousPrevious[0]) / 6;
    const control1Y = clampTrafficChartY(previous[1] + (current[1] - previousPrevious[1]) / 6);
    const control2X = current[0] - (next[0] - previous[0]) / 6;
    const control2Y = clampTrafficChartY(current[1] - (next[1] - previous[1]) / 6);
    commands.push(
      `C ${control1X.toFixed(2)} ${control1Y.toFixed(2)}, ${control2X.toFixed(2)} ${control2Y.toFixed(2)}, ${current[0].toFixed(2)} ${current[1].toFixed(2)}`,
    );
  }
  return commands.join(" ");
}

function clampTrafficChartY(value: number) {
  return Math.min(Math.max(value, 18), 201);
}

function formatTrafficRate(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "0 B/s";
  if (value >= 1024 * 1024) {
    const megabytes = value / 1024 / 1024;
    return `${megabytes >= 10 ? megabytes.toFixed(1) : megabytes.toFixed(2)} MB/s`;
  }
  if (value >= 1024) {
    const kilobytes = value / 1024;
    return `${kilobytes >= 100 ? kilobytes.toFixed(0) : kilobytes.toFixed(1)} KB/s`;
  }
  return `${Math.round(value)} B/s`;
}

function formatTrafficBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** unitIndex;
  const digits = scaled >= 100 || unitIndex === 0 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)} ${units[unitIndex]}`;
}

function quickSiteTooltipClass(index: number, itemCount: number) {
  const column = index % 7;
  const horizontalClass =
    column <= 1 ? "tooltip-start" : column >= 5 || index >= itemCount - 1 ? "tooltip-end" : "tooltip-center";
  return index < 7 ? `${horizontalClass} tooltip-bottom` : horizontalClass;
}

function normalizeQuickSiteIcon(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget;
  const source = image.currentSrc || image.src;
  if (image.dataset.normalizedSource === source) return;

  image.dataset.normalizedSource = source;
  image.style.setProperty("--quick-site-icon-scale", "1");

  try {
    const sampleSize = 64;
    const canvas = document.createElement("canvas");
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;

    const fittedScale = Math.min(sampleSize / image.naturalWidth, sampleSize / image.naturalHeight);
    const width = image.naturalWidth * fittedScale;
    const height = image.naturalHeight * fittedScale;
    context.clearRect(0, 0, sampleSize, sampleSize);
    context.drawImage(image, (sampleSize - width) / 2, (sampleSize - height) / 2, width, height);

    const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
    const cornerOffsets = [0, sampleSize - 1, sampleSize * (sampleSize - 1), sampleSize * sampleSize - 1];
    const corners = cornerOffsets.map((pixelIndex) => {
      const offset = pixelIndex * 4;
      return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]] as const;
    });
    const averageCorner = corners.reduce<[number, number, number, number]>(
      (average, corner) => [
        average[0] + corner[0] / corners.length,
        average[1] + corner[1] / corners.length,
        average[2] + corner[2] / corners.length,
        average[3] + corner[3] / corners.length,
      ],
      [0, 0, 0, 0],
    );
    const cornerSpread = Math.max(
      ...corners.flatMap((corner) => corner.slice(0, 3).map((value, index) => Math.abs(value - averageCorner[index]))),
    );
    const hasPlainLightBackground =
      corners.every((corner) => corner[3] >= 245) &&
      cornerSpread <= 18 &&
      Math.min(...averageCorner.slice(0, 3)) >= 225;

    let minX = sampleSize;
    let minY = sampleSize;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < sampleSize; y += 1) {
      for (let x = 0; x < sampleSize; x += 1) {
        const offset = (y * sampleSize + x) * 4;
        const alpha = pixels[offset + 3];
        if (alpha <= 24) continue;
        if (hasPlainLightBackground) {
          const colorDistance = Math.max(
            Math.abs(pixels[offset] - averageCorner[0]),
            Math.abs(pixels[offset + 1] - averageCorner[1]),
            Math.abs(pixels[offset + 2] - averageCorner[2]),
          );
          if (colorDistance <= 34) continue;
        }
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < minX || maxY < minY) return;
    const contentWidth = maxX - minX + 1;
    const contentHeight = maxY - minY + 1;
    const apparentSize = Math.sqrt(contentWidth * contentHeight);
    const scaleByArea = 48 / apparentSize;
    const scaleByBounds = 58 / Math.max(contentWidth, contentHeight);
    const visualScale = Math.min(2.5, Math.max(0.78, Math.min(scaleByArea, scaleByBounds)));
    image.style.setProperty("--quick-site-icon-scale", visualScale.toFixed(3));
  } catch {
    // Cross-origin fallbacks may not be readable by canvas; the fixed icon box remains the safe default.
  }
}

const modeOrder: Record<ProxyState["mode"], number> = {
  manual: 0,
  pac: 1,
  off: 2,
};

interface IpCardMetaProps {
  source: string;
  latencyMs: number | null | undefined;
  copyLabel: string;
  animate?: boolean;
  order?: number;
  onCopy: (value: string | undefined, label: string) => void;
}

function IpCardMeta({ source, latencyMs, copyLabel, animate = false, order, onCopy }: IpCardMetaProps) {
  const latencyText = typeof latencyMs === "number" ? `${latencyMs}ms` : "--ms";
  return (
    <div className="ip-card-meta">
      <button className="ip-card-source" onClick={() => onCopy(source, copyLabel)} title={`复制${copyLabel}`} type="button">
        {typeof order === "number" ? (
          <RollingText animate={animate} order={order} value={source} />
        ) : (
          source
        )}
      </button>
      <span className="ip-card-latency">
        {typeof order === "number" ? (
          <RollingText animate={animate} order={order} value={latencyText} />
        ) : (
          latencyText
        )}
      </span>
    </div>
  );
}

interface CopyableCardValueProps {
  value: string | undefined;
  fallback?: string;
  label: string;
  variant: "main" | "muted";
  animate?: boolean;
  order?: number;
  sizerValue?: string;
  onCopy: (value: string | undefined, label: string) => void;
}

function CopyableCardValue({
  value,
  fallback,
  label,
  variant,
  animate = false,
  order,
  sizerValue,
  onCopy,
}: CopyableCardValueProps) {
  const displayValue = value?.trim() || fallback || "";

  return (
    <button
      className={`copyable-card-value copyable-card-${variant}`}
      onClick={() => onCopy(value?.trim(), label)}
      title={`复制${label}`}
      type="button"
    >
      {typeof order === "number" ? (
        <RollingText animate={animate} order={order} sizerValue={sizerValue} value={displayValue} />
      ) : (
        displayValue
      )}
    </button>
  );
}
