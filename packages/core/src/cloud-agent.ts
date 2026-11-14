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
  };
}
