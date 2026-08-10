import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Loader2, Plus, RotateCcw, Save, Search, Trash2 } from "lucide-react";
import { useRef } from "react";
import { ProxyIcon } from "../app/constants";
import { bypassTypeLabel } from "../lib/format";
import type { ProxyProfile } from "../lib/types";

interface ProxyConfigPageProps {
  profile: ProxyProfile;
  busyAction: string | null;
  bypassQuery: string;
  filteredBypassItems: string[];
  selectedBypassItems: Set<string>;
  allFilteredBypassSelected: boolean;
  selectedVisibleBypassCount: number;
  onUpdateProfile: <K extends keyof ProxyProfile>(key: K, value: ProxyProfile[K]) => void;
  onTestProxy: () => void;
  onSaveProfile: () => void;
  onOpenGoogle: () => void;
  onResetDefaults: () => void;
  onBypassQueryChange: (value: string) => void;
  onAddBypassItem: () => void;
  onDeleteSelectedBypassItems: () => void;
  onToggleAllFilteredBypassItems: () => void;
  onToggleBypassSelected: (item: string) => void;
  onDeleteBypassItem: (item: string) => void;
}

export function ProxyConfigPage({
  profile,
  busyAction,
  bypassQuery,
  filteredBypassItems,
  selectedBypassItems,
  allFilteredBypassSelected,
  selectedVisibleBypassCount,
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
}: ProxyConfigPageProps) {
  const bypassInputRef = useRef<HTMLInputElement>(null);

  function handleAddBypassItem() {
    if (!bypassQuery.trim()) {
      bypassInputRef.current?.focus();
    }
    onAddBypassItem();
  }

  return (
    <>
      <section className="panel proxy-panel">
        <h2>代理配置</h2>
        <label>
          代理地址
          <input value={profile.host} onChange={(event) => onUpdateProfile("host", event.target.value)} />
        </label>
        <label>
          端口
          <input type="number" value={profile.port} onChange={(event) => onUpdateProfile("port", Number(event.target.value))} />
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
          <button className="outline" disabled={busyAction === "test"} onClick={onTestProxy}>
            {busyAction === "test" ? <Loader2 className="spin" size={18} /> : <ProxyIcon size={18} />}
            测试代理
          </button>
          <button className="primary" disabled={busyAction === "save-config"} onClick={onSaveProfile}>
            {busyAction === "save-config" ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
            保存配置
          </button>
          <button className="outline" disabled={busyAction === "open-google"} onClick={onOpenGoogle}>
            {busyAction === "open-google" ? <Loader2 className="spin" size={18} /> : <ExternalLink size={18} />}
            打开Google
          </button>
          <button className="outline neutral" onClick={onResetDefaults}>
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
              <p>系统代理绕过列表</p>
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
            <button className="outline danger compact" onClick={onDeleteSelectedBypassItems}>
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
            <span>地址/规则</span>
            <span>类型</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          {filteredBypassItems.map((item) => (
            <div className="table-row bypass-table-row" key={item}>
              <input
                aria-label={`选择 ${item}`}
                checked={selectedBypassItems.has(item)}
                className="rule-check"
                onChange={() => onToggleBypassSelected(item)}
                type="checkbox"
              />
              <strong>{item}</strong>
              <span className="tag green">{bypassTypeLabel(item)}</span>
              <span className="state-cell rule-state">
                <i />
                生效
              </span>
              <button className="row-action danger" onClick={() => onDeleteBypassItem(item)} title="删除规则">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
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
    </>
  );
}
