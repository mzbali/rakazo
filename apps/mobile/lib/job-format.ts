import { useNow as useTickingNow } from "@rakazo/chat-ui/hooks";
import type { CloudAgentPhase } from "@rakazo/core";

/** The clock for a running job's elapsed time: each second in the first minute, then each 15. */
export function useNow(live: boolean, startedAt: number | undefined): number {
  const withinFirstMinute = startedAt !== undefined && Date.now() - startedAt < 60_000;
  return useTickingNow(live ? (withinFirstMinute ? 1000 : 15_000) : null);
}

/** How many jobs are in each phase, in the order the group reads them. */
export function phaseCounts(phases: CloudAgentPhase[]) {
  const counts = new Map<CloudAgentPhase, number>();
  for (const phase of phases) counts.set(phase, (counts.get(phase) ?? 0) + 1);
  return counts;
}
