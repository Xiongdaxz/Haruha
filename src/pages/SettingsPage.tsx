import {
  CircleHelp,
  Copy,
  ExternalLink,
  FolderOpen,
  Github,
  Info,
  Palette,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { SortableColumnButton } from "../components/data/SortableColumnButton";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { RuleAddDialog } from "../components/feedback/RuleAddDialog";
import {
  APP_NAME,
  APP_VERSION,
  OPEN_SOURCE_REPOSITORY_URL,
  ProxyIcon,
  settingsItems,
  themeOptions,
} from "../app/constants";
import { defaultUnifiedLists } from "../lib/api";
import { ruleTypeLabel } from "../lib/format";
import { normalizeUnifiedRuleInput, unifiedRuleAddOptions } from "../lib/rules";
import type { UnifiedRuleAddOptions } from "../lib/rules";
import type { UnifiedLists } from "../lib/types";
import type {
  ResolvedTheme,
  RuleListSortField,
  RuleListSortState,
  SettingsKey,
  ThemePreference,
} from "../app/types";

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
  onOpenRepository: () => void;
  onCopy: (value: string | undefined, label: string) => void;
  onThemePreferenceChange: (theme: ThemePreference) => void;
  onChangeUnifiedLists: (next: UnifiedLists) => void;
  onSortUnifiedList: (kind: ListKind, field: RuleListSortField) => void;
  sortStates: Record<ListKind, RuleListSortState | null>;
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
  onOpenRepository,
  onCopy,
  onThemePreferenceChange,
  onChangeUnifiedLists,
  onSortUnifiedList,
  sortStates,
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
                onSort={(field) => onSortUnifiedList(activeUnifiedList, field)}
                sortState={sortStates[activeUnifiedList]}
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

        {activeSettings === "about" ? (
          <>
            <div className="settings-detail-head">
              <span className="settings-detail-icon">
                <Info size={20} />
              </span>
              <div>
                <h2>关于</h2>
                <p>版本与开源信息</p>
              </div>
            </div>

            <div className="about-card">
              <div className="about-product">
                <div>
                  <strong>{APP_NAME}</strong>
                  <span className="about-version">v{APP_VERSION}</span>
                </div>
                <p>轻量、跨平台的系统代理管理工具。</p>
              </div>

              <div className="about-repository">
                <span className="about-repository-label">
                  <Github aria-hidden="true" size={17} />
                  GitHub 开源仓库
                </span>
                <button
                  className="about-repository-address copy-button"
                  onClick={() => onCopy(OPEN_SOURCE_REPOSITORY_URL, "GitHub 开源地址")}
                  title="点击复制 GitHub 开源地址"
                  type="button"
                >
                  <code>{OPEN_SOURCE_REPOSITORY_URL}</code>
                  <Copy aria-hidden="true" size={17} />
                </button>
              </div>

              <div className="about-actions">
                <button className="primary" onClick={onOpenRepository} type="button">
                  <Github aria-hidden="true" size={17} />
                  打开 GitHub
                  <ExternalLink aria-hidden="true" size={15} />
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
  onSort: (field: RuleListSortField) => void;
  sortState: RuleListSortState | null;
}

function UnifiedListSection({ kind, unifiedLists, onChange, onSort, sortState }: UnifiedListSectionProps) {
  const isDirect = kind === "direct";
  const enabled = isDirect ? unifiedLists.directEnabled : unifiedLists.proxyEnabled;
  const domains = isDirect ? unifiedLists.directDomains : unifiedLists.proxyDomains;
  const disabledDomains = isDirect ? unifiedLists.disabledDirectDomains : unifiedLists.disabledProxyDomains;
  const disabledKeys = new Set(disabledDomains.map((domain) => domain.trim().toLowerCase()));
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isRestoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [pendingAddOptions, setPendingAddOptions] = useState<UnifiedRuleAddOptions | null>(null);
  const [pendingDeleteDomain, setPendingDeleteDomain] = useState<string | null>(null);
  const [isDeleteSelectedConfirmOpen, setDeleteSelectedConfirmOpen] = useState(false);
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
    const statusLabel = !enabled
      ? "停用"
      : disabledKeys.has(domain.trim().toLowerCase())
        ? "停用"
        : "生效";
    return (
      !keyword ||
      domain.toLowerCase().includes(keyword) ||
      ruleTypeLabel(domain).toLowerCase().includes(keyword) ||
      statusLabel.includes(keyword)
    );
  });

  const allFilteredSelected = filtered.length > 0 && filtered.every((item) => selected.has(item));
  const selectedVisibleCount = filtered.filter((item) => selected.has(item)).length;

  function setEnabled(next: boolean) {
    onChange(
      isDirect
        ? {
            ...unifiedLists,
            directEnabled: next,
            disabledDirectDomains: next ? [] : unifiedLists.disabledDirectDomains,
          }
        : {
            ...unifiedLists,
            proxyEnabled: next,
            disabledProxyDomains: next ? [] : unifiedLists.disabledProxyDomains,
          },
    );
  }

  function commitDomain(domain: string) {
    setPendingAddOptions(null);
    if (!domain || /\s/.test(domain)) {
      queryInputRef.current?.focus();
      return;
    }
    if (domains.some((item) => item === domain)) {
      setQuery("");
      return;
    }
    const nextDomains = [...domains, domain];
    const nextDisabledDomains = disabledDomains.filter((item) => item.trim().toLowerCase() !== domain.toLowerCase());
    onChange(
      isDirect
        ? { ...unifiedLists, directDomains: nextDomains, disabledDirectDomains: nextDisabledDomains }
        : { ...unifiedLists, proxyDomains: nextDomains, disabledProxyDomains: nextDisabledDomains },
    );
    setQuery("");
  }

  function addDomain() {
    const domain = normalizeUnifiedRuleInput(query);
    if (!domain || /\s/.test(domain)) {
      queryInputRef.current?.focus();
      return;
    }
    setQuery(domain);
    const options = unifiedRuleAddOptions(domain);
    if (options) {
      setPendingAddOptions(options);
      return;
    }
    commitDomain(domain);
  }

  function deleteDomain(domain: string) {
    const nextDomains = domains.filter((item) => item !== domain);
    const domainKey = domain.trim().toLowerCase();
    const nextDisabledDomains = disabledDomains.filter((item) => item.trim().toLowerCase() !== domainKey);
    onChange(
      isDirect
        ? { ...unifiedLists, directDomains: nextDomains, disabledDirectDomains: nextDisabledDomains }
        : { ...unifiedLists, proxyDomains: nextDomains, disabledProxyDomains: nextDisabledDomains },
    );
    setSelected((current) => {
      const next = new Set(current);
      next.delete(domain);
      return next;
    });
    setPendingDeleteDomain(null);
  }

  function deleteSelected() {
    const nextDomains = domains.filter((item) => !selected.has(item));
    const selectedKeys = new Set(Array.from(selected, (item) => item.trim().toLowerCase()));
    const nextDisabledDomains = disabledDomains.filter((item) => !selectedKeys.has(item.trim().toLowerCase()));
    onChange(
      isDirect
        ? { ...unifiedLists, directDomains: nextDomains, disabledDirectDomains: nextDisabledDomains }
        : { ...unifiedLists, proxyDomains: nextDomains, disabledProxyDomains: nextDisabledDomains },
    );
    setSelected(new Set());
    setDeleteSelectedConfirmOpen(false);
  }

  function restoreDefaults() {
    const defaultDomains = isDirect
      ? defaultUnifiedLists.directDomains
      : defaultUnifiedLists.proxyDomains;
    onChange(
      isDirect
        ? { ...unifiedLists, directDomains: [...defaultDomains], disabledDirectDomains: [] }
        : { ...unifiedLists, proxyDomains: [...defaultDomains], disabledProxyDomains: [] },
    );
    setSelected(new Set());
    setQuery("");
    setRestoreConfirmOpen(false);
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

  function toggleDomainEnabled(domain: string) {
    const domainKey = domain.trim().toLowerCase();
    if (!enabled) {
      const nextDisabledDomains = domains.filter(
        (item) => item.trim().toLowerCase() !== domainKey,
      );
      onChange(
        isDirect
          ? {
              ...unifiedLists,
              directEnabled: true,
              disabledDirectDomains: nextDisabledDomains,
            }
          : {
              ...unifiedLists,
              proxyEnabled: true,
              disabledProxyDomains: nextDisabledDomains,
            },
      );
      return;
    }
    const nextDisabledDomains = disabledKeys.has(domainKey)
      ? disabledDomains.filter((item) => item.trim().toLowerCase() !== domainKey)
      : [...disabledDomains.filter((item) => item.trim().toLowerCase() !== domainKey), domain];
    onChange(
      isDirect
        ? { ...unifiedLists, disabledDirectDomains: nextDisabledDomains }
        : { ...unifiedLists, disabledProxyDomains: nextDisabledDomains },
    );
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
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text");
              const normalized = normalizeUnifiedRuleInput(pasted);
              if (normalized && normalized !== pasted.trim().toLowerCase()) {
                event.preventDefault();
                setQuery(normalized);
              }
            }}
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
          onClick={() => setDeleteSelectedConfirmOpen(true)}
          disabled={selectedVisibleCount === 0}
          type="button"
        >
          <Trash2 size={18} />
          删除
        </button>
        <button
          className="outline compact"
          onClick={() => setRestoreConfirmOpen(true)}
          type="button"
          title="恢复为默认域名列表"
        >
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
          <SortableColumnButton field="domain" label="域名" onSort={onSort} sortState={sortState} />
          <SortableColumnButton field="type" label="类型" onSort={onSort} sortState={sortState} />
          <SortableColumnButton field="status" label="状态" onSort={onSort} sortState={sortState} />
          <span>操作</span>
        </div>
        {filtered.map((domain) => {
          const domainEnabled = !disabledKeys.has(domain.trim().toLowerCase());
          const effectiveDomainEnabled = enabled && domainEnabled;
          return (
            <div className="table-row unified-list-table-row" key={domain}>
              <input
                aria-label={`选择 ${domain}`}
                checked={selected.has(domain)}
                className="rule-check"
                onChange={() => toggleSelected(domain)}
                type="checkbox"
              />
              <strong>{domain}</strong>
              <span className="tag green">{ruleTypeLabel(domain)}</span>
              <button
                className={
                  !enabled
                    ? "state-cell rule-state paused"
                    : effectiveDomainEnabled
                      ? "state-cell rule-state"
                      : "state-cell rule-state muted"
                }
                onClick={() => toggleDomainEnabled(domain)}
                title={enabled ? "切换规则状态" : `启用此规则并开启${title}总开关`}
                type="button"
              >
                <i />
                {!enabled ? "停用" : domainEnabled ? "生效" : "停用"}
              </button>
              <button
                className="row-action danger"
                onClick={() => setPendingDeleteDomain(domain)}
                title="删除"
                type="button"
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
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

      <ConfirmDialog
        confirmLabel="确认删除"
        description={
          pendingDeleteDomain
            ? `确定从${title}中删除 ${pendingDeleteDomain}？其他页面中的对应规则也会同步移除。`
            : ""
        }
        icon="delete"
        isOpen={pendingDeleteDomain !== null}
        onCancel={() => setPendingDeleteDomain(null)}
        onConfirm={() => {
          if (pendingDeleteDomain) deleteDomain(pendingDeleteDomain);
        }}
        title={`从${title}删除规则？`}
      />
      <ConfirmDialog
        confirmLabel="确认删除"
        description={`确定从${title}中删除已选择的 ${selected.size} 条规则？其他页面中的对应规则也会同步移除。`}
        icon="delete"
        isOpen={isDeleteSelectedConfirmOpen}
        onCancel={() => setDeleteSelectedConfirmOpen(false)}
        onConfirm={deleteSelected}
        title={`批量删除${title}规则？`}
      />
      <ConfirmDialog
        confirmLabel="确认恢复"
        description={`确定恢复${title}为默认值？当前列表将被替换。`}
        isOpen={isRestoreConfirmOpen}
        onCancel={() => setRestoreConfirmOpen(false)}
        onConfirm={restoreDefaults}
        title={`恢复默认${title}？`}
      />
      <RuleAddDialog
        listLabel={title}
        onCancel={() => setPendingAddOptions(null)}
        onConfirm={commitDomain}
        options={pendingAddOptions}
      />
    </div>
  );
}
