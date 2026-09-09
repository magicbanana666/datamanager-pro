import { useCallback, useEffect, useRef, useState } from "react";

export type SimStatus = "idle" | "running" | "paused" | "completed" | "stopped";

export interface UseSimulatedProgressResult {
  status: SimStatus;
  /** 0-100 */
  progress: number;
  elapsedSeconds: number;
  totalSeconds: number;
  start: (durationSeconds: number) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  reset: () => void;
}

/**
 * Frontend-only fake progress simulator used by every "Start Scan" /
 * "Start Transfer" / "Start Sync" button in Phase 1. Ticks `progress` from
 * 0 -> 100 over `durationSeconds` using a plain interval timer - no real
 * disk, network or filesystem work happens anywhere near this hook.
 */
export function useSimulatedProgress(onComplete?: () => void): UseSimulatedProgressResult {
  const [status, setStatus] = useState<SimStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(30);
  const totalSecondsRef = useRef(30);
  const startTimeRef = useRef(0);
  const pausedAccumRef = useRef(0);
  const pauseStartRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const now = performance.now();
    const elapsedMs = now - startTimeRef.current - pausedAccumRef.current;
    const pct = Math.min(100, (elapsedMs / (totalSecondsRef.current * 1000)) * 100);
    setProgress(pct);
    setElapsedSeconds(elapsedMs / 1000);
    if (pct >= 100) {
      clearTimer();
      setStatus("completed");
      onCompleteRef.current?.();
    }
  }, [clearTimer]);

  const start = useCallback(
    (durationSeconds: number) => {
      clearTimer();
      totalSecondsRef.current = durationSeconds;
      setTotalSeconds(durationSeconds);
      startTimeRef.current = performance.now();
      pausedAccumRef.current = 0;
      pauseStartRef.current = null;
      setProgress(0);
      setElapsedSeconds(0);
      setStatus("running");
      intervalRef.current = window.setInterval(tick, 200);
    },
    [clearTimer, tick],
  );

  const pause = useCallback(() => {
    setStatus((current) => {
      if (current !== "running") return current;
      pauseStartRef.current = performance.now();
      clearTimer();
      return "paused";
    });
  }, [clearTimer]);

  const resume = useCallback(() => {
    setStatus((current) => {
      if (current !== "paused") return current;
      if (pauseStartRef.current != null) {
        pausedAccumRef.current += performance.now() - pauseStartRef.current;
        pauseStartRef.current = null;
      }
      intervalRef.current = window.setInterval(tick, 200);
      return "running";
    });
  }, [tick]);

  const stop = useCallback(() => {
    clearTimer();
    setStatus("stopped");
  }, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    setStatus("idle");
    setProgress(0);
    setElapsedSeconds(0);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return {
    status,
    progress,
    elapsedSeconds,
    totalSeconds,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}
