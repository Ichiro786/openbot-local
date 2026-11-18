import { supportLog } from "@/features/support/model/support-log";

/**
 * Timing marks for the open of a chat, written to the support log (Settings > Support). They say where
 * the time goes between the tap on a row and the chat on screen, and which JS stalls happen. They draw
 * nothing and change no behavior.
 */
const STALL_MS = 50;
const TICK_MS = 16;
const RUN_MS = 4_000;

let start = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let stopAt = 0;
let lastTick = 0;

function stopMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** The JS thread runs a tick each 16 ms. A late tick is a stall of the JS thread. */
function runMonitor() {
  stopAt = Date.now() + RUN_MS;
  if (timer) return;
  lastTick = Date.now();
  timer = setInterval(() => {
    const now = Date.now();
    const late = now - lastTick - TICK_MS;
    lastTick = now;
    if (late >= STALL_MS) supportLog.add("info", "app", `open-trace +${now - start}ms JS stall ${late}ms`);
    if (now > stopAt) stopMonitor();
  }, TICK_MS);
}

/** The tap on a row, or the back from a chat: marks run from here for four seconds. */
export function openTraceStart(label: string) {
  start = Date.now();
  supportLog.add("info", "app", `open-trace +0ms ${label}`);
  runMonitor();
}

export function openTraceMark(label: string) {
  if (!start || Date.now() - start > RUN_MS) return;
  supportLog.add("info", "app", `open-trace +${Date.now() - start}ms ${label}`);
}
