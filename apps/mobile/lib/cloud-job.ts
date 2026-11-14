import type { CloudAgentDetail } from "@rakazo/contracts";
import { useCallback, useState } from "react";
import { rpc } from "./api";
import { useForegroundPoll } from "./foreground-poll";

/** Detail is independent of the capped recent-jobs list. */
export function useCloudJob(agentId: string) {
  const [loaded, setLoaded] = useState<{
    agentId: string;
    detail?: CloudAgentDetail;
    error?: unknown;
  }>();
  const refresh = useCallback(async () => {
    try {
      const detail = await rpc("cloudAgents/detail", { agentId });
      setLoaded({ agentId, detail });
    } catch (error) {
      setLoaded({ agentId, error });
    }
  }, [agentId]);
  useForegroundPoll(refresh, 15_000, Boolean(agentId));
  return { ...(loaded?.agentId === agentId ? loaded : {}), refresh };
}
