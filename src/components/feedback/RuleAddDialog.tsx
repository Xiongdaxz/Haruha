import { useState } from "react";
import type { UnifiedRuleAddOptions } from "../../lib/rules";
import { ConfirmDialog } from "./ConfirmDialog";

type RuleAddMode = "wildcard" | "single";

interface RuleAddDialogProps {
  listLabel: string;
  onCancel: () => void;
  onConfirm: (rule: string) => void;
  options: UnifiedRuleAddOptions | null;
}

export function RuleAddDialog({ listLabel, onCancel, onConfirm, options }: RuleAddDialogProps) {
  if (!options) return null;
  return <OpenRuleAddDialog listLabel={listLabel} onCancel={onCancel} onConfirm={onConfirm} options={options} />;
}

function OpenRuleAddDialog({ listLabel, onCancel, onConfirm, options }: RuleAddDialogProps & { options: UnifiedRuleAddOptions }) {
  const [mode, setMode] = useState<RuleAddMode>("wildcard");

  return (
    <ConfirmDialog
      confirmLabel="确认添加"
      description={`请选择添加到${listLabel}的匹配范围，默认使用通配符域名。`}
      dialogRole="dialog"
      icon="add"
      initialFocus="none"
      isOpen
      onCancel={onCancel}
      onConfirm={() => {
        if (!options) return;
        onConfirm(mode === "wildcard" ? options.wildcardDomain : options.singleDomain);
      }}
      title="选择域名格式"
    >
      <div aria-label="域名格式" className="rule-add-options" role="radiogroup">
        <button
          aria-checked={mode === "wildcard"}
          autoFocus
          className={mode === "wildcard" ? "rule-add-option selected" : "rule-add-option"}
          onClick={() => setMode("wildcard")}
          role="radio"
          type="button"
        >
          <span className="rule-add-option-radio" aria-hidden="true"><i /></span>
          <span>
            <strong>通配符域名</strong>
            <small>匹配主域名下的子域名</small>
          </span>
          <code>{options.wildcardDomain}</code>
        </button>
        <button
          aria-checked={mode === "single"}
          className={mode === "single" ? "rule-add-option selected" : "rule-add-option"}
          onClick={() => setMode("single")}
          role="radio"
          type="button"
        >
          <span className="rule-add-option-radio" aria-hidden="true"><i /></span>
          <span>
            <strong>单域名</strong>
            <small>仅匹配当前输入的主机</small>
          </span>
          <code>{options.singleDomain}</code>
        </button>
      </div>
    </ConfirmDialog>
  );
}
