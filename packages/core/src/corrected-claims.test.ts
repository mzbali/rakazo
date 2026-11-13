import { describe, expect, it } from "vitest";
import {
  addedClaimMessage,
  assertNoAddedClaims,
  CORRECTED_CLAIMS,
  CorrectedClaimError,
} from "./corrected-claims.js";

const hits = (text: string) => addedClaimMessage("", text) !== undefined;

describe("corrected claims", () => {
  for (const rule of CORRECTED_CLAIMS) {
    describe(rule.id, () => {
      it("refuses every example", () => {
        for (const example of rule.examples) expect(hits(example), example).toBe(true);
      });

      it("allows every non-example", () => {
        for (const nonExample of rule.nonExamples) expect(hits(nonExample), nonExample).toBe(false);
      });

      it("has evidence and a date", () => {
        expect(rule.evidence).not.toBe("");
        expect(rule.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });
  }

  it("sees a phrase wrapped across lines and dressed in markdown", () => {
    expect(hits("A continuation does\n  not wake on\ncompletion.")).toBe(true);
    expect(hits("`cloud_agent_launch` **does not forward** _those_ `fields`.")).toBe(true);
  });

  it("sees curly apostrophes and capitals", () => {
    expect(hits("CONTINUATIONS DON’T WAKE THIS BOT")).toBe(true);
  });

  it("matches on word boundaries", () => {
    expect(hits("A continuation does not wake on completionist.")).toBe(false);
    expect(hits("A discontinuation does not wake on completion.")).toBe(false);
  });

  it("says what stopped being true and when", () => {
    expect(addedClaimMessage("", "That tool cannot set a per-task provider or model.")).toBe(
      "Nothing was saved: this says 'cannot set a per-task provider or model', which stopped being true on 2026-11-12 (rakazo@1b2618fea PR #17, cloud_agent_launch forwards modelSelection incl. effort, projectId, workspaceStrategy, runtimeMode, interactionMode). Reword it.",
    );
  });

  it("throws CorrectedClaimError with that message", () => {
    expect(() => assertNoAddedClaims("", "A continuation does not wake on completion.")).toThrow(
      CorrectedClaimError,
    );
    expect(() => assertNoAddedClaims("fine", "fine")).not.toThrow();
  });

  it("lets inherited text accept an unrelated edit", () => {
    const inherited = "A continuation does not wake on completion.";
    expect(() => assertNoAddedClaims(inherited, `${inherited}\nBe brief.`)).not.toThrow();
    expect(() => assertNoAddedClaims(inherited, "Be brief.")).not.toThrow();
  });

  it("refuses a second copy of an inherited phrase", () => {
    const inherited = "A continuation does not wake on completion.";
    expect(() => assertNoAddedClaims(inherited, `${inherited}\n${inherited}`)).toThrow(
      CorrectedClaimError,
    );
  });

  it("counts each phrase separately, so swapping one stale phrase for another is refused", () => {
    expect(() =>
      assertNoAddedClaims(
        "A continuation does not wake on completion.",
        "That tool cannot set a per-task provider or model.",
      ),
    ).toThrow(CorrectedClaimError);
    expect(() =>
      assertNoAddedClaims(
        "A continuation does not wake on completion.",
        "A continuation does not wake this bot.",
      ),
    ).toThrow(CorrectedClaimError);
  });
});
