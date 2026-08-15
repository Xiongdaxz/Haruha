import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { ProxyIcon } from "../app/constants";
import { SortableColumnButton } from "../components/data/SortableColumnButton";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { RuleAddDialog } from "../components/feedback/RuleAddDialog";
import { ruleTypeLabel } from "../lib/format";
import { normalizeUnifiedRuleInput, unifiedRuleAddOptions } from "../lib/rules";
import type { UnifiedRuleAddOptions } from "../lib/rules";
import type { ProxyProfile } from "../lib/types";
import type { RuleListSortField, RuleListSortState } from "../app/types";

interface ProxyConfigPageProps {
  profile: ProxyProfile;
  busyAction: string | null;
  bypassQuery: string;
  filteredBypassItems: string[];
  disabledBypassItemKeys: Set<string>;
  bypassListEnabled: boolean;
  selectedBypassItems: Set<string>;
  allFilteredBypassSelected: boolean;
  selectedVisibleBypassCount: number;
  sortState: RuleListSortState | null;
  onUpdateProfile: <K extends keyof ProxyProfile>(key: K, value: ProxyProfile[K]) => void;
  onTestProxy: () => void;
  onSaveProfile: () => void;
  onOpenGoogle: () => void;
  onResetDefaults: () => void;
  onBypassQueryChange: (value: string) => void;
  onAddBypassItem: (ruleInput?: string) => void;
  onDeleteSelectedBypassItems: () => void;
  onToggleAllFilteredBypassItems: () => void;
  onToggleBypassSelected: (item: string) => void;
  onDeleteBypassItem: (item: string) => void;
  onActivatePausedBypassItem: (item: string) => void;
  onToggleBypassItemEnabled: (item: string) => void;
  onSortBypassItems: (field: RuleListSortField) => void;
}

