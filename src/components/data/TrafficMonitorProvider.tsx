import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getTrafficApplicationIcon } from "../../lib/api";
import type {
  NetworkTrafficPoint,
  TrafficMonitorCapability,
  TrafficMonitorSnapshot,
} from "../../lib/types";
import { useApplicationTraffic } from "../../hooks/useApplicationTraffic";
import { useNetworkTraffic } from "../../hooks/useNetworkTraffic";

interface TrafficMonitorContextValue {
  applicationCapability: TrafficMonitorCapability | null;
  applicationEnabled: boolean;
  applicationIconUrls: Record<string, string>;
  applicationSnapshot: TrafficMonitorSnapshot;
  applicationToggling: boolean;
  failedApplicationIcons: Set<string>;
  networkEnabled: boolean;
  networkDownloadBytes: number;
  networkError: string | null;
  networkPoints: NetworkTrafficPoint[];
  networkUploadBytes: number;
  onApplicationIconError: (applicationId: string) => void;
  toggleApplication: () => void;
  toggleNetwork: () => void;
}

const TrafficMonitorContext = createContext<TrafficMonitorContextValue | null>(null);

export function TrafficMonitorProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState === "visible");
  const [networkEnabled, setNetworkEnabled] = useState(false);
  const [applicationIconUrls, setApplicationIconUrls] = useState<Record<string, string>>({});
  const [failedApplicationIcons, setFailedApplicationIcons] = useState<Set<string>>(new Set());
  const [applicationIconRetryTick, setApplicationIconRetryTick] = useState(0);
  const applicationIconAttemptsRef = useRef<Record<string, number>>({});
  const applicationIconRunRef = useRef<number | null>(null);
  const samplingActive = active && documentVisible;
  const application = useApplicationTraffic(samplingActive);
  const network = useNetworkTraffic(networkEnabled, samplingActive);

  useEffect(() => {
    const syncVisibility = () => setDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  useEffect(() => {
    const startedAtMs = application.snapshot.startedAtMs ?? null;
    if (startedAtMs === null || startedAtMs === applicationIconRunRef.current) return;

    applicationIconRunRef.current = startedAtMs;
    applicationIconAttemptsRef.current = {};
    setFailedApplicationIcons(new Set());
    setApplicationIconRetryTick((current) => current + 1);
  }, [application.snapshot.startedAtMs]);

  useEffect(() => {
    if (!samplingActive) return;

    const missingApplications = application.snapshot.applications.filter(
      (item) =>
        item.id !== "system-unknown" &&
        !applicationIconUrls[item.id] &&
        (applicationIconAttemptsRef.current[item.id] ?? 0) < 3,
    );
    if (missingApplications.length === 0) return;

    let disposed = false;
    let retryTimer: number | undefined;
    missingApplications.forEach((item) => {
      applicationIconAttemptsRef.current[item.id] = (applicationIconAttemptsRef.current[item.id] ?? 0) + 1;
    });
    void Promise.all(
      missingApplications.map(async (item) => {
        try {
          const iconUrl = await getTrafficApplicationIcon(item.id);
          return [item.id, iconUrl] as const;
        } catch {
          return [item.id, ""] as const;
        }
      }),
    ).then((entries) => {
      if (disposed) return;
      const successfulEntries = entries.filter(([, iconUrl]) => Boolean(iconUrl));
      if (successfulEntries.length > 0) {
        setApplicationIconUrls((current) => ({ ...current, ...Object.fromEntries(successfulEntries) }));
      }
      const failedIds = entries.filter(([, iconUrl]) => !iconUrl).map(([applicationId]) => applicationId);
      setFailedApplicationIcons((current) => {
        const next = new Set(current);
        successfulEntries.forEach(([applicationId]) => next.delete(applicationId));
        failedIds.forEach((applicationId) => next.add(applicationId));
        return next;
      });
      if (failedIds.some((applicationId) => (applicationIconAttemptsRef.current[applicationId] ?? 0) < 3)) {
        retryTimer = window.setTimeout(() => setApplicationIconRetryTick((current) => current + 1), 600);
      }
    });

    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [application.snapshot.applications, applicationIconRetryTick, applicationIconUrls, samplingActive]);

  const onApplicationIconError = useCallback((applicationId: string) => {
    applicationIconAttemptsRef.current[applicationId] = 3;
    setApplicationIconUrls((current) => {
      if (!current[applicationId]) return current;
      const next = { ...current };
      delete next[applicationId];
      return next;
    });
    setFailedApplicationIcons((current) => new Set(current).add(applicationId));
  }, []);
  const toggleNetwork = useCallback(() => setNetworkEnabled((current) => !current), []);
  const toggleApplication = useCallback(() => void application.toggle(), [application.toggle]);

  const value = useMemo<TrafficMonitorContextValue>(
    () => ({
      applicationCapability: application.capability,
      applicationEnabled: application.enabled,
      applicationIconUrls,
      applicationSnapshot: application.snapshot,
      applicationToggling: application.isToggling,
      failedApplicationIcons,
      networkEnabled,
      networkDownloadBytes: network.totals.downloadBytes,
      networkError: network.error,
      networkPoints: network.points,
      networkUploadBytes: network.totals.uploadBytes,
      onApplicationIconError,
      toggleApplication,
      toggleNetwork,
    }),
    [
      application.capability,
      application.enabled,
      application.isToggling,
      application.snapshot,
      applicationIconUrls,
      failedApplicationIcons,
      network.error,
      network.points,
      network.totals.downloadBytes,
      network.totals.uploadBytes,
      networkEnabled,
      onApplicationIconError,
      toggleApplication,
      toggleNetwork,
    ],
  );

  return <TrafficMonitorContext.Provider value={value}>{children}</TrafficMonitorContext.Provider>;
}

export function useTrafficMonitor() {
  const value = useContext(TrafficMonitorContext);
  if (!value) throw new Error("useTrafficMonitor must be used inside TrafficMonitorProvider");
  return value;
}
