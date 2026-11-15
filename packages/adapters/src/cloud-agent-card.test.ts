import type { CloudAgent } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { cloudAgentBlock } from "./cloud-agent-card.js";

const finished = {
  id: "agent-1",
  title: "Speed up the cart page",
  status: "finished",
  remoteId: "thread-1",
  createdAt: new Date("2026-11-15T03:00:00Z"),
  endedAt: new Date("2026-11-15T03:09:00Z"),
  queuedAt: null,
  attention: null,
  reviewingAt: null,
  verdict: "accepted",
} as unknown as CloudAgent;

describe("cloudAgentBlock", () => {
  it("carries the stored checks result to the card", () => {
    for (const checksState of ["passing", "failing", "running"] as const)
      expect(cloudAgentBlock({ ...finished, checksState }).checks).toBe(checksState);
  });

  it("shows a watched pull request only while the job runs, and a landed one after", () => {
    const running = { ...finished, status: "running", prWatching: true, prState: "open" };
    expect(cloudAgentBlock(running as unknown as CloudAgent)).toMatchObject({ watching: true });
    expect(cloudAgentBlock(running as unknown as CloudAgent).prState).toBeUndefined();
    const landed = { ...finished, prWatching: true, prState: "merged" } as unknown as CloudAgent;
    expect(cloudAgentBlock(landed)).toMatchObject({ prState: "merged" });
    expect(cloudAgentBlock(landed).watching).toBeUndefined();
  });

  it("shows the thread's work only while the job runs, and its pull requests after", () => {
    const threadWork = {
      work: [{ kind: "subagent", label: "Review" }],
      pullRequests: [
        { url: "https://github.com/acme/app/pull/1", number: 1, state: "open", watching: true },
      ],
    };
    const running = cloudAgentBlock({ ...finished, status: "running", threadWork } as never);
    expect(running.work).toHaveLength(1);
    expect(running.pullRequests).toHaveLength(1);
    const done = cloudAgentBlock({ ...finished, threadWork } as never);
    expect(done.work).toBeUndefined();
    expect(done.pullRequests).toHaveLength(1);
  });

  it("leaves an unknown checks result off the card", () => {
    expect(cloudAgentBlock({ ...finished, checksState: null }).checks).toBeUndefined();
  });
});
