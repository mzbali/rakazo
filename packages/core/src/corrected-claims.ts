import claims from "./corrected-claims.json" with { type: "json" };

export interface CorrectedClaimRule {
  id: string;
  since: string;
  evidence: string;
  forbid: string[];
  examples: string[];
  nonExamples: string[];
}

export const CORRECTED_CLAIMS: readonly CorrectedClaimRule[] = claims;

export class CorrectedClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorrectedClaimError";
  }
}

/** Case, line breaks, markdown emphasis and curly apostrophes never hide a phrase. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/[*`_]/g, "").replace(/\s+/g, " ");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PHRASES = CORRECTED_CLAIMS.flatMap((rule) =>
  rule.forbid.map((phrase) => {
    const normalised = normalise(phrase).trim();
    return {
      rule,
      phrase,
      pattern: new RegExp(`(?<![a-z0-9])${escapeRegExp(normalised)}(?![a-z0-9])`, "g"),
    };
  }),
);

function countOf(pattern: RegExp, text: string): number {
  return [...text.matchAll(pattern)].length;
}

/** The first forbidden phrase `after` says more often than `before`, as a refusal message. */
export function addedClaimMessage(before: string, after: string): string | undefined {
  const was = normalise(before);
  const now = normalise(after);
  for (const { rule, phrase, pattern } of PHRASES) {
    // Counted per phrase, so inherited text never blocks an unrelated edit.
    if (countOf(pattern, now) > countOf(pattern, was))
      return `Nothing was saved: this says '${phrase}', which stopped being true on ${rule.since} (${rule.evidence}). Reword it.`;
  }
  return undefined;
}

/** Refuses a write that adds a claim a recorded correction has made false. */
export function assertNoAddedClaims(before: string, after: string): void {
  const message = addedClaimMessage(before, after);
  if (message) throw new CorrectedClaimError(message);
}
