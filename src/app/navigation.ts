import type { NavKey, ResizableNavKey } from "./types";

export function splitViewFromNav(nav: NavKey): ResizableNavKey | null {
  return nav === "config" || nav === "pac" ? nav : null;
}
