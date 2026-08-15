import { ArrowLeftRight, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

interface ConfirmDialogProps {
  children?: ReactNode;
  confirmLabel?: string;
  description: string;
  dialogRole?: "alertdialog" | "dialog";
  icon?: "add" | "delete" | "reset" | "switch";
  initialFocus?: "cancel" | "none";
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}

export function ConfirmDialog({
  children,
  confirmLabel = "确认",
  description,
  dialogRole = "alertdialog",
  icon = "reset",
  initialFocus = "cancel",
  isOpen,
  onCancel,
  onConfirm,
  title,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (initialFocus === "cancel") cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [initialFocus, isOpen, onCancel]);

  if (!isOpen) return null;
  const ActionIcon = icon === "add" ? Plus : icon === "switch" ? ArrowLeftRight : icon === "delete" ? Trash2 : RotateCcw;
  const isDelete = icon === "delete";

  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={isDelete ? "confirm-dialog danger" : "confirm-dialog"}
        role={dialogRole}
      >
        <button aria-label="关闭确认框" className="confirm-dialog-close" onClick={onCancel} type="button">
          <X aria-hidden="true" size={17} />
        </button>
        <span className="confirm-dialog-icon" aria-hidden="true">
          <ActionIcon size={21} />
        </span>
        <div className="confirm-dialog-copy">
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{description}</p>
        </div>
        {children ? <div className="confirm-dialog-content">{children}</div> : null}
        <div className="confirm-dialog-actions">
          <button className="outline neutral" onClick={onCancel} ref={cancelButtonRef} type="button">
            取消
          </button>
          <button className={isDelete ? "primary danger" : "primary"} onClick={onConfirm} type="button">
            <ActionIcon aria-hidden="true" size={17} />
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
