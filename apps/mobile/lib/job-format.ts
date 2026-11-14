import type { CloudAgentState } from "@rakazo/core";
import { useEffect, useState } from "react";

/** "45s", "12m", "1h 5m": how long a job has been going. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

/** The clock for a running job's elapsed time: each second in the first minute, then each 15. */
export function useNow(live: boolean, startedAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(
      () => setNow(Date.now()),
      startedAt !== undefined && Date.now() - startedAt < 60_000 ? 1000 : 15_000,
    );
    return () => clearInterval(timer);
  }, [live, startedAt]);
  return now;
}

/** How many jobs are in each state, in the order a group reads them: needs you first. */
export function stateCounts(states: CloudAgentState[]) {
  const counts = new Map<CloudAgentState, number>();
  for (const state of states) counts.set(state, (counts.get(state) ?? 0) + 1);
  return counts;
}
