import type { PointerEvent as ReactPointerEvent } from "react";
import type { ResizableNavKey } from "../../app/types";

interface SplitResizerProps {
  view: ResizableNavKey | null;
  onPointerDown: (view: ResizableNavKey, event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function SplitResizer({ view, onPointerDown }: SplitResizerProps) {
  if (!view) return null;

  return (
    <div
      aria-label="拖动调整面板宽度"
      aria-orientation="vertical"
      className="split-resizer"
      onPointerDown={(event) => onPointerDown(view, event)}
      role="separator"
      title="拖动调整宽度"
    >
      <span />
    </div>
  );
}
