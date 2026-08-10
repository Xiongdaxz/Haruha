import { RotateCcw, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

interface ConfirmDialogProps {
  confirmLabel?: string;
  description: string;
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}

export function ConfirmDialog({
  confirmLabel = "确认",
  description,
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

    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
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
        className="confirm-dialog"
        role="alertdialog"
      >
        <button aria-label="关闭确认框" className="confirm-dialog-close" onClick={onCancel} type="button">
          <X aria-hidden="true" size={17} />
        </button>
        <span className="confirm-dialog-icon" aria-hidden="true">
          <RotateCcw size={21} />
        </span>
        <div className="confirm-dialog-copy">
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{description}</p>
        </div>
        <div className="confirm-dialog-actions">
          <button className="outline neutral" onClick={onCancel} ref={cancelButtonRef} type="button">
            取消
          </button>
          <button className="primary" onClick={onConfirm} type="button">
            <RotateCcw aria-hidden="true" size={17} />
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
