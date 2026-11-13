import { z } from "zod";

export const GoalGate = z.enum(["merge", "health", "deploy", "install"]);
const text = z.string().trim().min(1).max(4_000);
/** Observable contracts only. Natural-language acceptance stays outside these assertions. */
export const GoalRequirement = z
  .object({
    id: z.string().min(1).max(120),
    gate: GoalGate,
    revisionCheck: z.boolean().default(false),
    tool: z.string().min(1).max(200),
    request: z.record(z.string(), z.json()),
    assertions: z
      .array(
        z
          .object({
            path: z.array(z.string().max(200)).min(1).max(20),
            equals: z.union([z.string(), z.number(), z.boolean()]),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const ScopedGoalScope = z
  .object({
    agentId: text,
    repository: z.url(),
    revision: text,
    pullRequests: z.array(z.url()).max(20),
    intent: z.enum(["md", "mdi"]),
    deployment: text,
    installTarget: text.optional(),
    work: text,
    requirements: z.array(GoalRequirement).min(3).max(40),
  })
  .strict()
  .superRefine((scope, ctx) => {
    const guards = scope.requirements.filter((r) => r.revisionCheck);
    if (guards.length !== 1 || !guards[0]?.assertions.some((a) => a.equals === scope.revision))
      ctx.addIssue({
        code: "custom",
        message: "Require one current-revision observation matching the approved revision",
      });
    const gates = new Set(scope.requirements.map((r) => r.gate));
    for (const gate of ["merge", "health", "deploy"] as const) {
      if (!gates.has(gate)) ctx.addIssue({ code: "custom", message: `Missing ${gate} evidence` });
    }
    if (new Set(scope.requirements.map((r) => r.id)).size !== scope.requirements.length)
      ctx.addIssue({ code: "custom", message: "Evidence ids must be unique" });
    if (
      Boolean(scope.installTarget) !== gates.has("install") ||
      (scope.intent === "md" && gates.has("install"))
    )
      ctx.addIssue({
        code: "custom",
        message: "Install evidence requires mdi and an install target",
      });
  });
export type ScopedGoalScope = z.infer<typeof ScopedGoalScope>;
export const ScopedGoalReport = z
  .object({
    id: text,
    version: z.number().int().nonnegative(),
    observations: z
      .array(z.object({ requirementId: text, effectId: text }).strict())
      .max(40)
      .default([]),
    blocker: z
      .object({
        category: z.enum([
          "cooldown",
          "approval",
          "permission",
          "uncertain",
          "unavailable",
          "scope",
          "failure",
        ]),
        reason: text,
        retryAt: z.iso.datetime({ offset: true }).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const ScopedGoalControl = z
  .object({
    id: text,
    version: z.number().int().nonnegative(),
    action: z.enum(["pause", "resume", "cancel"]),
  })
  .strict();
