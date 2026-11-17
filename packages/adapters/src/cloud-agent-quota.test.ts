import { describe, expect, it } from "vitest";
import { QUOTA_POLL_MARGIN_MS, quotaPauseDecision, quotaPausePollAt } from "./cloud-agent-poll.js";

const reset = "2026-11-17T15:00:00.000Z";
const resetMs = Date.parse(reset);

describe("a usage-limit pause", () => {
  it("polls shortly after the reset, and not before now plus the margin", () => {
    expect(quotaPausePollAt(new Date(resetMs), resetMs - 60_000).toISOString()).toBe(
      new Date(resetMs + QUOTA_POLL_MARGIN_MS).toISOString(),
    );
    const now = resetMs + 30_000;
    expect(quotaPausePollAt(new Date(resetMs), now).toISOString()).toBe(
      new Date(now + QUOTA_POLL_MARGIN_MS).toISOString(),
    );
    expect(QUOTA_POLL_MARGIN_MS).toBe(2 * 60_000);
  });

  it("waits while the provider resumes itself, and sends once the reset has passed when it will not", () => {
    const waiting = { quotaResetsAt: reset, quotaAutoResume: true };
    expect(quotaPauseDecision(waiting, null, resetMs - 1_000)).toBe("wait");
    expect(quotaPauseDecision(waiting, null, resetMs + 1_000)).toBe("wait");
    const manual = { quotaResetsAt: reset, quotaAutoResume: false };
    expect(quotaPauseDecision(manual, null, resetMs - 1_000)).toBe("wait");
    expect(quotaPauseDecision(manual, null, resetMs + 1_000)).toBe("send");
    expect(quotaPauseDecision(manual, new Date(resetMs), resetMs + 1_000)).toBe("sent");
    expect(quotaPauseDecision({ quotaResetsAt: reset }, null, resetMs + 1_000)).toBe("wait");
  });

  it("leaves an open question and a missing limit to the ordinary poll", () => {
    const asking = {
      quotaResetsAt: reset,
      quotaAutoResume: false,
      attention: [{ requestId: "q1", kind: "question" as const }],
    };
    expect(quotaPauseDecision(asking, null, resetMs + 1_000)).toBe("none");
    expect(quotaPauseDecision(asking, new Date(resetMs), resetMs + 1_000)).toBe("none");
    expect(quotaPauseDecision({ quotaResetsAt: "not-a-time" }, null)).toBe("none");
    expect(quotaPauseDecision({}, null)).toBe("none");
  });
});
