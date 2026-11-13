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

export function cloudAgentBlockFromPayload(
  payload: Record<string, unknown>,
): Extract<MessageBlock, { kind: "cloud_agent" }> {
  const status = payload.status;
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
  };
}
