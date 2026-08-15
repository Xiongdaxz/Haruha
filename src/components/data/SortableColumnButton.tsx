import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { RuleListSortField, RuleListSortState } from "../../app/types";

interface SortableColumnButtonProps {
  field: RuleListSortField;
  label: string;
  sortState: RuleListSortState | null;
  onSort: (field: RuleListSortField) => void;
}

export function SortableColumnButton({ field, label, sortState, onSort }: SortableColumnButtonProps) {
  const isActive = sortState?.field === field;
  const direction = isActive ? sortState.direction : null;
  const nextActionLabel = direction === "asc" ? "降序排列" : direction === "desc" ? "恢复默认顺序" : "升序排列";

  return (
    <button
      aria-label={direction === "desc" ? `${label}恢复默认顺序` : `按${label}${nextActionLabel}`}
      aria-pressed={isActive}
      className={isActive ? "table-sort-button active" : "table-sort-button"}
      onClick={() => onSort(field)}
      title={direction === "desc" ? `${label}恢复默认顺序` : `按${label}${nextActionLabel}`}
      type="button"
    >
      {label}
      {direction === "asc" ? (
        <ArrowUp aria-hidden="true" size={14} />
      ) : direction === "desc" ? (
        <ArrowDown aria-hidden="true" size={14} />
      ) : (
        <ArrowUpDown aria-hidden="true" size={14} />
      )}
    </button>
  );
}
