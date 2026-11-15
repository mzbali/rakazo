import type { MessageBlock } from "@rakazo/contracts";

export function cloudAgentHttpsUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Provider links are displayed only after each client applies its app-link allowlist. */
export function cloudAgentUrl(value: string | null | undefined): string | undefined {
  if (cloudAgentHttpsUrl(value)) return value!;
  if (!value || /[?#]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) &&
      url.protocol !== "javascript:" &&
      url.protocol !== "data:" &&
      url.protocol !== "file:" &&
      url.protocol !== "http:" &&
      url.protocol !== "https:" &&
      url.hostname &&
      !url.username &&
      !url.password &&
      !url.port
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

type CloudAgentBlock = Extract<MessageBlock, { kind: "cloud_agent" }>;

/**
 * What a cloud-agent job is doing, in the order an owner cares: `needsInput` first, because it
 * is the one state that waits on them. `tone` is the colour family every client uses.
 */
export type CloudAgentState =
  | "needsInput"
  | "unreachable"
  | "queued"
  | "running"
  | "finished"
  | "failed"
  | "cancelled"
  | "expired";

export type CloudAgentTone = "attention" | "active" | "success" | "danger" | "muted";

export function cloudAgentState(
  job: Pick<
    CloudAgentBlock,
    "status" | "queued" | "needsInput" | "unreachableSince" | "ownerQuestion" | "launchFailed"
  >,
): CloudAgentState {
  // A launch that never started has nothing to answer, whatever the bot asked the owner after it.
  if (job.launchFailed) return "failed";
  if (job.ownerQuestion) return "needsInput";
  if (job.status !== "running") return job.status;
  if (job.needsInput) return "needsInput";
  if (job.unreachableSince) return "unreachable";
  return job.queued ? "queued" : "running";
}

/**
 * The plain word a job shows on every surface: the card, the jobs row, the sheet and web. Raw
 * provider statuses never reach the owner; each phase has one translated label.
 */
export type CloudAgentPhase =
  | "starting"
  | "working"
  | "checking"
  | "done"
  | "needsYou"
  | "couldntStart"
  | "stopped"
  | "expired";

type PhaseJob = Pick<
  CloudAgentBlock,
  "status" | "queued" | "needsInput" | "unreachableSince" | "ownerQuestion" | "launchFailed"
> &
  Partial<Pick<CloudAgentBlock, "review" | "url">>;

export function cloudAgentPhase(job: PhaseJob): CloudAgentPhase {
  const state = cloudAgentState(job);
  switch (state) {
    case "needsInput":
      return "needsYou";
    case "queued":
      return "starting";
    case "running":
    case "unreachable":
      return job.review === "checking" ? "checking" : job.url === "" ? "starting" : "working";
    case "finished":
      return job.review === "checking" ? "checking" : "done";
    case "expired":
      return "expired";
    case "cancelled":
      return "stopped";
    default:
      return job.launchFailed ? "couldntStart" : "stopped";
  }
}

/** The colour family of a job: a stopped job that failed is red, one the owner stopped is quiet. */
export function cloudAgentJobTone(job: PhaseJob): CloudAgentTone {
  const phase = cloudAgentPhase(job);
  switch (phase) {
    case "needsYou":
      return "attention";
    case "starting":
    case "working":
    case "checking":
      return "active";
    case "done":
      return "success";
    case "couldntStart":
      return "danger";
    case "stopped":
      return job.status === "failed" ? "danger" : "muted";
    default:
      return "muted";
  }
}

/** "45s", "12m", "1h 5m": how long a job has been going. */
export function formatCloudAgentElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

/**
 * How long the job has run: ticking against `nowMs` while it works, fixed at the end once it has
 * stopped, and nothing for a finished job whose end was never recorded.
 */
export function cloudAgentElapsed(
  job: Pick<CloudAgentBlock, "status" | "startedAt" | "endedAt">,
  nowMs: number,
): string | undefined {
  const started = job.startedAt ? Date.parse(job.startedAt) : Number.NaN;
  if (Number.isNaN(started)) return undefined;
  if (job.status === "running") return formatCloudAgentElapsed(nowMs - started);
  const ended = job.endedAt ? Date.parse(job.endedAt) : Number.NaN;
  return Number.isNaN(ended) ? undefined : formatCloudAgentElapsed(ended - started);
}

/** Whether the elapsed clock should tick: the work has not ended. */
export function cloudAgentTicking(job: Pick<CloudAgentBlock, "status" | "startedAt">): boolean {
  return job.status === "running" && Boolean(job.startedAt);
}

/** The pull request's number from its link ("https://host/org/app/pull/12" gives 12). */
export function cloudAgentPullRequestNumber(prUrl: string | undefined): number | undefined {
  const link = cloudAgentHttpsUrl(prUrl);
  const match = link ? new URL(link).pathname.match(/\/pull\/(\d+)\/?$/) : null;
  return match ? Number(match[1]) : undefined;
}

/** The shelf a job sits on in the jobs list: what waits on the owner, what runs, what is over. */
export type CloudAgentShelf = "needsYou" | "working" | "done";

export function cloudAgentShelf(state: CloudAgentState): CloudAgentShelf {
  switch (state) {
    case "needsInput":
      return "needsYou";
    case "finished":
    case "failed":
    case "cancelled":
    case "expired":
      return "done";
    default:
      return "working";
  }
}

/**
 * The repository's name from its link ("https://host/org/app.git" gives "app"), kept on the job
 * when it launches because the launch request is cleared once sent.
 */
export function cloudAgentProjectName(repository: string | null | undefined): string | undefined {
  const link = cloudAgentHttpsUrl(repository);
  if (!link) return undefined;
  const last = new URL(link).pathname.split("/").filter(Boolean).pop();
  return last?.replace(/\.git$/, "") || undefined;
}

/**
 * A model and the kind of work from the pick note ("Picked claude-sonnet-5-5 on main (simple)."):
 * the model's last word, capitalised ("Sonnet"), and the first thing in the brackets ("simple").
 */
export function cloudAgentModelLabel(note: string | undefined): string | undefined {
  const match = note?.match(/^Picked (\S+) on [^(]*\(([^;)]*)/);
  if (!match) return undefined;
  const word = match[1]!
    .split(/[-_.\s]/)
    .filter((part) => /^[A-Za-z]+$/.test(part))
    .pop();
  if (!word) return undefined;
  const model = word[0]!.toUpperCase() + word.slice(1);
  const kind = match[2]!.trim();
  return kind ? `${model} · ${kind}` : model;
}

const CLOUD_AGENT_NOTE_MAX = 400;

export function cloudAgentBlockFromPayload(payload: Record<string, unknown>): CloudAgentBlock {
  const status = payload.status;
  const note = typeof payload.note === "string" ? payload.note.trim() : "";
  const started = payload.startedAt;
  const startedAt =
    started instanceof Date
      ? started.toISOString()
      : typeof started === "string" && !Number.isNaN(Date.parse(started))
        ? started
        : undefined;
  const progress = clipped(payload.progress, CLOUD_AGENT_PROGRESS_MAX);
  const resultExcerpt = clipped(payload.resultExcerpt, CLOUD_AGENT_EXCERPT_MAX);
  const ended = payload.endedAt;
  const endedAt =
    ended instanceof Date
      ? ended.toISOString()
      : typeof ended === "string" && !Number.isNaN(Date.parse(ended))
        ? ended
        : undefined;
  const since = payload.unreachableSince;
  const unreachableSince =
    since instanceof Date
      ? since.toISOString()
      : typeof since === "string" && !Number.isNaN(Date.parse(since))
        ? since
        : undefined;
  return {
    kind: "cloud_agent",
    agentId: String(payload.agentId ?? ""),
    title: String(payload.title ?? "Cloud agent"),
    status:
      status === "finished" || status === "failed" || status === "cancelled" || status === "expired"
        ? status
        : "running",
    url: cloudAgentUrl(String(payload.url ?? "")) ?? "",
    ...(payload.branch ? { branch: String(payload.branch) } : {}),
    ...(cloudAgentHttpsUrl(String(payload.prUrl ?? "")) ? { prUrl: String(payload.prUrl) } : {}),
    ...(payload.latestRunId ? { latestRunId: String(payload.latestRunId) } : {}),
    ...(payload.queued === true ? { queued: true } : {}),
    ...(payload.needsInput === true ? { needsInput: true } : {}),
    ...(unreachableSince ? { unreachableSince } : {}),
    ...(note ? { note: note.slice(0, CLOUD_AGENT_NOTE_MAX) } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(progress ? { progress } : {}),
    ...(resultExcerpt ? { resultExcerpt } : {}),
    ...(typeof payload.ownerQuestion === "string" && payload.ownerQuestion.trim()
      ? { ownerQuestion: payload.ownerQuestion.trim().slice(0, 500) }
      : {}),
    ...(typeof payload.projectName === "string" && payload.projectName
      ? { projectName: payload.projectName.slice(0, 100) }
      : {}),
    ...(payload.launchFailed === true ? { launchFailed: true } : {}),
    ...(typeof payload.failureReason === "string" && payload.failureReason.trim()
      ? { failureReason: payload.failureReason.trim().slice(0, CLOUD_AGENT_REASON_MAX) }
      : {}),
    ...(payload.review === "checking" ||
    payload.review === "accepted" ||
    payload.review === "rejected" ||
    payload.review === "needs_owner"
      ? { review: payload.review }
      : {}),
    ...(Array.isArray(payload.attempts) && payload.attempts.length
      ? { attempts: payload.attempts.flatMap(cloudAgentAttempt).slice(-CLOUD_AGENT_ATTEMPTS_MAX) }
      : {}),
  };
}

const CLOUD_AGENT_PROGRESS_MAX = 240;
const CLOUD_AGENT_EXCERPT_MAX = 400;

/** Plain text on one line (markdown marks removed), cut at `max` with an ellipsis; nothing when there is none. */
export function clipCloudAgentText(value: string, max: number): string {
  const text = value
    // Markdown reads as plain words on a card: links keep their text, marks and bullets go.
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]{1,3}(?=\S)|(?<=\S)[`*_]{1,3}/g, "")
    .replace(/^[ \t]*(?:#{1,6}|[-*+])[ \t]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function clipped(value: unknown, max: number): string {
  return typeof value === "string" ? clipCloudAgentText(value, max) : "";
}

const CLOUD_AGENT_REASON_MAX = 300;
const CLOUD_AGENT_ATTEMPTS_MAX = 5;
const ATTEMPT_STATUSES = ["running", "finished", "failed", "cancelled", "expired"] as const;

function cloudAgentAttempt(value: unknown): NonNullable<CloudAgentBlock["attempts"]>[number][] {
  const attempt = value as Record<string, unknown> | null;
  if (typeof attempt?.agentId !== "string") return [];
  const status = ATTEMPT_STATUSES.find((known) => known === attempt.status);
  if (!status) return [];
  return [
    {
      agentId: attempt.agentId,
      status,
      ...(typeof attempt.failureReason === "string" && attempt.failureReason
        ? { failureReason: attempt.failureReason.slice(0, CLOUD_AGENT_REASON_MAX) }
        : {}),
      ...(typeof attempt.startedAt === "string" ? { startedAt: attempt.startedAt } : {}),
    },
  ];
}
