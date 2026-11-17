import type {
  AdapterContext,
  CloudAgentProvider,
  CloudAgentRetryLater,
  CloudAgentSnapshot,
} from "@rakazo/adapter-kit";
import type { CloudAgent, Prisma } from "@rakazo/db";
import { QUOTA_CONTINUE_PROMPT } from "./cloud-agent-quota.prompt.js";
import type { CloudAgentDeps } from "./cloud-agent-service.js";
import { enqueueCloudAgent } from "./cloud-agent-service.js";

/** How long after a usage limit resets before the next poll. The provider may resume at the reset. */
export const QUOTA_POLL_MARGIN_MS = 2 * 60_000;

/** The next poll for a usage-limit pause: shortly after the reset, and never before now plus the margin. */
export function quotaPausePollAt(resetAt: Date, now = Date.now()): Date {
  return new Date(Math.max(now, resetAt.getTime()) + QUOTA_POLL_MARGIN_MS);
}

/**
 * The next poll of work still running: shortly after a usage-limit reset, or soon as usual. A
 * question still polls soon so an answer is seen.
 */
export function runningPollAt(quotaResetsAt: unknown, attention: unknown): Date {
  const open = Array.isArray(attention) && attention.length > 0;
  return quotaResetsAt instanceof Date && !open
    ? quotaPausePollAt(quotaResetsAt)
    : new Date(Date.now() + 5_000);
}

export type QuotaPauseDecision = "wait" | "send" | "sent" | "none";

/**
 * What a poll does with a usage-limit snapshot. `wait` holds until the reset. `send` continues
 * the same piece of work once, when the provider will not. `sent` means that continuation is
 * already on its way. `none` leaves the ordinary poll alone (no limit, or a question is open).
 */
export function quotaPauseDecision(
  snapshot: Pick<CloudAgentSnapshot, "quotaResetsAt" | "quotaAutoResume" | "attention">,
  continuedFor: Date | null | undefined,
  now = Date.now(),
): QuotaPauseDecision {
  const resetAt = snapshot.quotaResetsAt ? Date.parse(snapshot.quotaResetsAt) : Number.NaN;
  if (Number.isNaN(resetAt)) return "none";
  // A real question or approval still waits on the owner, so the pause does not hide it.
  if (snapshot.attention?.length) return "none";
  if (continuedFor?.getTime() === resetAt) return "sent";
  if (snapshot.quotaAutoResume !== false || resetAt > now) return "wait";
  return "send";
}

/**
 * A launch waiting for model quota. Nothing was sent, so the launch can start over or be
 * cancelled while it waits, and it is no outage: the note says why and until when.
 */
export async function quotaPoll(
  deps: CloudAgentDeps,
  agent: CloudAgent,
  fenced: Prisma.CloudAgentWhereInput,
  error: CloudAgentRetryLater,
) {
  const nextPollAt = new Date(Date.now() + (error.retryAfterMs ?? 15 * 60_000));
  // Only our lease guards this, so a cancel that moved the version still finds nothing dispatched.
  await deps.prisma.cloudAgent.updateMany({
    where: { id: agent.id, leaseToken: agent.leaseToken },
    data: { launchDispatched: false, launchNote: error.note ?? null },
  });
  const saved = await deps.prisma.cloudAgent.updateMany({
    where: fenced,
    data: {
      nextPollAt,
      errorCount: 0,
      retryingSince: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  if (saved.count) await enqueueCloudAgent(deps, agent.id, nextPollAt);
}

export function storedQuotaReset(snapshot: CloudAgentSnapshot): Date | null {
  if (snapshot.status !== "running" || !snapshot.quotaResetsAt) return null;
  const at = Date.parse(snapshot.quotaResetsAt);
  return Number.isNaN(at) ? null : new Date(at);
}

/**
 * When a usage limit has reset and the provider will not continue the thread, send the
 * continuation as the same piece of work. Returns nothing when another poll owns the row;
 * `fenced` is the poll's version and lease fence.
 */
export async function continueAfterQuota(
  deps: CloudAgentDeps,
  provider: CloudAgentProvider,
  agent: CloudAgent,
  fenced: Prisma.CloudAgentWhereInput,
  context: AdapterContext,
  snapshot: CloudAgentSnapshot,
): Promise<CloudAgentSnapshot | null> {
  const decision = quotaPauseDecision(snapshot, agent.quotaContinuedFor);
  if (decision === "none" || decision === "wait") return snapshot;
  // A continued thread is working again, not idling on its pull request.
  if (decision === "sent")
    return { ...snapshot, quotaResetsAt: undefined, quotaAutoResume: undefined, watchIdle: false };
  const resetAt = new Date(snapshot.quotaResetsAt!);
  // The key makes every send for this reset the same message, so a poll that crashed before
  // recording it sends again and the provider keeps one. The marker only records an accepted send.
  const sent = await provider.reply(
    agent.remoteId!,
    {
      prompt: QUOTA_CONTINUE_PROMPT,
      idempotencyKey: `quota-continue:${agent.id}:${resetAt.toISOString()}`,
    },
    context,
  );
  const marked = await deps.prisma.cloudAgent.updateMany({
    where: fenced,
    data: { quotaContinuedFor: resetAt },
  });
  if (!marked.count) return null;
  return {
    ...snapshot,
    status: "running",
    ...(sent.latestRunId ? { latestRunId: sent.latestRunId } : {}),
    quotaResetsAt: undefined,
    quotaAutoResume: undefined,
    watchIdle: false,
  };
}
