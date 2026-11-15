import type { CloudAgentTone } from "@rakazo/core";

type Checks = "passing" | "failing" | "running";

/** The pull request chip's colour for a check result; nothing when the result is unknown, so no chip. */
export function checksChip(
  checks: Checks | undefined,
): { checks: Checks; tone: CloudAgentTone } | undefined {
  switch (checks) {
    case "passing":
      return { checks, tone: "success" };
    case "failing":
      return { checks, tone: "danger" };
    case "running":
      return { checks, tone: "active" };
    default:
      return undefined;
  }
}
