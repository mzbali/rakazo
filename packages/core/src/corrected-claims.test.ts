import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addedClaimMessage,
  assertNoAddedClaims,
  assessCorrectedClaims,
  CORRECTED_CLAIMS_CALIBRATION,
  CorrectedClaimError,
  configureCorrectedClaimJudge,
} from "./corrected-claims.js";

afterEach(() => configureCorrectedClaimJudge(undefined));
describe("semantic corrected claims contract", () => {
  it("reports unconfigured as unqualified while core writes remain available", async () => {
    expect((await assessCorrectedClaims("", "text")).status).toBe("unqualified");
    await expect(addedClaimMessage("", "text")).resolves.toBeUndefined();
  });
  for (const example of CORRECTED_CLAIMS_CALIBRATION)
    it(`forwards full documents: ${example.after}`, async () => {
      const judge = vi
        .fn()
        .mockResolvedValue({ status: example.status, reason: "Reviewed fixture" });
      configureCorrectedClaimJudge(judge);
      const message = await addedClaimMessage(example.before, example.after);
      expect(judge).toHaveBeenCalledWith({ before: example.before, after: example.after });
      expect(Boolean(message)).toBe(example.status === "rejected");
    });
  it("never qualifies an error", async () => {
    configureCorrectedClaimJudge(async () => {
      throw new Error("offline");
    });
    expect((await assessCorrectedClaims("", "text")).status).toBe("unqualified");
    await expect(assertNoAddedClaims("", "text")).rejects.toBeInstanceOf(CorrectedClaimError);
  });
});

it("leaves a stalled judge unqualified at the deadline", async () => {
  vi.useFakeTimers();
  try {
    configureCorrectedClaimJudge(() => new Promise(() => {}));
    const assessment = assessCorrectedClaims("before", "after");
    await vi.advanceTimersByTimeAsync(30000);
    expect((await assessment).status).toBe("unqualified");
  } finally {
    vi.useRealTimers();
  }
});
