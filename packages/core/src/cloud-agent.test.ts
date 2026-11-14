import { describe, expect, it } from "vitest";
import {
  cloudAgentBlockFromPayload,
  cloudAgentHttpsUrl,
  cloudAgentState,
  cloudAgentTone,
} from "./cloud-agent.js";
import { projectMessages } from "./events.js";

describe("shared cloud agent projection", () => {
  it("updates an existing card when replaying durable events", () => {
    const base = { threadId: "thread", createdAt: "2026-01-01T00:00:00Z", botId: "bot" };
    const block = cloudAgentBlockFromPayload({
      agentId: "agent",
      title: "Task",
      status: "running",
      url: "https://example.test/agent",
    });
    const messages = projectMessages([
      {
        ...base,
        id: "first",
        seq: 1,
        type: "thread.message.created",
        payload: { messageId: "card", role: "bot", blocks: [block] },
      },
      {
        ...base,
        id: "second",
        seq: 2,
        type: "thread.cloud_agent",
        payload: {
          ...block,
          messageId: "card",
          status: "finished",
          prUrl: "https://example.test/pr",
        },
      },
    ]);
    expect(messages[0]?.blocks[0]).toMatchObject({
      status: "finished",
      prUrl: "https://example.test/pr",
    });
  });
  it("normalizes invalid statuses and excludes unsafe links on every surface", () => {
    expect(
      cloudAgentBlockFromPayload({
        status: "invalid",
        url: "javascript:alert(1)",
        prUrl: "http://example.test/pr",
      }),
    ).toMatchObject({ status: "running", url: "" });
    for (const url of [
      "javascript:alert(1)",
      "file:///tmp/fake",
      "https://user:password@example.test",
      "invalid",
    ])
      expect(cloudAgentHttpsUrl(url)).toBeUndefined();
  });
});

describe("cloud agent state", () => {
  it("puts what waits on the owner first and settled statuses through unchanged", () => {
    const running = { status: "running" as const };
    expect(cloudAgentState({ ...running, needsInput: true, unreachableSince: "x" })).toBe(
      "needsInput",
    );
    expect(cloudAgentState({ ...running, unreachableSince: "x", queued: true })).toBe(
      "unreachable",
    );
    expect(cloudAgentState({ ...running, queued: true })).toBe("queued");
    expect(cloudAgentState(running)).toBe("running");
    expect(cloudAgentState({ status: "expired", needsInput: true })).toBe("expired");
  });
  it("colours attention, success and failure apart from everything else", () => {
    expect(cloudAgentTone("needsInput")).toBe("attention");
    expect(cloudAgentTone("finished")).toBe("success");
    expect(cloudAgentTone("failed")).toBe("danger");
    expect(cloudAgentTone("queued")).toBe("muted");
  });
  it("keeps a bounded pick note and the start time, and drops bad ones", () => {
    const block = cloudAgentBlockFromPayload({
      agentId: "a",
      note: ` ${"n".repeat(500)} `,
      startedAt: new Date("2026-01-02T03:04:05Z"),
    });
    expect(block.note).toHaveLength(400);
    expect(block.startedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(
      cloudAgentBlockFromPayload({ agentId: "a", note: "  ", startedAt: "nope" }),
    ).not.toHaveProperty("note");
  });
});
