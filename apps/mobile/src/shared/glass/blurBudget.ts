import { useEffect } from "react";
import { supportLog } from "@/features/support/model/support-log";
import { glass } from "./tokens";

/**
 * Build 11: counts the BlurViews that are blurring right now (not merely mounted: a paused one is set
 * to `none`). Every live blur reports here, so the e2e gate reads one number (`blurs live max=N`) from
 * the support log instead of counting views, and a dev build warns the moment the budget is passed.
 */
let live = 0;
let max = 0;

/** Reports a blur while `running`. `tag` names it in the dev warning. */
export function useBlurBudget(running: boolean, tag: string): void {
  useEffect(() => {
    if (!running) return;
    live += 1;
    if (live > max) {
      max = live;
      supportLog.add(live > glass.budget ? "warn" : "info", "app", `blurs live max=${max} (${tag})`);
    }
    if (__DEV__ && live > glass.budget) console.warn(`[glass] ${live} live blurs (budget ${glass.budget}): ${tag}`);
    return () => {
      live -= 1;
    };
  }, [running, tag]);
}
