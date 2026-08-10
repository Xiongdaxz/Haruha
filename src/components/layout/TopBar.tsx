import type { ProxyMode, ProxyState } from "../../lib/types";
import { modeLabel } from "../../lib/format";
import { RollingText } from "../feedback/RollingText";

interface TopBarProps {
  state: ProxyState;
  isModePending: boolean;
  animateModeValues: boolean;
  onCopy: (value: string | undefined, label: string) => void;
  onModeChange: (mode: ProxyMode) => void;
}

export function TopBar({ state, isModePending, animateModeValues, onCopy, onModeChange }: TopBarProps) {
  function requestModeChange(mode: ProxyMode) {
    if (mode === state.mode) return;
    onModeChange(mode);
  }

  const rollingOrder = modeOrder[state.mode];
  const address = state.address ?? "未设置代理地址";

  return (
    <header className="window-bar">
      <div className="status-strip">
        <div
          className={`status-pill status-mode-${state.mode}${state.mode === "off" ? " offline" : " healthy"}${
            isModePending ? " pending" : ""
          }`}
        >
          <span className="status-light" aria-hidden="true" />
          <RollingText
            animate={animateModeValues}
            ariaLive="polite"
            className="status-mode-text-window"
            order={rollingOrder}
            sizerValue={modeLabel("pac")}
            value={modeLabel(state.mode)}
          />
        </div>
        <div className="divider" />
        <button className="address-pill copy-button" onClick={() => onCopy(state.address, "代理地址")} title="复制代理地址">
          <RollingText animate={animateModeValues} order={rollingOrder} value={address} />
        </button>
        <div className="divider" />
        <div className="connection-pill">
          <span />
          连接正常
        </div>
      </div>

      <div
        className={`mode-switch mode-${state.mode}${isModePending ? " is-pending" : ""}`}
        aria-busy={isModePending}
      >
        <button
          className={state.mode === "manual" ? "selected" : ""}
          onClick={() => requestModeChange("manual")}
        >
          手动代理
        </button>
        <button
          className={state.mode === "pac" ? "selected" : ""}
          onClick={() => requestModeChange("pac")}
        >
          PAC自动
        </button>
        <button
          className={state.mode === "off" ? "danger selected-danger" : "danger"}
          onClick={() => requestModeChange("off")}
        >
          关闭
        </button>
      </div>
    </header>
  );
}

const modeOrder: Record<ProxyMode, number> = {
  manual: 0,
  pac: 1,
  off: 2,
};
