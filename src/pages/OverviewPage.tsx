import {
  Activity,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Gauge,
  Globe2,
  Loader2,
  MapPin,
  RotateCcw,
  Search,
  Send,
  Settings,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ProxyIcon, quickSiteCategories, quickSites } from "../app/constants";
import { RollingText } from "../components/feedback/RollingText";
import { formatMbps } from "../lib/format";
import type {
  IpInfo,
  NetworkTrafficPoint,
  ProxyState,
  QuickSite,
  QuickSiteCategory,
  SpeedTestConfig,
  SpeedTestHistoryEntry,
  SpeedTestResult,
} from "../lib/types";

interface OverviewPageProps {
  effectiveState: ProxyState;
  overviewMode: string;
  animateModeValues: boolean;
  directIp: IpInfo | null;
  proxyIp: IpInfo | null;
  proxyRuleCount: number;
  directRuleCount: number;
  disabledRuleCount: number;
  speedTestConfig: SpeedTestConfig;
  speedTestHistory: SpeedTestHistoryEntry[];
  speedTestResult: SpeedTestResult | null;
  isSpeedSettingsOpen: boolean;
  busyAction: string | null;
  trafficMonitorEnabled: boolean;
  trafficMonitorError: string | null;
  trafficMonitorPoints: NetworkTrafficPoint[];
  activeSiteCategory: QuickSiteCategory;
  activeSiteCategoryIndex: number;
  filteredQuickSites: QuickSite[];
  failedSiteIcons: Set<string>;
  quickSiteIconUrls: Record<string, string>;
  onToggleSpeedSettings: () => void;
  onRunSpeedTest: () => void;
  onRefreshConnection: () => void;
  onRefreshDirectIp: () => void;
  onRefreshProxyIp: () => void;
  onRefreshPacSummary: () => void;
  onToggleTrafficMonitor: () => void;
  onUpdateSpeedTestConfig: <K extends keyof SpeedTestConfig>(key: K, value: SpeedTestConfig[K]) => void;
  onRestoreSpeedTestConfig: () => void;
  onSiteCategoryChange: (category: QuickSiteCategory) => void;
  onSiteIconError: (siteId: string) => void;
  onOpenQuickSite: (site: QuickSite) => void;
  onCopy: (value: string | undefined, label: string) => void;
}

