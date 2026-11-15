import type { MessageBlock } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { jobReplyTarget } from "./job-reply";

const job = (overrides: Record<string, unknown> = {}) =>
  ({
    kind: "cloud_agent",
    agentId: "job-1",
    title: "Ship it",
    status: "running",
    url: "t3code://threads/env/job-1",
    ...overrides,
  }) as MessageBlock;

describe("where a reply to a job card goes", () => {
  it("sends text to a running job as an instruction", () => {
    expect(jobReplyTarget({ blocks: [job()] })).toEqual({ mode: "steer", agentId: "job-1" });
  });

  it("answers the open question with the text", () => {
    const question = { requestId: "q1", options: [{ label: "main" }] };
    expect(jobReplyTarget({ blocks: [job({ needsInput: true, question })] })).toEqual({
      mode: "answer",
      agentId: "job-1",
      requestId: "q1",
    });
  });

  it("leaves a finished job, a waiting approval and a card of several jobs with the bot", () => {
    expect(jobReplyTarget({ blocks: [job({ status: "finished" })] })).toBeUndefined();
    expect(jobReplyTarget({ blocks: [job({ needsInput: true })] })).toBeUndefined();
    expect(jobReplyTarget({ blocks: [job(), job({ agentId: "job-2" })] })).toBeUndefined();
    expect(
      jobReplyTarget({ blocks: [{ kind: "text", text: "hi" } as MessageBlock] }),
    ).toBeUndefined();
    expect(jobReplyTarget(null)).toBeUndefined();
  });
});
