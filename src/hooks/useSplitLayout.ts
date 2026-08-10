import { useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { SPLIT_HANDLE_WIDTH, SPLIT_LIMITS, SPLIT_STORAGE_KEYS } from "../app/constants";
import { splitViewFromNav } from "../app/navigation";
import { readStoredSplitWidth } from "../app/storage";
import type { NavKey, ResizableNavKey } from "../app/types";

export function useSplitLayout(activeNav: NavKey) {
  const [splitLeftWidths, setSplitLeftWidths] = useState<Record<ResizableNavKey, number | null>>(() => ({
    config: readStoredSplitWidth("config"),
    pac: readStoredSplitWidth("pac"),
  }));

  const splitView = splitViewFromNav(activeNav);
  const contentStyle = splitView
    ? ({
        "--split-left-min": `${SPLIT_LIMITS[splitView].minLeft}px`,
        "--split-right-min": `${SPLIT_LIMITS[splitView].minRight}px`,
        "--split-handle-width": `${SPLIT_HANDLE_WIDTH}px`,
        ...(splitLeftWidths[splitView] ? { "--split-left-size": `${splitLeftWidths[splitView]}px` } : {}),
      } as CSSProperties)
    : undefined;

  function startSplitResize(view: ResizableNavKey, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const grid = event.currentTarget.closest(".content-grid");
    if (!(grid instanceof HTMLElement)) return;

    const limits = SPLIT_LIMITS[view];
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    let latestWidth = splitLeftWidths[view];
    let pendingClientX: number | null = null;
    let animationFrameId: number | null = null;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const updateWidth = (clientX: number) => {
      const rect = grid.getBoundingClientRect();
      const maxLeft = Math.max(limits.minLeft, rect.width - SPLIT_HANDLE_WIDTH - limits.minRight);
      const nextWidth = Math.round(Math.min(Math.max(clientX - rect.left, limits.minLeft), maxLeft));
      latestWidth = nextWidth;
      setSplitLeftWidths((current) => (current[view] === nextWidth ? current : { ...current, [view]: nextWidth }));
    };

    const scheduleWidthUpdate = (clientX: number) => {
      pendingClientX = clientX;
      if (animationFrameId !== null) return;

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        if (pendingClientX === null) return;
        updateWidth(pendingClientX);
        pendingClientX = null;
      });
    };

    const flushPendingWidth = () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      if (pendingClientX !== null) {
        updateWidth(pendingClientX);
        pendingClientX = null;
      }
      if (latestWidth !== null) {
        window.localStorage.setItem(SPLIT_STORAGE_KEYS[view], String(latestWidth));
      }
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      scheduleWidthUpdate(moveEvent.clientX);
    };

    const stopResize = () => {
      flushPendingWidth();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    updateWidth(event.clientX);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  return { contentStyle, splitView, startSplitResize };
}
