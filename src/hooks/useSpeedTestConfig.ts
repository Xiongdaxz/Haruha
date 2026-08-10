import { useEffect, useState } from "react";
import { SPEED_TEST_STORAGE_KEY } from "../app/constants";
import { readStoredSpeedTestConfig } from "../app/storage";
import type { SpeedTestConfig } from "../lib/types";

export function useSpeedTestConfig() {
  const [speedTestConfig, setSpeedTestConfig] = useState<SpeedTestConfig>(readStoredSpeedTestConfig);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SPEED_TEST_STORAGE_KEY, JSON.stringify(speedTestConfig));
    }
  }, [speedTestConfig]);

  function updateSpeedTestConfig<K extends keyof SpeedTestConfig>(key: K, value: SpeedTestConfig[K]) {
    setSpeedTestConfig((current) => ({ ...current, [key]: value }));
  }

  return { setSpeedTestConfig, speedTestConfig, updateSpeedTestConfig };
}
