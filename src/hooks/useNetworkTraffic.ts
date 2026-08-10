import { useEffect, useState } from "react";
import { getNetworkTrafficSample } from "../lib/api";
import type { NetworkTrafficPoint, NetworkTrafficSample } from "../lib/types";

const TRAFFIC_HISTORY_LIMIT = 60;
const TRAFFIC_SAMPLE_INTERVAL_MS = 1000;

export function useNetworkTraffic(enabled: boolean) {
  const [points, setPoints] = useState<NetworkTrafficPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPoints([]);
      setError(null);
      return;
    }

    let disposed = false;
    let timer: number | undefined;
    let previous: NetworkTrafficSample | null = null;

    async function collectSample() {
      try {
        const sample = await getNetworkTrafficSample();
        if (disposed) return;

        const baseline = previous;
        previous = sample;
        setError(null);
        if (baseline) {
          const elapsedSeconds = Math.max((sample.timestampMs - baseline.timestampMs) / 1000, 0.2);
          const receivedDelta = Math.max(sample.receivedBytes - baseline.receivedBytes, 0);
          const sentDelta = Math.max(sample.sentBytes - baseline.sentBytes, 0);
          const point: NetworkTrafficPoint = {
            timestampMs: sample.timestampMs,
            downloadBytesPerSecond: receivedDelta / elapsedSeconds,
            uploadBytesPerSecond: sentDelta / elapsedSeconds,
          };
          setPoints((current) => [...current, point].slice(-TRAFFIC_HISTORY_LIMIT));
        }
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
  }, [enabled]);

  return { error, points };
}
