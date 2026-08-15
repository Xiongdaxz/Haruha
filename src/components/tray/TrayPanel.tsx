import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Check,
  ExternalLink,
  LogOut,
  MonitorUp,
  Power,
} from "lucide-react";
import logo from "../../assets/haruha-tray-logo.png";
import { DEFAULT_PAC_URL, PacIcon, ProxyIcon, themeOptions } from "../../app/constants";
import type { ThemePreference } from "../../app/types";
import {
  defaultProfile,
  getActiveProfile,
  getProxyState,
  hideTrayPanel,
  listenProxyStateChanged,
  openGoogle,
  quitFromTray,
  setProxyMode,
  showMainWindowFromTray,
} from "../../lib/api";
import type { ProxyMode, ProxyProfile, ProxyState } from "../../lib/types";
import { useThemePreference } from "../../hooks/useThemePreference";

const modeMeta = {
  manual: {
    label: "手动代理",
    description: "全部流量通过代理服务器",
    icon: ProxyIcon,
  },
  pac: {
    label: "PAC 自动代理",
    description: DEFAULT_PAC_URL,
    icon: PacIcon,
  },
  off: {
    label: "关闭代理",
    description: "恢复系统默认网络连接",
    icon: Power,
  },
} satisfies Record<ProxyMode, { label: string; description: string; icon: typeof Power }>;

const modes: ProxyMode[] = ["manual", "pac", "off"];

interface QueuedModeChange {
  id: number;
  mode: ProxyMode;
  fallbackState: ProxyState | null;
  fallbackMode: ProxyMode;
}