export function ProxyConfigPage({
  profile,
  busyAction,
  bypassQuery,
  filteredBypassItems,
  disabledBypassItemKeys,
  bypassListEnabled,
  selectedBypassItems,
  allFilteredBypassSelected,
  selectedVisibleBypassCount,
  sortState,
  onUpdateProfile,
  onTestProxy,
  onSaveProfile,
  onOpenGoogle,
  onResetDefaults,
  onBypassQueryChange,
  onAddBypassItem,
  onDeleteSelectedBypassItems,
  onToggleAllFilteredBypassItems,
  onToggleBypassSelected,
  onDeleteBypassItem,
  onActivatePausedBypassItem,
  onToggleBypassItemEnabled,
  onSortBypassItems,
}: ProxyConfigPageProps) {
  const bypassInputRef = useRef<HTMLInputElement>(null);
  const [pendingAddOptions, setPendingAddOptions] = useState<UnifiedRuleAddOptions | null>(null);
  const [pendingDeleteBypassItem, setPendingDeleteBypassItem] = useState<string | null>(null);
  const [isDeleteSelectedConfirmOpen, setDeleteSelectedConfirmOpen] = useState(false);

  function handleAddBypassItem() {
    const normalized = normalizeUnifiedRuleInput(bypassQuery);
    if (!normalized) {
      bypassInputRef.current?.focus();
      onAddBypassItem(normalized);
      return;
    }
    onBypassQueryChange(normalized);
    const options = unifiedRuleAddOptions(normalized);
    if (options) {
      setPendingAddOptions(options);
      return;
    }
    onAddBypassItem(normalized);
  }

  function confirmBypassItemDelete() {
    if (!pendingDeleteBypassItem) return;
    onDeleteBypassItem(pendingDeleteBypassItem);
    setPendingDeleteBypassItem(null);
  }

  function confirmSelectedBypassItemsDelete() {
    onDeleteSelectedBypassItems();
    setDeleteSelectedConfirmOpen(false);
  }

  return (
    <>
      <section className="panel proxy-panel">
        <h2>代理配置</h2>
        <label>
          代理地址
          <input
            required
            value={profile.host}
            onChange={(event) => onUpdateProfile("host", event.target.value)}
            placeholder="例如 127.0.0.1"
          />
        </label>
        <label>
          端口
          <input
            required
            type="number"
            min={1}
            max={65535}
            value={profile.port}
            onChange={(event) => onUpdateProfile("port", Number(event.target.value))}
          />
        </label>
        <label className="proxy-option">
          <input
            checked={profile.bypassLocal}
            className="rule-check"
            onChange={(event) => onUpdateProfile("bypassLocal", event.target.checked)}
            type="checkbox"
          />
          <span>请勿将代理服务器用于本地(Intranet)地址</span>
        </label>
        <div className="action-grid">
          <button className="outline" disabled={busyAction === "test"} onClick={onTestProxy} type="button">
            {busyAction === "test" ? <Loader2 className="spin" size={18} /> : <ProxyIcon size={18} />}
            测试代理
          </button>
          <button className="primary" disabled={busyAction === "save-config"} onClick={onSaveProfile} type="button">
            {busyAction === "save-config" ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
            保存配置
          </button>
          <button className="outline" disabled={busyAction === "open-google"} onClick={onOpenGoogle} type="button">
            {busyAction === "open-google" ? <Loader2 className="spin" size={18} /> : <ExternalLink size={18} />}
            打开Google
          </button>
          <button className="outline neutral" onClick={onResetDefaults} type="button">
            <RotateCcw size={18} />
            恢复默认
          </button>
        </div>
      </section>

      <section className="panel system-bypass-panel">
        <div className="panel-heading">
          <div className="rules-toolbar">
            <div>
              <h2>不走代理</h2>
              <p>统一直连名单（手动模式走系统绕过，PAC 模式强制直连）</p>
            </div>
            <span className="tag green">直连</span>
          </div>
          <div className="table-actions">
            <div className="search-field">
              <Search size={18} />
              <input
                placeholder="搜索或输入不走代理地址"
                ref={bypassInputRef}
                value={bypassQuery}
                onChange={(event) => onBypassQueryChange(event.target.value)}
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData("text");
                  const normalized = normalizeUnifiedRuleInput(pasted);
                  if (normalized && normalized !== pasted.trim().toLowerCase()) {
                    event.preventDefault();
                    onBypassQueryChange(normalized);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleAddBypassItem();
                  }
                }}
              />
            </div>
            <button className="outline compact" onClick={handleAddBypassItem} type="button">
              <Plus size={18} />
              添加
            </button>
            <button
              className="outline danger compact"
              disabled={selectedVisibleBypassCount === 0}
              onClick={() => setDeleteSelectedConfirmOpen(true)}
              type="button"
            >
              <Trash2 size={18} />
              删除
            </button>
          </div>
        </div>

        <div className="rules-table">
          <div className="table-row table-head bypass-table-row">
            <input
              aria-label="选择当前列表全部不走代理规则"
              checked={allFilteredBypassSelected}
              className="rule-check"
              onChange={onToggleAllFilteredBypassItems}
              type="checkbox"
            />
            <SortableColumnButton field="domain" label="地址/规则" onSort={onSortBypassItems} sortState={sortState} />
            <SortableColumnButton field="type" label="类型" onSort={onSortBypassItems} sortState={sortState} />
            <SortableColumnButton field="status" label="状态" onSort={onSortBypassItems} sortState={sortState} />
            <span>操作</span>
          </div>
          {filteredBypassItems.map((item) => {
            const enabled = !disabledBypassItemKeys.has(item.trim().toLowerCase());
            const effectiveEnabled = bypassListEnabled && enabled;
            return (
            <div className="table-row bypass-table-row" key={item}>
              <input
                aria-label={`选择 ${item}`}
                checked={selectedBypassItems.has(item)}
                className="rule-check"
                onChange={() => onToggleBypassSelected(item)}
                type="checkbox"
              />
              <strong>{item}</strong>
              <span className="tag green">{ruleTypeLabel(item)}</span>
              <button
                className={
                  !bypassListEnabled
                    ? "state-cell rule-state paused"
                    : effectiveEnabled
                      ? "state-cell rule-state"
                      : "state-cell rule-state muted"
                }
                onClick={() =>
                  bypassListEnabled
                    ? onToggleBypassItemEnabled(item)
                    : onActivatePausedBypassItem(item)
                }
                title={
                  bypassListEnabled
                    ? "切换规则状态"
                    : "启用此规则并开启直连名单总开关"
                }
                type="button"
              >
                <i />
                {!bypassListEnabled ? "停用" : enabled ? "生效" : "停用"}
              </button>
              <button
                className="row-action danger"
                onClick={() => setPendingDeleteBypassItem(item)}
                title="删除规则"
                type="button"
              >
                <Trash2 size={16} />
              </button>
            </div>
            );
          })}
        </div>

        <div className="table-footer">
          <span>
            共 {filteredBypassItems.length} 条{selectedVisibleBypassCount > 0 ? `，已选 ${selectedVisibleBypassCount} 条` : ""}
          </span>
          <div className="pager">
            <button>
              <ChevronLeft size={16} />
            </button>
            <button className="current">1</button>
            <button>
              <ChevronRight size={16} />
            </button>
          </div>
          <button className="page-size">
            10 条/页
            <ChevronDown size={16} />
          </button>
        </div>
      </section>
      <ConfirmDialog
        confirmLabel="确认删除"
        description={
          pendingDeleteBypassItem
            ? `确定删除 ${pendingDeleteBypassItem}？该规则也会从 PAC 直连名单中移除。`
            : ""
        }
        icon="delete"
        isOpen={pendingDeleteBypassItem !== null}
        onCancel={() => setPendingDeleteBypassItem(null)}
        onConfirm={confirmBypassItemDelete}
        title="删除不走代理规则？"
      />
      <ConfirmDialog
        confirmLabel="确认删除"
        description={`确定删除已选择的 ${selectedVisibleBypassCount} 条不走代理规则？此操作会同步更新 PAC 直连名单。`}
        icon="delete"
        isOpen={isDeleteSelectedConfirmOpen}
        onCancel={() => setDeleteSelectedConfirmOpen(false)}
        onConfirm={confirmSelectedBypassItemsDelete}
        title="批量删除不走代理规则？"
      />
      <RuleAddDialog
        listLabel="直连名单"
        onCancel={() => setPendingAddOptions(null)}
        onConfirm={(rule) => {
          setPendingAddOptions(null);
          onAddBypassItem(rule);
        }}
        options={pendingAddOptions}
      />
    </>
  );
}
