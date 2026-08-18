import { useCallback, useEffect, useRef, useState } from "react";
import {
  APP_VERSION,
  UPDATE_AUTO_CHECK_STORAGE_KEY,
  UPDATE_LAST_CHECK_STORAGE_KEY,
  UPDATE_PENDING_VERSION_STORAGE_KEY,
} from "../app/constants";
import {
  cancelUpdateDownload,
  checkForUpdates,
  downloadUpdate,
  getLastUpdateResult,
  installUpdate,
} from "../lib/api";
import type { SoftwareUpdateState, UpdateApplyResult } from "../lib/types";

const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTO_CHECK_DELAY_MS = 5_000;

const initialState: SoftwareUpdateState = {
  phase: "idle",
  checkResult: null,
  progress: null,
  prepared: null,
  error: null,
};

function readAutoCheckEnabled() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(UPDATE_AUTO_CHECK_STORAGE_KEY) !== "false";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useSoftwareUpdater() {
  const [state, setState] = useState<SoftwareUpdateState>(initialState);
  const [autoCheckEnabled, setAutoCheckEnabledState] = useState(readAutoCheckEnabled);
  const [lastApplyResult, setLastApplyResult] = useState<UpdateApplyResult | null>(null);
  const downloadCanceledRef = useRef(false);

  const check = useCallback(async () => {
    setState((current) => ({
      ...current,
      phase: "checking",
      progress: null,
      prepared: null,
      error: null,
    }));
    try {
      const result = await checkForUpdates();
      window.localStorage.setItem(UPDATE_LAST_CHECK_STORAGE_KEY, String(result.checkedAtMs));
      setState({
        phase: result.update ? "available" : "latest",
        checkResult: result,
        progress: null,
        prepared: null,
        error: null,
      });
      return result;
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: "error",
        progress: null,
        error: errorMessage(error),
      }));
      return null;
    }
  }, []);

  const download = useCallback(async () => {
    downloadCanceledRef.current = false;
    setState((current) => ({ ...current, phase: "downloading", progress: null, error: null }));
    try {
      const prepared = await downloadUpdate((progress) => {
        if (downloadCanceledRef.current) return;
        setState((current) => ({ ...current, phase: "downloading", progress }));
      });
      if (downloadCanceledRef.current) return;
      setState((current) => ({
        ...current,
        phase: "ready",
        progress: current.progress
          ? { ...current.progress, downloadedBytes: prepared.sizeBytes, totalBytes: prepared.sizeBytes, percent: 100 }
          : current.progress,
        prepared,
        error: null,
      }));
    } catch (error) {
      if (downloadCanceledRef.current || errorMessage(error).includes("取消")) {
        setState((current) => ({ ...current, phase: "available", progress: null, error: null }));
        return;
      }
      setState((current) => ({ ...current, phase: "error", progress: null, error: errorMessage(error) }));
    }
  }, []);

  const cancelDownload = useCallback(async () => {
    downloadCanceledRef.current = true;
    setState((current) => ({ ...current, phase: "available", progress: null, error: null }));
    try {
      await cancelUpdateDownload();
    } catch (error) {
      console.warn("Failed to cancel update download", error);
    }
  }, []);

  const apply = useCallback(async () => {
    const version = state.prepared?.version ?? state.checkResult?.update?.version;
    if (!version) return;
    window.localStorage.setItem(UPDATE_PENDING_VERSION_STORAGE_KEY, version);
    setState((current) => ({ ...current, phase: "installing", error: null }));
    try {
      await installUpdate();
    } catch (error) {
      window.localStorage.removeItem(UPDATE_PENDING_VERSION_STORAGE_KEY);
      setState((current) => ({ ...current, phase: "error", error: errorMessage(error) }));
    }
  }, [state.checkResult?.update?.version, state.prepared?.version]);

  const setAutoCheckEnabled = useCallback((enabled: boolean) => {
    setAutoCheckEnabledState(enabled);
    window.localStorage.setItem(UPDATE_AUTO_CHECK_STORAGE_KEY, String(enabled));
  }, []);

  const clearLastApplyResult = useCallback(() => setLastApplyResult(null), []);

  useEffect(() => {
    if (!autoCheckEnabled) return undefined;
    const lastCheckedAt = Number(window.localStorage.getItem(UPDATE_LAST_CHECK_STORAGE_KEY) ?? 0);
    if (Number.isFinite(lastCheckedAt) && Date.now() - lastCheckedAt < AUTO_CHECK_INTERVAL_MS) return undefined;
    const timer = window.setTimeout(() => void check(), AUTO_CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [autoCheckEnabled, check]);

  useEffect(() => {
    let disposed = false;
    const timers: number[] = [];
    const readResult = async (lastAttempt: boolean) => {
      try {
        const result = await getLastUpdateResult();
        if (disposed) return;
        if (result) {
          window.localStorage.removeItem(UPDATE_PENDING_VERSION_STORAGE_KEY);
          setLastApplyResult(result);
          if (!result.success) {
            setState((current) => ({ ...current, phase: "error", error: result.message }));
          }
          return;
        }
        if (lastAttempt) {
          const pendingVersion = window.localStorage.getItem(UPDATE_PENDING_VERSION_STORAGE_KEY);
          if (pendingVersion === APP_VERSION) {
            window.localStorage.removeItem(UPDATE_PENDING_VERSION_STORAGE_KEY);
            setLastApplyResult({
              success: true,
              version: APP_VERSION,
              message: `已更新到 v${APP_VERSION}`,
              completedAtMs: Date.now(),
            });
          }
        }
      } catch (error) {
        if (!disposed) console.warn("Failed to read update result", error);
      }
    };

    timers.push(window.setTimeout(() => void readResult(false), 1_500));
    timers.push(window.setTimeout(() => void readResult(true), 4_500));
    return () => {
      disposed = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return {
    apply,
    autoCheckEnabled,
    cancelDownload,
    check,
    clearLastApplyResult,
    download,
    lastApplyResult,
    setAutoCheckEnabled,
    state,
  };
}