export function TrayPanel() {
  const { activeThemeIndex, setThemePreference, themePreference } = useThemePreference();
  const [profile, setProfile] = useState<ProxyProfile>(defaultProfile);
  const [proxyState, setProxyState] = useState<ProxyState | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isThemeTransitioning, setThemeTransitioning] = useState(false);
  const themeTransitionTimer = useRef<number | undefined>(undefined);
  const queuedModeChangeRef = useRef<QueuedModeChange | null>(null);
  const modeChangeRunningRef = useRef(false);
  const modeChangeRequestIdRef = useRef(0);
  const confirmedProxyStateRef = useRef<ProxyState | null>(null);
  const requestedModeRef = useRef<ProxyMode>(defaultProfile.mode);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void Promise.all([getActiveProfile(), getProxyState()])
      .then(([nextProfile, nextState]) => {
        if (disposed) return;
        confirmedProxyStateRef.current = nextState;
        if (modeChangeRunningRef.current || queuedModeChangeRef.current) {
          setProfile((current) => ({ ...nextProfile, mode: current.mode }));
          return;
        }

        setProfile(nextProfile);
        setProxyState(nextState);
        requestedModeRef.current = nextState.mode;
      })
      .catch((error) => {
        if (!disposed) setErrorMessage(error instanceof Error ? error.message : String(error));
      });

    void listenProxyStateChanged((nextState) => {
      confirmedProxyStateRef.current = nextState;
      void getActiveProfile()
        .then((nextProfile) => {
          if (disposed) return;
          setProfile((current) => ({ ...nextProfile, mode: current.mode }));
          setErrorMessage("");
        })
        .catch((error) => {
          if (!disposed) setErrorMessage(error instanceof Error ? error.message : String(error));
        });
      if (modeChangeRunningRef.current || queuedModeChangeRef.current) return;

      setProxyState(nextState);
      setProfile((current) => ({ ...current, mode: nextState.mode }));
      requestedModeRef.current = nextState.mode;
    }).then((disposeListener) => {
      if (disposed) disposeListener();
      else unlisten = disposeListener;
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void hideTrayPanel();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("keydown", onKeyDown);
      if (themeTransitionTimer.current !== undefined) window.clearTimeout(themeTransitionTimer.current);
    };
  }, []);

  const activeMode = proxyState?.mode ?? profile.mode;
  const pacUrl = proxyState?.pacUrl ?? DEFAULT_PAC_URL;
  const status = useMemo(() => {
    if (activeMode === "manual") {
      return {
        label: "手动代理",
        detail: proxyState?.address ?? `${profile.host}:${profile.port}`,
      };
    }
    if (activeMode === "pac") {
      return { label: "PAC 代理", detail: pacUrl };
    }
    return { label: "直连", detail: "系统网络直连" };
  }, [activeMode, pacUrl, profile.host, profile.port, proxyState?.address]);

  function switchMode(mode: ProxyMode) {
    if (mode === requestedModeRef.current) return;

    modeChangeRequestIdRef.current += 1;
    requestedModeRef.current = mode;
    queuedModeChangeRef.current = {
      id: modeChangeRequestIdRef.current,
      mode,
      fallbackState: confirmedProxyStateRef.current ?? proxyState,
      fallbackMode: confirmedProxyStateRef.current?.mode ?? activeMode,
    };

    setErrorMessage("");
    setProxyState((current) =>
      current
        ? {
            ...current,
            mode,
            address: mode === "manual" ? `${profile.host}:${profile.port}` : undefined,
            pacUrl: mode === "pac" ? pacUrl : undefined,
          }
        : current,
    );
    setProfile((current) => ({ ...current, mode }));
    void processQueuedModeChanges();
  }

  async function processQueuedModeChanges() {
    if (modeChangeRunningRef.current) return;
    modeChangeRunningRef.current = true;

    try {
      while (queuedModeChangeRef.current) {
        const request = queuedModeChangeRef.current;
        queuedModeChangeRef.current = null;

        await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)));
        if (request.id !== modeChangeRequestIdRef.current) continue;

        try {
          const nextState = await setProxyMode(request.mode);
          confirmedProxyStateRef.current = nextState;

          let nextProfile: ProxyProfile | null = null;
          try {
            nextProfile = await getActiveProfile();
            setErrorMessage("");
          } catch (profileError) {
            setErrorMessage(
              `代理已切换，但刷新配置失败：${profileError instanceof Error ? profileError.message : String(profileError)}`,
            );
          }

          const isLatestRequest =
            request.id === modeChangeRequestIdRef.current && queuedModeChangeRef.current === null;
          if (!isLatestRequest) continue;

          requestedModeRef.current = nextState.mode;
          setProxyState(nextState);
          setProfile((current) => ({ ...(nextProfile ?? current), mode: nextState.mode }));
        } catch (error) {
          const hasNewerRequest =
            request.id !== modeChangeRequestIdRef.current || queuedModeChangeRef.current !== null;
          if (hasNewerRequest) continue;

          const fallbackState = confirmedProxyStateRef.current ?? request.fallbackState;
          requestedModeRef.current = fallbackState?.mode ?? request.fallbackMode;
          setProxyState(fallbackState);
          setProfile((current) => ({ ...current, mode: fallbackState?.mode ?? request.fallbackMode }));
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      modeChangeRunningRef.current = false;
      if (queuedModeChangeRef.current) void processQueuedModeChanges();
    }
  }

  async function openMainWindow() {
    await showMainWindowFromTray();
  }

  async function openGoogleFromTray() {
    await openGoogle();
  }

  function selectTheme(theme: ThemePreference) {
    if (theme === themePreference) return;
    if (themeTransitionTimer.current !== undefined) window.clearTimeout(themeTransitionTimer.current);
    setThemeTransitioning(true);
    setThemePreference(theme);
    themeTransitionTimer.current = window.setTimeout(() => {
      setThemeTransitioning(false);
      themeTransitionTimer.current = undefined;
    }, 320);
  }

  function handleThemeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (activeThemeIndex - 1 + themeOptions.length) % themeOptions.length;
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (activeThemeIndex + 1) % themeOptions.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = themeOptions.length - 1;
    }
    if (nextIndex === undefined) return;

    event.preventDefault();
    selectTheme(themeOptions[nextIndex].key);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[nextIndex]?.focus();
  }

  return (
    <main className="tray-panel-shell">
      <section className="tray-panel" aria-label="Haruha 快捷面板">
        <header className="tray-panel-header">
          <span className="tray-brand-mark" aria-hidden="true">
            <img src={logo} alt="" />
          </span>
          <span className="tray-brand-copy">
            <strong>Haruha</strong>
            <small className={errorMessage ? "is-error" : ""} title={errorMessage || status.detail}>
              {errorMessage || status.detail}
            </small>
          </span>
          <span className={`tray-status-chip mode-${activeMode}`}>
            <i aria-hidden="true" />
            {status.label}
          </span>
        </header>

        <div className="tray-mode-section">
          <p className="tray-section-label">代理模式</p>
          <div className="tray-mode-list" role="radiogroup" aria-label="选择代理模式">
            {modes.map((mode) => {
              const item = modeMeta[mode];
              const Icon = item.icon;
              const isActive = mode === activeMode;
              return (
                <button
                  type="button"
                  className={`tray-mode-option${isActive ? " is-active" : ""}${mode === "off" ? " is-off" : ""}`}
                  role="radio"
                  aria-checked={isActive}
                  key={mode}
                  onClick={() => switchMode(mode)}
                >
                  <span className="tray-mode-icon" aria-hidden="true"><Icon size={18} strokeWidth={2} /></span>
                  <span className="tray-mode-copy">
                    <strong>{item.label}</strong>
                    <small title={mode === "pac" ? pacUrl : undefined}>
                      {mode === "manual" ? `${profile.host}:${profile.port}` : mode === "pac" ? pacUrl : item.description}
                    </small>
                  </span>
                  <span className="tray-mode-check" aria-hidden="true">
                    {isActive ? <Check size={16} strokeWidth={2.6} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="tray-theme-section">
          <span className="tray-theme-label">主题</span>
          <div
            aria-label="切换界面主题"
            className={`tray-theme-switcher${isThemeTransitioning ? " is-animating" : ""}`}
            onKeyDown={handleThemeKeyDown}
            role="radiogroup"
            style={
              {
                "--tray-theme-count": themeOptions.length,
                "--tray-theme-index": activeThemeIndex,
              } as CSSProperties
            }
          >
            <span className="tray-theme-indicator" aria-hidden="true" />
            {themeOptions.map((option) => {
              const Icon = option.icon;
              const isActive = option.key === themePreference;
              return (
                <button
                  aria-checked={isActive}
                  aria-label={`${option.label}：${option.description}`}
                  className={isActive ? "tray-theme-option is-active" : "tray-theme-option"}
                  key={option.key}
                  onClick={() => selectTheme(option.key)}
                  role="radio"
                  tabIndex={isActive ? 0 : -1}
                  title={`${option.label} · ${option.description}`}
                  type="button"
                >
                  <Icon aria-hidden="true" size={16} strokeWidth={2.1} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="tray-shortcuts">
          <button type="button" onClick={() => void openMainWindow()}>
            <MonitorUp size={17} aria-hidden="true" />
            打开主界面
          </button>
          <button type="button" onClick={() => void openGoogleFromTray()}>
            <ExternalLink size={17} aria-hidden="true" />
            打开 Google
          </button>
        </div>

        <footer className="tray-panel-footer">
          <button type="button" onClick={() => void quitFromTray()}>
            <LogOut size={16} aria-hidden="true" />
            关闭代理并退出
          </button>
        </footer>
      </section>
    </main>
  );
}
