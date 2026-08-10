import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ExternalLink,
  LoaderCircle,
  LogOut,
  MonitorUp,
  Power,
} from "lucide-react";
import logo from "../../assets/haruha-tray-logo.png";
import { PacIcon, ProxyIcon } from "../../app/constants";
import {
  defaultProfile,
  disableProxy,
  enableManual,
  enablePac,
  getActiveProfile,
  getProxyState,
  hideTrayPanel,
  listenProxyStateChanged,
  openGoogle,
  quitFromTray,
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
    description: "按规则智能分流网络请求",
    icon: PacIcon,
  },
  off: {
    label: "关闭代理",
    description: "恢复系统默认网络连接",
    icon: Power,
  },
} satisfies Record<ProxyMode, { label: string; description: string; icon: typeof Power }>;

const modes: ProxyMode[] = ["manual", "pac", "off"];

export function TrayPanel() {
  useThemePreference();
  const [profile, setProfile] = useState<ProxyProfile>(defaultProfile);
  const [proxyState, setProxyState] = useState<ProxyState | null>(null);
  const [busyMode, setBusyMode] = useState<ProxyMode | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void Promise.all([getActiveProfile(), getProxyState()])
      .then(([nextProfile, nextState]) => {
        if (disposed) return;
        setProfile(nextProfile);
        setProxyState(nextState);
      })
      .catch((error) => {
        if (!disposed) setErrorMessage(error instanceof Error ? error.message : String(error));
      });

    void listenProxyStateChanged((nextState) => {
      setProxyState(nextState);
      setProfile((current) => ({ ...current, mode: nextState.mode }));
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
    };
  }, []);

  const activeMode = proxyState?.mode ?? profile.mode;
  const status = useMemo(() => {
    if (activeMode === "manual") {
      return {
        label: "手动代理",
        detail: proxyState?.address ?? `${profile.host}:${profile.port}`,
      };
    }
    if (activeMode === "pac") {
      return { label: "PAC 代理", detail: "智能分流中" };
    }
    return { label: "直连", detail: "系统网络直连" };
  }, [activeMode, profile.host, profile.port, proxyState?.address]);

  async function switchMode(mode: ProxyMode) {
    if (busyMode || mode === activeMode) return;
    const previousState = proxyState;
    const previousMode = profile.mode;
    setBusyMode(mode);
    setErrorMessage("");
    setProxyState((current) =>
      current
        ? {
            ...current,
            mode,
            address: mode === "manual" ? `${profile.host}:${profile.port}` : undefined,
            pacUrl: mode === "pac" ? current.pacUrl : undefined,
          }
        : current,
    );
    setProfile((current) => ({ ...current, mode }));
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)));
      const nextState =
        mode === "manual" ? await enableManual(profile) : mode === "pac" ? await enablePac(profile) : await disableProxy();
      setProxyState(nextState);
      setProfile((current) => ({ ...current, mode: nextState.mode }));
    } catch (error) {
      setProxyState(previousState);
      setProfile((current) => ({ ...current, mode: previousMode }));
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMode(null);
    }
  }

  async function openMainWindow() {
    await showMainWindowFromTray();
  }

  async function openGoogleFromTray() {
    await openGoogle();
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
            <small className={errorMessage ? "is-error" : ""}>{errorMessage || status.detail}</small>
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
              const isBusy = mode === busyMode;
              return (
                <button
                  type="button"
                  className={`tray-mode-option${isActive ? " is-active" : ""}${mode === "off" ? " is-off" : ""}`}
                  role="radio"
                  aria-checked={isActive}
                  disabled={busyMode !== null}
                  key={mode}
                  onClick={() => void switchMode(mode)}
                >
                  <span className="tray-mode-icon" aria-hidden="true"><Icon size={18} strokeWidth={2} /></span>
                  <span className="tray-mode-copy">
                    <strong>{item.label}</strong>
                    <small>{mode === "manual" ? `${profile.host}:${profile.port}` : item.description}</small>
                  </span>
                  <span className="tray-mode-check" aria-hidden="true">
                    {isBusy ? <LoaderCircle className="is-spinning" size={17} /> : isActive ? <Check size={16} strokeWidth={2.6} /> : null}
                  </span>
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
