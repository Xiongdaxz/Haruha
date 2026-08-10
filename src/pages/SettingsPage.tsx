import { CircleHelp, Copy, FolderOpen, Palette, Plus, RotateCcw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ProxyIcon, settingsItems, themeOptions } from "../app/constants";
import { defaultUnifiedLists } from "../lib/api";
import { normalizeUnifiedRuleInput } from "../lib/rules";
import type { UnifiedLists } from "../lib/types";
import type { ResolvedTheme, SettingsKey, ThemePreference } from "../app/types";

interface SettingsPageProps {
  activeSettings: SettingsKey;
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  activeThemeIndex: number;
  configDirectoryPath: string;
  resolvedThemeLabel: string;
  unifiedLists: UnifiedLists;
  onSettingsChange: (settings: SettingsKey) => void;
  onOpenConfigDirectory: () => void;
  onCopy: (value: string | undefined, label: string) => void;
  onThemePreferenceChange: (theme: ThemePreference) => void;
  onChangeUnifiedLists: (next: UnifiedLists) => void;
}

type ListKind = "direct" | "proxy";

export function SettingsPage({
  activeSettings,
  themePreference,
  resolvedTheme,
  activeThemeIndex,
  configDirectoryPath,
  resolvedThemeLabel,
  unifiedLists,
  onSettingsChange,
  onOpenConfigDirectory,
  onCopy,
  onThemePreferenceChange,
  onChangeUnifiedLists,
}: SettingsPageProps) {
  const selectedThemeOption = themeOptions[activeThemeIndex];
  const previewThemeOption =
    themePreference === "system"
      ? (themeOptions.find((option) => option.key === resolvedTheme) ?? selectedThemeOption)
      : selectedThemeOption;
  const previewDescription =
    themePreference === "system"
      ? `${selectedThemeOption.description}，当前为${resolvedThemeLabel}`
      : selectedThemeOption.description;
  const activeSettingsIndex = Math.max(
    0,
    settingsItems.findIndex((item) => item.key === activeSettings),
  );
  const [activeUnifiedList, setActiveUnifiedList] = useState<ListKind>("direct");
  const activeUnifiedListIndex = activeUnifiedList === "direct" ? 0 : 1;

  return (
    <section className="panel settings-panel">
      <div
        className="settings-menu"
        style={{ "--active-settings-index": activeSettingsIndex } as CSSProperties}
      >
        <span className="settings-menu-indicator" aria-hidden="true" />
        {settingsItems.map((item) => (
          <button
            className={activeSettings === item.key ? "settings-menu-item active" : "settings-menu-item"}
            key={item.key}
            onClick={() => onSettingsChange(item.key)}
            type="button"
          >
            <item.icon aria-hidden="true" size={18} />
            <span>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
          </button>
        ))}
      </div>

      <div
        className={activeSettings === "unified-lists" ? "settings-detail unified-lists-detail" : "settings-detail"}
      >
        {activeSettings === "appearance" ? (
          <>
            <div className="settings-detail-head">
              <span className="settings-detail-icon">
                <Palette size={20} />
              </span>
              <div>
                <h2>外观</h2>
                <p>
                  {selectedThemeOption.label}
                  {themePreference === "system" ? ` · 当前为${resolvedThemeLabel}` : ""}
                </p>
              </div>
            </div>

            <div
              aria-label="界面主题"
              className="theme-switcher"
              role="radiogroup"
              style={
                {
                  "--theme-count": themeOptions.length,
                  "--theme-index": activeThemeIndex,
                } as CSSProperties
              }
            >
              <span className="theme-switch-indicator" aria-hidden="true" />
              {themeOptions.map((option) => (
                <button
                  aria-checked={themePreference === option.key}
                  className={themePreference === option.key ? "theme-option active" : "theme-option"}
                  key={option.key}
                  onClick={() => onThemePreferenceChange(option.key)}
                  role="radio"
                  title={option.description}
                >
                  <option.icon size={17} />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>

            <div
              className="theme-preview-card"
              style={
                {
                  "--theme-preview-accent": previewThemeOption.preview.accent,
                  "--theme-preview-side": previewThemeOption.preview.side,
                  "--theme-preview-surface": previewThemeOption.preview.surface,
                  "--theme-preview-support": previewThemeOption.preview.support,
                  "--theme-preview-tint": previewThemeOption.preview.tint,
                } as CSSProperties
              }
            >
              <div className="theme-preview-copy">
                <strong>{selectedThemeOption.label}</strong>
                <span>{previewDescription}</span>
              </div>
              <div className="theme-preview-window" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
            </div>
          </>
        ) : null}

        {activeSettings === "unified-lists" ? (
          <>
            <div className="settings-detail-head">
              <span className="settings-detail-icon">
                <ProxyIcon size={20} />
              </span>
              <div>
                <h2>代理名单</h2>
                <p>跨模式共享的统一直连/代理名单</p>
              </div>
            </div>

            <div
              aria-label="代理名单类型"
              className="theme-switcher unified-list-switcher"
              role="tablist"
              style={
                {
                  "--theme-count": 2,
                  "--theme-index": activeUnifiedListIndex,
                } as CSSProperties
              }
            >
              <span className="theme-switch-indicator" aria-hidden="true" />
              <button
                aria-controls="unified-list-panel"
                aria-selected={activeUnifiedList === "direct"}
                className={activeUnifiedList === "direct" ? "theme-option active" : "theme-option"}
                onClick={() => setActiveUnifiedList("direct")}
                role="tab"
                type="button"
              >
                <ShieldCheck size={17} />
                <span>直连名单</span>
              </button>
              <button
                aria-controls="unified-list-panel"
                aria-selected={activeUnifiedList === "proxy"}
                className={activeUnifiedList === "proxy" ? "theme-option active" : "theme-option"}
                onClick={() => setActiveUnifiedList("proxy")}
                role="tab"
                type="button"
              >
                <ProxyIcon size={17} />
                <span>代理名单</span>
              </button>
            </div>

            <div
              aria-label={activeUnifiedList === "direct" ? "直连名单" : "代理名单"}
              className="unified-list-tab-panel"
              id="unified-list-panel"
              role="tabpanel"
            >
              <UnifiedListSection
                key={activeUnifiedList}
                kind={activeUnifiedList}
                unifiedLists={unifiedLists}
                onChange={onChangeUnifiedLists}
              />
            </div>
          </>
        ) : null}

        {activeSettings === "config-directory" ? (
          <>
            <div className="settings-detail-head">
              <span className="settings-detail-icon">
                <FolderOpen size={20} />
              </span>
              <div>
                <h2>配置目录</h2>
                <p>配置、日志与网站图标缓存</p>
              </div>
            </div>

            <div className="config-directory-card">
              <span className="config-directory-label">当前用户配置目录</span>
              <button
                className="config-directory-path copy-button"
                onClick={() => onCopy(configDirectoryPath, "配置目录路径")}
                title="点击复制配置目录路径"
                type="button"
              >
                <code>{configDirectoryPath}</code>
                <Copy aria-hidden="true" size={17} />
              </button>
              <p>配置文件、PAC 文件、运行日志和网站图标缓存都保存在此目录，更新或重新安装程序不会自动删除。</p>
              <div className="config-directory-actions">
                <button className="outline" onClick={() => onCopy(configDirectoryPath, "配置目录路径")} type="button">
                  <Copy aria-hidden="true" size={17} />
                  复制路径
                </button>
                <button className="primary" onClick={onOpenConfigDirectory} type="button">
                  <FolderOpen aria-hidden="true" size={17} />
                  打开目录
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

interface UnifiedListSectionProps {
  kind: ListKind;
  unifiedLists: UnifiedLists;
  onChange: (next: UnifiedLists) => void;
}

function UnifiedListSection({ kind, unifiedLists, onChange }: UnifiedListSectionProps) {
  const isDirect = kind === "direct";
  const enabled = isDirect ? unifiedLists.directEnabled : unifiedLists.proxyEnabled;
  const domains = isDirect ? unifiedLists.directDomains : unifiedLists.proxyDomains;
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const queryInputRef = useRef<HTMLInputElement>(null);

  const title = isDirect ? "直连名单" : "代理名单";
  const description = isDirect
    ? "启用后，命中域名强制走直连，手动代理和 PAC 自动模式都生效"
    : "启用后，命中域名强制走代理，仅 PAC 自动模式生效";
  const icon = isDirect ? <ShieldCheck size={18} /> : <ProxyIcon size={18} />;
  const placeholder = isDirect
    ? "搜索或输入：域名 / 10.0.0.0/8 / *.internal.test"
    : "搜索或输入：域名 / 10.0.0.0/8 / *.example.com";

  const filtered = domains.filter((domain) => {
    const keyword = query.trim().toLowerCase();
    return !keyword || domain.toLowerCase().includes(keyword);
  });

  const allFilteredSelected = filtered.length > 0 && filtered.every((item) => selected.has(item));
  const selectedVisibleCount = filtered.filter((item) => selected.has(item)).length;

  function setEnabled(next: boolean) {
    onChange(
      isDirect
        ? { ...unifiedLists, directEnabled: next }
        : { ...unifiedLists, proxyEnabled: next },
    );
  }

  function addDomain() {
    const domain = normalizeUnifiedRuleInput(query);
    if (!domain || /\s/.test(domain)) {
      queryInputRef.current?.focus();
      return;
    }
    if (domains.some((item) => item === domain)) {
      setQuery("");
      return;
    }
    const nextDomains = [...domains, domain];
    onChange(
      isDirect
        ? { ...unifiedLists, directDomains: nextDomains }
        : { ...unifiedLists, proxyDomains: nextDomains },
    );
    setQuery("");
  }

  function deleteDomain(domain: string) {
    const nextDomains = domains.filter((item) => item !== domain);
    onChange(
      isDirect
        ? { ...unifiedLists, directDomains: nextDomains }
        : { ...unifiedLists, proxyDomains: nextDomains },
    );
    setSelected((current) => {
      const next = new Set(current);
      next.delete(domain);
      return next;
    });
  }

  function deleteSelected() {
    const nextDomains = domains.filter((item) => !selected.has(item));
    onChange(
      isDirect
        ? { ...unifiedLists, directDomains: nextDomains }
        : { ...unifiedLists, proxyDomains: nextDomains },
    );
    setSelected(new Set());
  }

  function restoreDefaults() {
    if (!window.confirm(`确定恢复${title}为默认值？当前列表将被替换。`)) return;
    const defaultDomains = isDirect
      ? defaultUnifiedLists.directDomains
      : defaultUnifiedLists.proxyDomains;
    onChange(
      isDirect
        ? { ...unifiedLists, directDomains: [...defaultDomains] }
        : { ...unifiedLists, proxyDomains: [...defaultDomains] },
    );
    setSelected(new Set());
    setQuery("");
  }

  function toggleSelected(domain: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        filtered.forEach((item) => next.delete(item));
      } else {
        filtered.forEach((item) => next.add(item));
      }
      return next;
    });
  }

  return (
    <div className="unified-list-section">
      <div className="unified-list-head">
        <span className="unified-list-icon">{icon}</span>
        <div className="unified-list-title">
          <div className="unified-list-title-row">
            <strong>{title}</strong>
            <span
              aria-label={`${title}规则说明`}
              className="unified-list-help"
              tabIndex={0}
            >
              <CircleHelp aria-hidden="true" size={15} />
              <span className="unified-list-tooltip" role="tooltip">
                <span>
                  支持三种语法：域名后缀（如 <code>google.com</code>）、IP 网段（如 <code>10.0.0.0/8</code>）、Shell 通配符（如 <code>*.internal.test</code> 或 <code>http://*.jpg</code>）。其中 IP 网段和含 <code>://</code> 的通配符仅在 PAC 自动模式生效。
                </span>
                {!isDirect ? <span>手动代理模式下此名单不生效（系统代理机制限制）。</span> : null}
              </span>
            </span>
          </div>
          <span>{description}</span>
        </div>
        <button
          aria-checked={enabled}
          aria-label={`${title}${enabled ? "已生效，点击停用" : "已停用，点击启用"}`}
          className={enabled ? "rule-enabled-switch is-enabled" : "rule-enabled-switch"}
          onClick={() => setEnabled(!enabled)}
          role="switch"
          title={enabled ? "点击停用" : "点击启用"}
          type="button"
        >
          <span className="rule-enabled-switch-track">
            <span />
          </span>
          <span>{enabled ? "生效" : "停用"}</span>
        </button>
      </div>

      <div className="table-actions">
        <div className="search-field">
          <Search size={18} />
          <input
            placeholder={placeholder}
            ref={queryInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                addDomain();
              }
            }}
          />
        </div>
        <button className="outline compact" onClick={addDomain} type="button">
          <Plus size={18} />
          添加
        </button>
        <button
          className="outline danger compact"
          onClick={deleteSelected}
          disabled={selectedVisibleCount === 0}
          type="button"
        >
          <Trash2 size={18} />
          删除
        </button>
        <button className="outline compact" onClick={restoreDefaults} type="button" title="恢复为默认域名列表">
          <RotateCcw size={18} />
          恢复默认
        </button>
      </div>

      <div className="rules-table">
        <div className="table-row table-head">
          <input
            aria-label={`选择全部${title}`}
            checked={allFilteredSelected}
            className="rule-check"
            disabled={filtered.length === 0}
            onChange={toggleAll}
            type="checkbox"
          />
          <span>域名</span>
          <span>操作</span>
        </div>
        {filtered.map((domain) => (
          <div className="table-row" key={domain}>
            <input
              aria-label={`选择 ${domain}`}
              checked={selected.has(domain)}
              className="rule-check"
              onChange={() => toggleSelected(domain)}
              type="checkbox"
            />
            <strong>{domain}</strong>
            <button
              className="row-action danger"
              onClick={() => deleteDomain(domain)}
              title="删除"
              type="button"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {filtered.length === 0 ? (
          <div className="table-row empty">
            <span>{query.trim() ? "无匹配域名" : "暂无域名，在上方输入并添加"}</span>
          </div>
        ) : null}
      </div>

      <div className="table-footer">
        <span>
          共 {filtered.length} 条{selectedVisibleCount > 0 ? `，已选 ${selectedVisibleCount} 条` : ""}
        </span>
      </div>
    </div>
  );
}
