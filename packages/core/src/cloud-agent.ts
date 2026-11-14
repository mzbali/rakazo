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
  job: Pick<CloudAgentBlock, "status" | "queued" | "needsInput" | "unreachableSince">,
): CloudAgentState {
  if (job.status !== "running") return job.status;
  if (job.needsInput) return "needsInput";
  if (job.unreachableSince) return "unreachable";
  return job.queued ? "queued" : "running";
}

export function cloudAgentTone(state: CloudAgentState): CloudAgentTone {
  switch (state) {
    case "needsInput":
      return "attention";
    case "running":
      return "active";
    case "finished":
      return "success";
    case "failed":
      return "danger";
    default:
      return "muted";
  }
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
    ...(typeof payload.projectName === "string" && payload.projectName
      ? { projectName: payload.projectName.slice(0, 100) }
      : {}),
  };
}