export function OverviewPage({
  effectiveState,
  overviewMode,
  animateModeValues,
  directIp,
  proxyIp,
  proxyRuleCount,
  directRuleCount,
  disabledRuleCount,
  speedTestConfig,
  speedTestHistory,
  speedTestResult,
  isSpeedSettingsOpen,
  busyAction,
  trafficMonitorEnabled,
  trafficMonitorError,
  trafficMonitorPoints,
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
  onToggleTrafficMonitor,
  onUpdateSpeedTestConfig,
  onRestoreSpeedTestConfig,
  onSiteCategoryChange,
  onSiteIconError,
  onOpenQuickSite,
  onCopy,
}: OverviewPageProps) {
  const [isQuickSiteSearchOpen, setQuickSiteSearchOpen] = useState(false);
  const [quickSiteQuery, setQuickSiteQuery] = useState("");
  const quickSiteSearchRef = useRef<HTMLDivElement>(null);
  const quickSiteSearchInputRef = useRef<HTMLInputElement>(null);
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

  const latestSpeedResult = speedTestResult?.ok ? speedTestResult : speedTestHistory.find((entry) => entry.ok);
  const isProxyDisabled = effectiveState.mode === "off" || proxyIp?.source === "proxy-disabled";
  const proxySourceText =
    proxyIp?.source && proxyIp.source !== "mock" && !isProxyDisabled ? proxyIp.source : isProxyDisabled ? "代理未启用" : "代理出口";
  const directLocation = directIp?.location ?? "中国 北京 联通";
  const directSourceText = directIp?.source && directIp.source !== "mock" ? directIp.source : "本机出口";
  const proxyLocation = proxyIp?.location || (isProxyDisabled ? "" : "美国 加利福尼亚州 圣何塞");
  const pacRuleSummary = `直连 ${directRuleCount} / 停用 ${disabledRuleCount}`;
  const rollingModeOrder = modeOrder[effectiveState.mode];
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
          fallback="未设置代理地址"
          label="代理地址"
          onCopy={onCopy}
          order={rollingModeOrder}
          value={effectiveState.address}
          variant="muted"
        />
        <div className="overview-card-foot">
          <i />
          <span>连接正常</span>
        </div>
      </section>
      <section className="panel overview-card ip-overview-card">
        <div className="overview-card-top">
          <span>我的IP</span>
          <button
            className="overview-card-icon refresh-card-button"
            disabled={busyAction !== null}
            onClick={onRefreshDirectIp}
            title="刷新我的IP"
            type="button"
          >
            {busyAction === "refresh-direct-ip" ? <Loader2 className="spin" size={18} /> : <MapPin size={18} />}
          </button>
        </div>
        <CopyableCardValue fallback="203.0.113.45" label="我的IP" onCopy={onCopy} value={directIp?.ip} variant="main" />
        <CopyableCardValue label="我的IP位置" onCopy={onCopy} value={directLocation} variant="muted" />
        <IpCardMeta
          copyLabel="我的IP来源"
          latencyMs={directIp?.latencyMs}
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
          fallback={isProxyDisabled ? "代理已关闭" : "198.51.100.23"}
          label="代理IP"
          onCopy={onCopy}
          value={isProxyDisabled ? undefined : proxyIp?.ip}
          variant="main"
        />
        {proxyLocation ? <CopyableCardValue label="代理位置" onCopy={onCopy} value={proxyLocation} variant="muted" /> : null}
        <IpCardMeta
          copyLabel="代理IP来源"
          latencyMs={isProxyDisabled ? undefined : proxyIp?.latencyMs}
          onCopy={onCopy}
          source={proxySourceText}
        />
      </section>
      <section className="panel overview-card">
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
      </section>
      <section className={`panel overview-card overview-card-wide speed-card${isSpeedSettingsOpen ? " speed-card-open" : ""}`}>
        <div className="overview-card-top">
          <span>代理测速</span>
          <div className="overview-card-actions">
            <button className="overview-icon-button speed-tool-button" onClick={onToggleSpeedSettings} title="设置测速地址">
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
            <strong>{latestSpeedResult?.latencyMs ? `${latestSpeedResult.latencyMs}ms` : "--"}</strong>
          </div>
          <div className="speed-orb">
            <span>下行</span>
            <strong>{latestSpeedResult?.downloadMbps ? formatMbps(latestSpeedResult.downloadMbps) : "--"}</strong>
          </div>
          <button className="speed-test-orb" disabled={busyAction === "speed-test"} onClick={onRunSpeedTest}>
            {busyAction === "speed-test" ? <Loader2 className="spin" size={21} /> : <Send size={21} />}
            <span>{busyAction === "speed-test" ? "测速中" : "开始测速"}</span>
          </button>
        </div>
        {speedTestResult?.ok === false ? (
          <div className="speed-summary">
            <span className="speed-message error">{speedTestResult.message}</span>
          </div>
        ) : null}
        {isSpeedSettingsOpen ? (
          <div className="speed-settings-popover">
            <label>
              下载测速地址
              <input
                value={speedTestConfig.downloadUrl}
                onChange={(event) => onUpdateSpeedTestConfig("downloadUrl", event.target.value)}
              />
            </label>
            <label>
              下载大小(KB)
              <input
                min={128}
                type="number"
                value={Math.round(speedTestConfig.downloadBytesLimit / 1024)}
                onChange={(event) =>
                  onUpdateSpeedTestConfig("downloadBytesLimit", Math.max(128, Number(event.target.value) || 128) * 1024)
                }
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
                <img alt="" src={quickSiteIconUrls[site.id]} onError={() => onSiteIconError(site.id)} />
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
      <div className="traffic-monitor-grid">
        <TrafficMonitorCard
          chartId="network"
          error={trafficMonitorError}
          monitorEnabled={trafficMonitorEnabled}
          onMonitorToggle={onToggleTrafficMonitor}
          points={trafficMonitorPoints}
          subtitle="系统全部网卡 · 最近 60 秒"
          title="实时流量"
          tooltip="每秒读取一次系统网卡收发流量"
        />
      </div>
    </section>
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
  onMonitorToggle: () => void;
}

function TrafficMonitorCard({
  chartId,
  title,
  subtitle,
  tooltip,
  points,
  error,
  monitorEnabled,
  onMonitorToggle,
}: TrafficMonitorCardProps) {
  const latestPoint = points.at(-1);
  const peakDownloadRate = Math.max(0, ...points.map((point) => point.downloadBytesPerSecond));
  const peakUploadRate = Math.max(0, ...points.map((point) => point.uploadBytesPerSecond));
  const scaleMax = Math.max(32 * 1024, peakDownloadRate, peakUploadRate) * 1.12;
  const downloadPath = trafficLinePath(points, "downloadBytesPerSecond", scaleMax);
  const uploadPath = trafficLinePath(points, "uploadBytesPerSecond", scaleMax);
  const downloadArea = trafficAreaPath(points, "downloadBytesPerSecond", scaleMax);
  const uploadArea = trafficAreaPath(points, "uploadBytesPerSecond", scaleMax);
  const statusClass = !monitorEnabled ? " idle" : error ? " error" : "";
  const statusText = !monitorEnabled
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
      <div className="traffic-monitor-body">
        <div className="traffic-metrics">
          <div className="traffic-metric download">
            <span><ArrowDown size={17} />下行</span>
            <strong>{formatTrafficRate(latestPoint?.downloadBytesPerSecond)}</strong>
            <small>峰值 {formatTrafficRate(peakDownloadRate)}</small>
          </div>
          <div className="traffic-metric upload">
            <span><ArrowUp size={17} />上行</span>
            <strong>{formatTrafficRate(latestPoint?.uploadBytesPerSecond)}</strong>
            <small>峰值 {formatTrafficRate(peakUploadRate)}</small>
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

function trafficLinePath(points: NetworkTrafficPoint[], key: TrafficRateKey, maxRate: number) {
  const coordinates = trafficCoordinates(points, key, maxRate);
  return trafficCurvePath(coordinates);
}

function trafficAreaPath(points: NetworkTrafficPoint[], key: TrafficRateKey, maxRate: number) {
  const coordinates = trafficCoordinates(points, key, maxRate);
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

function quickSiteTooltipClass(index: number, itemCount: number) {
  const column = index % 7;
  const horizontalClass =
    column <= 1 ? "tooltip-start" : column >= 5 || index >= itemCount - 1 ? "tooltip-end" : "tooltip-center";
  return index < 7 ? `${horizontalClass} tooltip-bottom` : horizontalClass;
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
  onCopy: (value: string | undefined, label: string) => void;
}

function IpCardMeta({ source, latencyMs, copyLabel, onCopy }: IpCardMetaProps) {
  return (
    <div className="ip-card-meta">
      <button className="ip-card-source" onClick={() => onCopy(source, copyLabel)} title={`复制${copyLabel}`} type="button">
        {source}
      </button>
      <span className="ip-card-latency">{typeof latencyMs === "number" ? `${latencyMs}ms` : "--ms"}</span>
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
