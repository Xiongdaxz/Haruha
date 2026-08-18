import { PanelLeft } from "lucide-react";
import type { CSSProperties } from "react";
import springLeafLogo from "../../assets/haruha-tray-logo.png";
import springLeafLogoOff from "../../assets/haruha-tray-logo-off.png";
import { APP_NAME, navItems } from "../../app/constants";
import type { NavKey } from "../../app/types";

interface SidebarProps {
  activeNav: NavKey;
  hasUpdate: boolean;
  isCollapsed: boolean;
  onNavChange: (nav: NavKey) => void;
  onToggle: () => void;
}

export function Sidebar({ activeNav, hasUpdate, isCollapsed, onNavChange, onToggle }: SidebarProps) {
  const activeNavIndex = navItems.findIndex((item) => item.key === activeNav);
  const navStyle = { "--active-nav-index": Math.max(activeNavIndex, 0) } as CSSProperties;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span className="brand-logo-stack">
            <img alt="" className="spring-leaf-logo spring-leaf-logo-on" src={springLeafLogo} />
            <img alt="" className="spring-leaf-logo spring-leaf-logo-off" src={springLeafLogoOff} />
          </span>
        </div>
        <span className="brand-name">{APP_NAME}</span>
        <button
          aria-label={isCollapsed ? "展开菜单" : "收起菜单"}
          className="sidebar-toggle"
          onClick={onToggle}
          title={isCollapsed ? "展开菜单" : "收起菜单"}
        >
          <PanelLeft size={18} />
        </button>
      </div>

      <nav className="nav-list" style={navStyle}>
        <span className="nav-indicator" />
        {navItems.map((item) => (
          <button
            aria-current={activeNav === item.key ? "page" : undefined}
            className={activeNav === item.key ? "nav-item active" : "nav-item"}
            key={item.key}
            onClick={() => onNavChange(item.key)}
          >
            <item.icon size={20} />
            <span>{item.label}</span>
            {item.key === "settings" && hasUpdate ? <i className="nav-update-dot" aria-label="发现新版本" /> : null}
          </button>
        ))}
      </nav>
    </aside>
  );
}
