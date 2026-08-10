import { Copy } from "lucide-react";
import type { IpInfo } from "../../lib/types";

interface InfoCardProps {
  copyLabel: string;
  copyValue: string;
  title: string;
  info: IpInfo | null;
  fallbackIp: string;
  fallbackLocation: string;
  onCopy: (value: string, label: string) => void;
}

export function InfoCard({
  copyLabel,
  copyValue,
  title,
  info,
  fallbackIp,
  fallbackLocation,
  onCopy,
}: InfoCardProps) {
  return (
    <section className="panel ip-card">
      <div className="panel-heading inline">
        <h2>{title}</h2>
        <button className="icon-copy-button copy-button" onClick={() => onCopy(copyValue, copyLabel)} title={`复制${copyLabel}`}>
          <Copy size={18} />
        </button>
      </div>
      <strong>{info?.ip ?? fallbackIp}</strong>
      <p>{info?.location ?? fallbackLocation}</p>
      {info?.latencyMs ? (
        <span className="latency">
          <i />
          {info.latencyMs}ms
        </span>
      ) : null}
    </section>
  );
}
