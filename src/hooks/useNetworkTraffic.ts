import { useEffect, useRef, useState } from "react";
import { getNetworkTrafficSample } from "../lib/api";
import type { NetworkTrafficPoint, NetworkTrafficSample } from "../lib/types";

const TRAFFIC_HISTORY_LIMIT = 60;
const TRAFFIC_SAMPLE_INTERVAL_MS = 1000;

export function useNetworkTraffic(enabled: boolean, pollingActive = true) {
  const [points, setPoints] = useState<NetworkTrafficPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [totals, setTotals] = useState({ downloadBytes: 0, uploadBytes: 0 });
  const previousSampleRef = useRef<NetworkTrafficSample | null>(null);

  useEffect(() => {
    if (!enabled) {
      previousSampleRef.current = null;
      setPoints((current) => current.length > 0 ? [] : current);
      setError(null);
      setTotals((current) => current.downloadBytes > 0 || current.uploadBytes > 0
        ? { downloadBytes: 0, uploadBytes: 0 }
        : current);
    } else if (!pollingActive) {
      setPoints((current) => current.length > 0 ? [] : current);
      setError(null);
    }
  }, [enabled, pollingActive]);

  useEffect(() => {
    if (!enabled || !pollingActive) return;

    let disposed = false;
    let timer: number | undefined;
    let isFirstActiveSample = true;

    async function collectSample() {
      try {
        const sample = await getNetworkTrafficSample();
        if (disposed) return;

        const baseline = previousSampleRef.current;
        previousSampleRef.current = sample;
        setError(null);
        if (baseline) {
          const elapsedSeconds = Math.max((sample.timestampMs - baseline.timestampMs) / 1000, 0.2);
          const receivedDelta = Math.max(sample.receivedBytes - baseline.receivedBytes, 0);
          const sentDelta = Math.max(sample.sentBytes - baseline.sentBytes, 0);
          setTotals((current) => ({
            downloadBytes: current.downloadBytes + receivedDelta,
            uploadBytes: current.uploadBytes + sentDelta,
          }));
          if (!isFirstActiveSample) {
            const point: NetworkTrafficPoint = {
              timestampMs: sample.timestampMs,
              downloadBytesPerSecond: receivedDelta / elapsedSeconds,
              uploadBytesPerSecond: sentDelta / elapsedSeconds,
            };
            setPoints((current) => [...current, point].slice(-TRAFFIC_HISTORY_LIMIT));
          }
        }
        isFirstActiveSample = false;
      } catch (sampleError) {
        if (!disposed) {
          setError(sampleError instanceof Error ? sampleError.message : String(sampleError));
        }
      } finally {
        if (!disposed) {
          timer = window.setTimeout(collectSample, TRAFFIC_SAMPLE_INTERVAL_MS);
        }
      }
    }

    void collectSample();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, pollingActive]);

  return { error, points, totals };
}
