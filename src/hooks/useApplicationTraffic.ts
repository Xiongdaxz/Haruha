import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTrafficMonitorCapability,
  getTrafficMonitorSnapshot,
  startTrafficMonitor,
  stopTrafficMonitor,
} from "../lib/api";
import type { TrafficMonitorCapability, TrafficMonitorSnapshot } from "../lib/types";

const APPLICATION_SNAPSHOT_INTERVAL_MS = 5_000;

const idleSnapshot: TrafficMonitorSnapshot = {
  status: "idle",
  updatedAtMs: 0,
  applications: [],
};

export function useApplicationTraffic(pollingActive = true) {
  const [enabled, setEnabled] = useState(false);
  const [isToggling, setToggling] = useState(false);
  const [capability, setCapability] = useState<TrafficMonitorCapability | null>(null);
  const [snapshot, setSnapshot] = useState<TrafficMonitorSnapshot>(idleSnapshot);
  const operationIdRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    const operationId = operationIdRef.current;
    void (async () => {
      try {
        const nextCapability = await getTrafficMonitorCapability();
        if (disposed || operationIdRef.current !== operationId) return;
        setCapability(nextCapability);
        if (!nextCapability.supported) return;

        const nextSnapshot = await getTrafficMonitorSnapshot();
        if (disposed || operationIdRef.current !== operationId) return;
        setSnapshot(nextSnapshot);
        if (nextSnapshot.status === "starting" || nextSnapshot.status === "running") {
          setEnabled(true);
        }
      } catch (error) {
        if (disposed || operationIdRef.current !== operationId) return;
        setCapability({
          supported: false,
          requiresElevation: false,
          reason: `无法查询应用流量监控能力：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !capability?.supported || !pollingActive) return;
    let disposed = false;
    let timer: number | undefined;
    const collectSnapshot = async () => {
      try {
        const nextSnapshot = await getTrafficMonitorSnapshot();
        if (disposed) return;
        setSnapshot(nextSnapshot);
      } catch (error) {
        if (disposed) return;
        setSnapshot((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        if (!disposed) {
          timer = window.setTimeout(() => void collectSnapshot(), APPLICATION_SNAPSHOT_INTERVAL_MS);
        }
      }
    };
    void collectSnapshot();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [capability?.supported, enabled, pollingActive]);

  const toggle = useCallback(async () => {
    if (isToggling) return;
    const operationId = ++operationIdRef.current;
    setToggling(true);
    if (enabled) {
      setEnabled(false);
      try {
        const nextSnapshot = capability?.supported ? await stopTrafficMonitor() : idleSnapshot;
        if (operationIdRef.current === operationId) setSnapshot(nextSnapshot);
      } catch (error) {
        if (operationIdRef.current === operationId) {
          setSnapshot({
            status: "error",
            updatedAtMs: Date.now(),
            applications: [],
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (operationIdRef.current === operationId) setToggling(false);
      }
      return;
    }

    setEnabled(true);
    let resolvedCapability = capability;
    if (!resolvedCapability) {
      try {
        resolvedCapability = await getTrafficMonitorCapability();
        if (operationIdRef.current !== operationId) return;
        setCapability(resolvedCapability);
      } catch (error) {
        if (operationIdRef.current !== operationId) return;
        setEnabled(false);
        setCapability({
          supported: false,
          requiresElevation: false,
          reason: `无法查询应用流量监控能力：${error instanceof Error ? error.message : String(error)}`,
        });
        setSnapshot(idleSnapshot);
        setToggling(false);
        return;
      }
    }
    if (!resolvedCapability.supported) {
      setEnabled(false);
      setSnapshot(idleSnapshot);
      setToggling(false);
      return;
    }

    setSnapshot({ status: "starting", updatedAtMs: Date.now(), applications: [] });
    try {
      const nextSnapshot = await startTrafficMonitor();
      if (operationIdRef.current !== operationId) return;
      setSnapshot(nextSnapshot);
    } catch (error) {
      if (operationIdRef.current !== operationId) return;
      setEnabled(false);
      setSnapshot({
        status: "error",
        updatedAtMs: Date.now(),
        applications: [],
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (operationIdRef.current === operationId) setToggling(false);
    }
  }, [capability, enabled, isToggling]);

  return { capability, enabled, isToggling, snapshot, toggle };
}
