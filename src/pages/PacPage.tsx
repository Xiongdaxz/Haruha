import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Globe2,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
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
import type { PacRule } from "../lib/types";
import type { PacRuleTab, RuleListSortField, RuleListSortState } from "../app/types";

interface PacPageProps {
  activePacTab: PacRuleTab;
  query: string;
  filteredRules: PacRule[];
  selectedRuleIds: Set<string>;
  allFilteredSelected: boolean;
  selectedVisibleRuleCount: number;
  pacUrl: string;
  proxyRuleCount: number;
  directRuleCount: number;
  disabledRuleCount: number;
  listEnabled: boolean;
  sortState: RuleListSortState | null;
  onPacTabChange: (tab: PacRuleTab) => void;
  onQueryChange: (value: string) => void;
  onAddRule: (ruleInput?: string) => void;
  onDeleteSelectedRules: () => void;
  onResetRules: () => void;
  onSortRules: (field: RuleListSortField) => void;
  onActivatePausedRule: (ruleId: string) => void;
  onToggleAllFilteredRules: () => void;
  onToggleRuleSelected: (ruleId: string) => void;
  onUpdateRule: (ruleId: string, updater: (rule: PacRule) => PacRule, logMessage: string) => void;
  onDeleteRule: (ruleId: string) => void;
  onCopy: (value: string, label: string) => void;
}

