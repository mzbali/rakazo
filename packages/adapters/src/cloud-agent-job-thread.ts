import type { MessageBlock } from "@rakazo/contracts";
import { escapePromptData } from "@rakazo/core";
import type { CloudAgent, Prisma } from "@rakazo/db";
import { appendEventInTransaction, createThreadMessageInTransaction } from "@rakazo/db";
import { helperPrompt } from "./background-helpers.js";

type Tx = Prisma.TransactionClient;
type HelperBlock = Extract<MessageBlock, { kind: "subagent" }>;

/** Longest launch brief kept for the helper; the rest of the record is small by nature. */
export const MAX_LAUNCH_BRIEF = 2_000;
const MAX_FIELD = 600;
const MAX_GOAL_JSON = 1_500;
const GOAL_TRANSITIONS_SHOWN = 3;

/**
 * Whether a cloud agent's wakes run in a hidden helper thread of the agent's own, fed its job
 * record, instead of in the bot's main chat. Off unless a deployment sets CLOUD_AGENT_JOB_THREADS=1.
 */
export function cloudAgentJobThreadsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLOUD_AGENT_JOB_THREADS === "1";
}

/** The agent's helper thread, made on its first wake. The caller holds the main chat's lock. */
export async function jobThreadFor(tx: Tx, agent: CloudAgent): Promise<string> {
  const current = await tx.cloudAgent.findUniqueOrThrow({
    where: { id: agent.id },
    select: { jobThreadId: true },
  });
  if (current.jobThreadId) return current.jobThreadId;
  // Like a background helper's thread: no chat list shows it, and it goes with the bot.
  const thread = await tx.thread.create({
    data: { spaceId: agent.spaceId, userId: agent.userId, helperBotId: agent.botId },
    select: { id: true },
  });
  await tx.cloudAgent.update({ where: { id: agent.id }, data: { jobThreadId: thread.id } });
  return thread.id;
}

/** The one card this wake leaves in the bot's main chat; the helper's result settles it. */
export async function postJobHelperCard(tx: Tx, agent: CloudAgent, executionId: string) {
  const card: HelperBlock = {
    kind: "subagent",
    agentId: executionId,
    name: agent.title,
    task: "Reviewing its progress",
    status: "running",
  };
  const message = await createThreadMessageInTransaction(tx, {
    threadId: agent.threadId,
    role: "bot",
    blocks: [card],
    botId: agent.botId,
    markUnread: false,
  });
  const event = await appendEventInTransaction(tx, {
    spaceId: agent.spaceId,
    threadId: agent.threadId,
    botId: agent.botId,
    type: "thread.message.created",
    payload: { messageId: message.id, role: "bot", blocks: [card] },
  });
  return { messageId: message.id, seq: event.seq };
}

function clip(value: string, limit = MAX_FIELD) {
  return escapePromptData(value.length > limit ? `${value.slice(0, limit)}…` : value);
}

function line(label: string, value: string | null | undefined) {
  return value ? `${label}: ${clip(value)}` : undefined;
}

/**
 * The job record a helper starts from, in place of the owner's chat: the agent's row, its scoped
 * goal when it has one, and why this wake happened. Provider and goal text is data, not orders.
 */
export async function jobHelperTaskPrompt(tx: Tx, agent: CloudAgent, wakes: string[]) {
  const goal = await tx.scopedGoal.findUnique({
    where: { agentId: agent.id },
    include: {
      transitions: { orderBy: { createdAt: "desc" }, take: GOAL_TRANSITIONS_SHOWN },
    },
  });
  const attention = Array.isArray(agent.attention)
    ? (agent.attention as Array<{ requestId?: unknown; kind?: unknown }>)
        .map((item) => `${String(item?.kind ?? "request")} ${String(item?.requestId ?? "")}`.trim())
        .join(", ")
    : "";
  const record = [
    `id: ${agent.id}`,
    `status: ${agent.status}`,
    line("title", agent.title),
    line("launch brief", agent.launchBrief),
    line("launch note", agent.launchNote),
    line("url", agent.url),
    line("branch", agent.branch),
    line("pull request", agent.prUrl),
    line("failure reason", agent.failureReason),
    line("open questions or approvals", attention),
    agent.verdict
      ? `last verdict: ${agent.verdict}${agent.verdictSummary ? ` (${clip(agent.verdictSummary)})` : ""}`
      : "last verdict: none yet",
    `piece of work: ${agent.generation + 1}`,
  ].filter(Boolean);
  const goalRecord = goal
    ? [
        `scoped goal ${goal.id}: ${goal.status}, gate ${clip(goal.gate)}`,
        `scope: ${clip(JSON.stringify(goal.scope), MAX_GOAL_JSON)}`,
        `evidence: ${clip(JSON.stringify(goal.evidence), MAX_GOAL_JSON)}`,
        goal.blocker ? `blocker: ${clip(JSON.stringify(goal.blocker), MAX_GOAL_JSON)}` : undefined,
        ...goal.transitions.map(
          (item) => `recent change: ${clip(JSON.stringify(item.detail), MAX_FIELD)}`,
        ),
      ].filter(Boolean)
    : [];
  return helperPrompt({
    name: clip(agent.title, 80).replaceAll('"', ""),
    instructions: [
      "You handle one cloud agent job and are given its record, not the owner's chat. Call cloud_agent_status for the latest state before you act.",
      "When finished work arrives, check it against the launch brief and record your verdict with cloud_agent_report. Answer an open question with cloud_agent_reply only when the brief settles it. Cancel only work that is clearly wrong.",
      "If the owner has to decide something (an approval, a question the brief does not settle, a result you cannot accept), leave it open and say what in your result.",
      "End with two or three plain sentences for the owner: what happened and what, if anything, they need to do.",
    ].join("\n"),
    task: [
      "<cloud_agent_job>",
      ...record,
      ...goalRecord,
      "</cloud_agent_job>",
      "",
      "Why you were woken:",
      ...wakes,
    ].join("\n"),
  });
}
