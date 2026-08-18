import { Download, X } from "lucide-react";
import type { UpdateInfo } from "../../lib/types";

interface UpdateNoticeProps {
  update: UpdateInfo;
  onDismiss: () => void;
  onView: () => void;
}

export function UpdateNotice({ update, onDismiss, onView }: UpdateNoticeProps) {
  return (
    <aside className="update-notice" aria-label={`发现新版本 v${update.version}`} role="status">
      <span className="update-notice-icon" aria-hidden="true">
        <Download size={19} />
      </span>
      <span className="update-notice-copy">
        <strong>发现新版本 v{update.version}</strong>
        <small>便携版可以在应用内完成更新</small>
      </span>
      <button className="update-notice-view" onClick={onView} type="button">
        查看更新
      </button>
      <button aria-label="暂时关闭更新提醒" className="update-notice-close" onClick={onDismiss} title="稍后提醒" type="button">
        <X size={16} />
      </button>
    </aside>
  );
}
