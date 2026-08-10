import { useEffect, useState } from "react";
import { SPEED_TEST_HISTORY_STORAGE_KEY } from "../app/constants";
import { readStoredSpeedTestHistory } from "../app/storage";
import type { SpeedTestHistoryEntry, SpeedTestResult } from "../lib/types";

const MAX_SPEED_TEST_HISTORY = 5;

export function useSpeedTestHistory() {
  const [speedTestHistory, setSpeedTestHistory] = useState<SpeedTestHistoryEntry[]>(readStoredSpeedTestHistory);

  useEffect(() => {
    window.localStorage.setItem(SPEED_TEST_HISTORY_STORAGE_KEY, JSON.stringify(speedTestHistory));
  }, [speedTestHistory]);

  function addSpeedTestHistory(result: SpeedTestResult) {
    const now = new Date();
    const entry: SpeedTestHistoryEntry = {
      ...result,
      id: `${now.getTime()}`,
      createdAt: now.toISOString(),
    };
    setSpeedTestHistory((current) => [entry, ...current].slice(0, MAX_SPEED_TEST_HISTORY));
  }

  return { addSpeedTestHistory, speedTestHistory };
}
