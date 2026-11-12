export interface CorrectedClaimRule {
  id: string;
  since: string;
  evidence: string;
  forbid: string[];
  examples: string[];
  nonExamples: string[];
}

/**
 * Claims a shipped fix made false. Add one with the fix that makes a claim false; remove it once
 * nothing could still say it.
 */
export const CORRECTED_CLAIMS: readonly CorrectedClaimRule[] = [
  {
    id: "cloud-agent-launch-forwards-fields",
    since: "2026-11-12",
    evidence:
      "rakazo@1b2618fea PR #17, cloud_agent_launch forwards modelSelection incl. effort, projectId, workspaceStrategy, runtimeMode, interactionMode",
    forbid: [
      "it does not forward those fields",
      "cloud_agent_launch does not forward those fields",
      "until that passthrough is deployed",
      "cannot set a per-task provider or model",
    ],
    examples: [
      "`cloud_agent_launch` is the wake path, but as of 12 Nov 2026 it does not forward those fields.",
      "That tool cannot set a per-task provider or model.",
      "Use it only until that passthrough is deployed.",
    ],
    nonExamples: [
      "`cloud_agent_launch` forwards the model, project and workspace fields.",
      "A task can set a per-task provider or model through `cloud_agent_launch`.",
      "The old build did not forward the effort field.",
      "The webhook relay does not forward those fields.",
    ],
  },
  {
    id: "continuation-wakes",
    since: "2026-11-12",
    evidence:
      "rakazo@69c139e38 PR #18, a bot's own thread continuation is tracked and wakes it on completion",
    forbid: [
      "a continuation does not wake on completion",
      "a continuation doesn't wake on completion",
      "continuations do not wake on completion",
      "continuations don't wake on completion",
      "a continuation does not wake this bot",
      "a continuation doesn't wake this bot",
      "continuations do not wake this bot",
      "continuations don't wake this bot",
    ],
    examples: [
      "A continuation does not wake on completion.",
      "A **continuation** doesn't wake on\ncompletion.",
      "Your thread continuations don’t wake this bot.",
      "Continuations do not wake this bot when the thread finishes.",
    ],
    nonExamples: [
      "A `/compact` continuation doesn't wake the bot.",
      "Retried continuations don't wake twice.",
      "A continuation wakes on completion.",
      "A continuation does not wake on completionist.",
      "A `/compact` continuation doesn't wake this bot.",
    ],
  },
];

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
