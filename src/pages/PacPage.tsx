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
import { useRef } from "react";
import { ProxyIcon } from "../app/constants";
import type { PacRule } from "../lib/types";
import type { PacRuleTab } from "../app/types";

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
  onPacTabChange: (tab: PacRuleTab) => void;
  onQueryChange: (value: string) => void;
  onAddRule: () => void;
  onDeleteSelectedRules: () => void;
  onResetRules: () => void;
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
  onPacTabChange,
  onQueryChange,
  onAddRule,
  onDeleteSelectedRules,
  onResetRules,
  onToggleAllFilteredRules,
  onToggleRuleSelected,
  onUpdateRule,
  onDeleteRule,
  onCopy,
}: PacPageProps) {
  const queryInputRef = useRef<HTMLInputElement>(null);

  function handleAddRule() {
    if (!query.trim()) {
      queryInputRef.current?.focus();
    }
    onAddRule();
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
            <button className="outline danger compact" onClick={onDeleteSelectedRules}>
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
              disabled={!filteredRules.some((rule) => !rule.readonly || rule.source === "builtin")}
              onChange={onToggleAllFilteredRules}
              type="checkbox"
            />
            <span>域名</span>
            <span>策略</span>
            <span>状态</span>
            <span>备注</span>
            <span>操作</span>
          </div>
          {filteredRules.map((rule) => (
            <div className="table-row" key={rule.id}>
              <input
                aria-label={`选择 ${rule.domain}`}
                checked={selectedRuleIds.has(rule.id)}
                className="rule-check"
                disabled={rule.readonly && rule.source !== "builtin"}
                onChange={() => onToggleRuleSelected(rule.id)}
                type="checkbox"
              />
              <strong>{rule.domain}</strong>
              <button
                className={`tag strategy-tag${rule.strategy === "direct" ? " direct" : ""}${
                  rule.readonly ? " locked" : ""
                }`}
                disabled={rule.readonly}
                title={rule.readonly ? "内置规则策略固定为直连" : "切换代理策略"}
                onClick={() =>
                  onUpdateRule(
                    rule.id,
                    (current) => ({
                      ...current,
                      strategy: current.strategy === "proxy" ? "direct" : "proxy",
                    }),
                    `${rule.domain} 策略已切换`,
                  )
                }
              >
                {rule.strategy === "proxy" ? "代理" : "直连"}
              </button>
              <button
                className={rule.enabled ? "state-cell rule-state" : "state-cell rule-state muted"}
                disabled={rule.readonly && rule.source !== "builtin"}
                title={
                  rule.source === "builtin"
                    ? "切换内置规则状态（可通过恢复默认重置）"
                    : rule.readonly
                      ? "此规则状态不可修改"
                      : "切换规则状态"
                }
                onClick={() =>
                  onUpdateRule(
                    rule.id,
                    (current) => ({ ...current, enabled: !current.enabled }),
                    `${rule.domain} 已${rule.enabled ? "停用" : "启用"}`,
                  )
                }
              >
                <i />
                {rule.enabled ? "生效" : "停用"}
              </button>
              <span>{rule.note}</span>
              {rule.readonly && rule.source !== "builtin" ? (
                <button className="row-action danger disabled" disabled title="不可删除">
                  <Trash2 size={16} />
                </button>
              ) : (
                <button
                  className="row-action danger"
                  onClick={() => onDeleteRule(rule.id)}
                  title={rule.source === "builtin" ? "删除内置规则（可通过恢复默认找回）" : "删除规则"}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="table-footer">
          <span>
            共 {filteredRules.length} 条{selectedVisibleRuleCount > 0 ? `，已选 ${selectedVisibleRuleCount} 条` : ""}
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
            <span>右侧切换代理或直连规则，PAC会按规则集生成。</span>
          </div>
        </section>
      </aside>
    </>
  );
}