export function PacPage({
  activePacTab,
  query,
  filteredRules,
  selectedRuleIds,
  allFilteredSelected,
  selectedVisibleRuleCount,
  pacUrl,
  proxyRuleCount,
  directRuleCount,
  disabledRuleCount,
  listEnabled,
  sortState,
  onPacTabChange,
  onQueryChange,
  onAddRule,
  onDeleteSelectedRules,
  onResetRules,
  onSortRules,
  onActivatePausedRule,
  onToggleAllFilteredRules,
  onToggleRuleSelected,
  onUpdateRule,
  onDeleteRule,
  onCopy,
}: PacPageProps) {
  const queryInputRef = useRef<HTMLInputElement>(null);
  const [pendingStrategyRule, setPendingStrategyRule] = useState<PacRule | null>(null);
  const [pendingDeleteRule, setPendingDeleteRule] = useState<PacRule | null>(null);
  const [pendingAddOptions, setPendingAddOptions] = useState<UnifiedRuleAddOptions | null>(null);
  const [isDeleteSelectedConfirmOpen, setDeleteSelectedConfirmOpen] = useState(false);

  function handleAddRule() {
    const normalized = normalizeUnifiedRuleInput(query);
    if (!normalized) {
      queryInputRef.current?.focus();
      onAddRule(normalized);
      return;
    }
    onQueryChange(normalized);
    const options = unifiedRuleAddOptions(normalized);
    if (options) {
      setPendingAddOptions(options);
      return;
    }
    onAddRule(normalized);
  }

  function confirmStrategyChange() {
    if (!pendingStrategyRule) return;
    const nextStrategy = pendingStrategyRule.strategy === "proxy" ? "direct" : "proxy";
    onUpdateRule(
      pendingStrategyRule.id,
      (current) => ({ ...current, strategy: nextStrategy }),
      `${pendingStrategyRule.domain} 策略已切换`,
    );
    setPendingStrategyRule(null);
  }

  function confirmRuleDelete() {
    if (!pendingDeleteRule) return;
    onDeleteRule(pendingDeleteRule.id);
    setPendingDeleteRule(null);
  }

  function confirmSelectedRulesDelete() {
    onDeleteSelectedRules();
    setDeleteSelectedConfirmOpen(false);
  }

  return (
    <>
      <section className="panel rules-panel">
        <div className="panel-heading">
          <div className="rules-toolbar">
            <div className={`rule-tabs rule-tabs-${activePacTab}`}>
              <button className={activePacTab === "proxy" ? "active" : ""} onClick={() => onPacTabChange("proxy")}>
                需要代理
              </button>
              <button className={activePacTab === "direct" ? "active" : ""} onClick={() => onPacTabChange("direct")}>
                不需要代理
              </button>
            </div>
            <button
              aria-label="恢复默认PAC规则"
              className="outline pac-rules-reset"
              onClick={onResetRules}
              title="恢复默认PAC规则"
              type="button"
            >
              <RotateCcw size={18} />
            </button>
          </div>
          <div className="table-actions">
            <div className="search-field">
              <Search size={18} />
              <input
                placeholder={`搜索或输入${activePacTab === "proxy" ? "需要代理" : "不需要代理"}的域名`}
                ref={queryInputRef}
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData("text");
                  const normalized = normalizeUnifiedRuleInput(pasted);
                  if (normalized && normalized !== pasted.trim().toLowerCase()) {
                    event.preventDefault();
                    onQueryChange(normalized);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleAddRule();
                  }
                }}
              />
            </div>
            <button className="outline compact" onClick={handleAddRule} type="button">
              <Plus size={18} />
              添加
            </button>
            <button
              className="outline danger compact"
              disabled={selectedVisibleRuleCount === 0}
              onClick={() => setDeleteSelectedConfirmOpen(true)}
              type="button"
            >
              <Trash2 size={18} />
              删除
            </button>
          </div>
        </div>

        <div className="rules-table">
          <div className="table-row table-head">
            <input
              aria-label="选择当前列表全部规则"
              checked={allFilteredSelected}
              className="rule-check"
              disabled={filteredRules.length === 0}
              onChange={onToggleAllFilteredRules}
              type="checkbox"
            />
            <SortableColumnButton field="domain" label="域名" onSort={onSortRules} sortState={sortState} />
            <SortableColumnButton field="strategy" label="策略" onSort={onSortRules} sortState={sortState} />
            <SortableColumnButton field="type" label="类型" onSort={onSortRules} sortState={sortState} />
            <SortableColumnButton field="status" label="状态" onSort={onSortRules} sortState={sortState} />
            <span>操作</span>
          </div>
          {filteredRules.map((rule) => {
            const effectiveRuleEnabled = listEnabled && rule.enabled;
            return (
            <div className="table-row" key={rule.id}>
              <input
                aria-label={`选择 ${rule.domain}`}
                checked={selectedRuleIds.has(rule.id)}
                className="rule-check"
                onChange={() => onToggleRuleSelected(rule.id)}
                type="checkbox"
              />
              <strong>{rule.domain}</strong>
              <button
                className={`tag strategy-tag${rule.strategy === "direct" ? " direct" : ""}`}
                onClick={() => setPendingStrategyRule(rule)}
                title="确认后切换代理策略"
                type="button"
              >
                {rule.strategy === "proxy" ? "代理" : "直连"}
              </button>
              <span className="tag green">{ruleTypeLabel(rule.domain)}</span>
              <button
                className={
                  !listEnabled
                    ? "state-cell rule-state paused"
                    : effectiveRuleEnabled
                      ? "state-cell rule-state"
                      : "state-cell rule-state muted"
                }
                onClick={() =>
                  listEnabled
                    ? onUpdateRule(
                        rule.id,
                        (current) => ({ ...current, enabled: !current.enabled }),
                        `${rule.domain} 已${rule.enabled ? "停用" : "启用"}`,
                      )
                    : onActivatePausedRule(rule.id)
                }
                title={
                  listEnabled
                    ? "切换规则状态"
                    : `启用此规则并开启${activePacTab === "proxy" ? "代理名单" : "直连名单"}总开关`
                }
                type="button"
              >
                <i />
                {!listEnabled ? "停用" : rule.enabled ? "生效" : "停用"}
              </button>
              <button
                className="row-action danger"
                onClick={() => setPendingDeleteRule(rule)}
                title="删除规则"
                type="button"
              >
                <Trash2 size={16} />
              </button>
            </div>
            );
          })}
          {filteredRules.length === 0 ? (
            <div className="table-row empty">
              <span>{query.trim() ? "无匹配域名" : "暂无域名，在上方输入并添加"}</span>
            </div>
          ) : null}
        </div>

        <div className="table-footer">
          <span>
            共 {filteredRules.length} 条
            {selectedVisibleRuleCount > 0 ? `，已选 ${selectedVisibleRuleCount} 条` : ""}
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

      <aside className="right-stack">
        <section className="panel pac-config-card">
          <div className="panel-heading inline">
            <div className="pac-title">
              <span className="pac-title-icon">
                <Globe2 size={18} />
              </span>
              <div>
                <h2>PAC配置</h2>
                <p>自动配置文件与规则统计</p>
              </div>
            </div>
          </div>
          <button className="pac-url copy-button" onClick={() => onCopy(pacUrl, "PAC地址")} title="复制PAC地址">
            <span>
              <Globe2 size={15} />
              PAC地址
            </span>
            <strong>{pacUrl}</strong>
            <Copy size={16} />
          </button>
          <div className="pac-stats">
            <div className="proxy">
              <span>
                <ProxyIcon size={15} />
                代理
              </span>
              <strong>{proxyRuleCount}</strong>
            </div>
            <div className="direct">
              <span>
                <ShieldCheck size={15} />
                直连
              </span>
              <strong>{directRuleCount}</strong>
            </div>
            <div className="disabled">
              <span>
                <Trash2 size={15} />
                停用
              </span>
              <strong>{disabledRuleCount}</strong>
            </div>
          </div>
          <div className="pac-hint">
            <ShieldCheck size={16} />
            <span>每条规则都可独立切换策略与状态，修改会同步到统一名单。</span>
          </div>
        </section>
      </aside>

      <ConfirmDialog
        confirmLabel={`切换为${pendingStrategyRule?.strategy === "proxy" ? "直连" : "代理"}`}
        description={
          pendingStrategyRule
            ? `确定将 ${pendingStrategyRule.domain} 从${pendingStrategyRule.strategy === "proxy" ? "代理" : "直连"}切换为${pendingStrategyRule.strategy === "proxy" ? "直连" : "代理"}？确认后会同步移动到对应统一名单。`
            : ""
        }
        icon="switch"
        isOpen={pendingStrategyRule !== null}
        onCancel={() => setPendingStrategyRule(null)}
        onConfirm={confirmStrategyChange}
        title="确认切换策略"
      />
      <ConfirmDialog
        confirmLabel="确认删除"
        description={
          pendingDeleteRule
            ? `确定删除 ${pendingDeleteRule.domain}？删除后会从对应统一名单中移除。`
            : ""
        }
        icon="delete"
        isOpen={pendingDeleteRule !== null}
        onCancel={() => setPendingDeleteRule(null)}
        onConfirm={confirmRuleDelete}
        title="删除 PAC 规则？"
      />
      <ConfirmDialog
        confirmLabel="确认删除"
        description={`确定删除已选择的 ${selectedVisibleRuleCount} 条 PAC 规则？此操作会同步更新统一名单。`}
        icon="delete"
        isOpen={isDeleteSelectedConfirmOpen}
        onCancel={() => setDeleteSelectedConfirmOpen(false)}
        onConfirm={confirmSelectedRulesDelete}
        title="批量删除 PAC 规则？"
      />
      <RuleAddDialog
        listLabel={activePacTab === "proxy" ? "代理名单" : "直连名单"}
        onCancel={() => setPendingAddOptions(null)}
        onConfirm={(rule) => {
          setPendingAddOptions(null);
          onAddRule(rule);
        }}
        options={pendingAddOptions}
      />
    </>
  );
}
