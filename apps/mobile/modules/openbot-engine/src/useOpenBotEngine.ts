import { useCallback, useEffect, useRef, useState } from "react";
import * as Engine from "./engine";
import type { EngineStatus } from "./OpenBotEngine.types";

export interface UseOpenBotEngine {
  status: EngineStatus;
  /** True for installing/starting/stopping, when a spinner fits. */
  busy: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  update: () => Promise<void>;
  /** The last lines of the engine log; refreshed while `watchLogs` is on. */
  logs: string[];
  refreshLogs: () => Promise<void>;
}

/**
 * Live engine status. With `{ autoStart: true }` the hook starts the engine on mount (the root
 * layout uses installLocalEngine() instead, so the engine starts once per app open).
 */
export function useOpenBotEngine(options: { autoStart?: boolean; watchLogs?: boolean; logLines?: number } = {}): UseOpenBotEngine {
  const { autoStart = false, watchLogs = false, logLines = 200 } = options;
  const [status, setStatus] = useState<EngineStatus>(() => Engine.status());
  const [logs, setLogs] = useState<string[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = Engine.addStatusListener((next) => {
      if (mounted.current) setStatus(next);
    });
    // The status may have changed between the initial read and the subscription.
    setStatus(Engine.status());
    if (autoStart) void Engine.start().catch(() => undefined);
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [autoStart]);

  const refreshLogs = useCallback(async () => {
    const next = await Engine.getLogTail(logLines);
    if (mounted.current) setLogs(next);
  }, [logLines]);

  useEffect(() => {
    if (!watchLogs) return;
    void refreshLogs();
    const timer = setInterval(() => void refreshLogs(), 1500);
    return () => clearInterval(timer);
  }, [watchLogs, refreshLogs]);

  const busy = status.phase === "installing" || status.phase === "starting" || status.phase === "stopping";

  return {
    status,
    busy,
    start: Engine.start,
    stop: Engine.stop,
    restart: Engine.restart,
    update: Engine.update,
    logs,
    refreshLogs,
  };
}
