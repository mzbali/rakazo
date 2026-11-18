import { oc } from "@orpc/contract";
import * as z from "zod";
import {
  CloudAgentDetailSchema,
  CloudAgentJobSchema,
  CloudAgentOwnerActionSchema,
} from "./message-blocks.js";

/** The owner's cloud-agent jobs, listed and acted on from chat. */
export const cloudAgentsRpc = {
  cloudAgents: {
    /** The user's own cloud-agent jobs in the current space, newest first. */
    list: oc.output(z.array(CloudAgentJobSchema)),
    detail: oc.input(z.object({ agentId: z.string() })).output(CloudAgentDetailSchema),
    /** Answers the job's open question from its card; refused when it has closed. */
    answer: oc
      .input(
        z.object({
          agentId: z.string(),
          requestId: z.string(),
          answer: z.string().trim().min(1).max(500),
        }),
      )
      .output(CloudAgentOwnerActionSchema),
    /** Sends a running job an instruction; `key` makes a retry or double tap deliver once. */
    steer: oc
      .input(
        z.object({
          agentId: z.string(),
          text: z.string().trim().min(1).max(4000),
          key: z.string().min(8).max(100),
        }),
      )
      .output(CloudAgentOwnerActionSchema),
    /** Stops a running job. */
    stop: oc.input(z.object({ agentId: z.string() })).output(CloudAgentOwnerActionSchema),
    /** Takes a finished job off the jobs list; its chat card stays. Refused while it is unfinished. */
    clear: oc.input(z.object({ agentId: z.string() })).output(CloudAgentOwnerActionSchema),
  },
};
