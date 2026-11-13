import { describe, expect, it, vi } from "vitest";
import { parseCorrectedClaimVerdict } from "./corrected-claims.js";

describe("structured claim judgments", () => {
  it.each([
    "",
    "not json",
    '{"status":"accepted"}',
    '{"status":"accepted","status":"rejected","reason":"x"}',
    '{"status":"accepted","reason":"x","extra":true}',
  ])("leaves malformed output unqualified: %s", (text) => {
    expect(parseCorrectedClaimVerdict(text).status).toBe("unqualified");
  });
  it.each(["accepted", "rejected", "unqualified"])("validates %s", (status) => {
    expect(parseCorrectedClaimVerdict(JSON.stringify({ status, reason: "Fixture" }))).toEqual({
      status,
      reason: "Fixture",
    });
  });
});

it("composes the actual runtime with full documents and no tools", async () => {
  vi.doMock("./deployment-model.js", () => ({
    resolveDeploymentModel: () => ({
      configured: true,
      provider: "fixture",
      model: "judge",
      key: "fake",
    }),
  }));
  const run = vi.fn(async function* (_request: unknown, _context: unknown) {
    yield { type: "done", text: JSON.stringify({ status: "rejected", reason: "Contradiction" }) };
  });
  vi.doMock("./pi-runtime.js", () => ({
    PiAgentRuntime: class {
      run = run;
    },
  }));
  const { deploymentCorrectedClaimJudge } = await import("./corrected-claims.js");
  // ResolveDeploymentModel was imported earlier by parser tests; reset so mocks apply.
  vi.resetModules();
  const module = await import("./corrected-claims.js");
  const input = { before: "Inherited text", after: "Full replacement" };
  expect((await module.deploymentCorrectedClaimJudge(input)).status).toBe("rejected");
  expect(run.mock.calls[0]?.[0]).toMatchObject({
    tools: [],
    prompt: expect.stringContaining("Full replacement"),
  });
  expect(deploymentCorrectedClaimJudge).toBeTypeOf("function");
  vi.doUnmock("./deployment-model.js");
  vi.doUnmock("./pi-runtime.js");
});

it("reads the opt-in when called, so an environment loaded after import still applies", async () => {
  const { assessCorrectedClaims, configureCorrectedClaimJudge } = await import("@rakazo/core");
  const { configureCorrectedClaimsFromEnv } = await import("./corrected-claims.js");
  configureCorrectedClaimsFromEnv({});
  expect((await assessCorrectedClaims("", "x")).reason).toBe("Fact checking is not configured.");
  configureCorrectedClaimsFromEnv({ RAKAZO_CORRECTED_CLAIMS_ENABLED: "true" });
  expect((await assessCorrectedClaims("", "x")).reason).not.toBe(
    "Fact checking is not configured.",
  );
  configureCorrectedClaimJudge(undefined);
});
