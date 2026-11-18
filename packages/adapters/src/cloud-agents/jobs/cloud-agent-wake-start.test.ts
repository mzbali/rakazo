import type { CloudAgent } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { cloudAgentWakeIsCurrent, cloudAgentWakeNonces } from "./cloud-agent-wake-start.js";

const agent = {
  id: "agent-1",
  generation: 2,
  status: "running",
  verdict: null,
  attention: [{ requestId: "thread:question-1", kind: "question" }],
} satisfies Pick<CloudAgent, "id" | "generation" | "status" | "verdict" | "attention">;
const agents = (data: Partial<CloudAgent> = {}) => new Map([[agent.id, { ...agent, ...data }]]);

describe("cloud-agent wake start", () => {
  it("checks saved attention, including retry and colon-containing request identities", () => {
    expect(
      cloudAgentWakeIsCurrent("cloud-agent-attention:agent-1:thread:question-1", agents()),
    ).toBe(true);
    expect(
      cloudAgentWakeIsCurrent("cloud-agent-attention:agent-1:thread:question-1:r1", agents()),
    ).toBe(true);
    expect(
      cloudAgentWakeIsCurrent(
        "cloud-agent-attention:agent-1:thread:question-1",
        agents({ attention: [] }),
      ),
    ).toBe(false);
    expect(
      cloudAgentWakeIsCurrent("cloud-agent-attention:agent-1:thread:question-1", new Map()),
    ).toBe(false);
  });

  it("only delivers an unreported terminal generation", () => {
    const nonce = "cloud-agent-wake-run:agent-1:2:r1";
    expect(cloudAgentWakeIsCurrent(nonce, agents({ status: "finished" }))).toBe(true);
    expect(cloudAgentWakeIsCurrent(nonce, agents({ status: "failed" }))).toBe(true);
    expect(cloudAgentWakeIsCurrent(nonce, agents())).toBe(false);
    expect(cloudAgentWakeIsCurrent(nonce, agents({ status: "finished", generation: 3 }))).toBe(
      false,
    );
    expect(
      cloudAgentWakeIsCurrent(nonce, agents({ status: "finished", verdict: "accepted" })),
    ).toBe(false);
  });

  it("preserves the primary identity of a legacy run alongside coalesced identities", () => {
    expect(cloudAgentWakeNonces({ clientNonce: "first", cloudAgentWakeNonces: [] })).toEqual([
      "first",
    ]);
    expect(
      cloudAgentWakeNonces({ clientNonce: "first", cloudAgentWakeNonces: ["first", "second"] }),
    ).toEqual(["first", "second"]);
  });
});
