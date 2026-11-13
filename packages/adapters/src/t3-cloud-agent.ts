import type {
  AdapterContext,
  CloudAgentAttention,
  CloudAgentHandle,
  CloudAgentLaunchRequest,
  CloudAgentProvider,
  CloudAgentReplyRequest,
  CloudAgentSnapshot,
  CloudAgentStatus,
  ConnectorProvider,
} from "@rakazo/adapter-kit";
import { CloudAgentRequestRejected, CloudAgentRetryLater } from "@rakazo/adapter-kit";
import { z } from "zod";

/** T3 Code's thread tools, reached through the space's MCP connection as the requesting bot. */
export interface T3CloudAgentOptions {
  connector: ConnectorProvider;
  /** The MCP server slug, so tools are `mcp__<slug>__<tool>`. */
  server: string;
  /** Names this Rakazo's event holds; one per configured connection. */
  holdKey: string;
}

/** The tools a bot's assignment must allow before it is offered cloud agents on this provider. */
export const T3_CLOUD_AGENT_TOOLS = [
  "t3_thread_launch",
  "t3_thread_events",
  "t3_thread_list",
  "t3_thread_send",
  "t3_thread_interrupt",
  "t3_pending_request",
  "t3_project_list",
  "orchestrator_capabilities",
] as const;

const EVENTS_CONTRACT_VERSION = 1;
const IDLE_CONFIRM_MS = 1_000;
const MAX_EVENT_PAGES = 10;

const failureSchema = z.object({ code: z.string(), message: z.string().optional() });

/**
 * T3 sends a refused call's encoded failure as JSON in its text content, not as structured
 * content. A refusal that is not an encoded failure is its message alone.
 */
function t3Failure(result: { structuredContent?: unknown; content?: unknown }) {
  const structured = failureSchema.safeParse(result.structuredContent);
  if (structured.success) return structured.data;
  const block = Array.isArray(result.content) ? result.content[0] : undefined;
  const text = block?.type === "text" && typeof block.text === "string" ? block.text : "";
  try {
    const encoded = failureSchema.safeParse(JSON.parse(text));
    if (encoded.success) return encoded.data;
  } catch {}
  return { code: "", message: text || undefined };
}

/** The connection refused this mode before creating a thread. The message is the field name only. */
class ModeEscalationDenied extends Error {
  constructor(
    readonly field: "runtimeMode" | "interactionMode",
    readonly detail?: string,
  ) {
    super(field);
  }
}
const startedModelSchema = z.object({
  model: z.string(),
  instanceId: z.string().optional(),
  provider: z.string().optional(),
});
const launchSchema = z.object({
  threadId: z.string().min(1),
  link: z.string().optional(),
  runId: z.string().nullable(),
});
const threadReadSchema = z.object({
  thread: z.object({ model: z.string().optional(), providerInstanceId: z.string().optional() }),
});
const listSchema = z.object({
  threads: z.array(
    z.object({ threadId: z.string(), title: z.string(), link: z.string().optional() }),
  ),
});
const projectsSchema = z.object({
  projects: z.array(
    z.object({
      id: z.string(),
      defaultModelSelection: z.record(z.string(), z.unknown()).nullish(),
      repositoryIdentity: z
        .object({ webUrl: z.string().optional(), canonicalKey: z.string().optional() })
        .nullish(),
    }),
  ),
});
const eventsSchema = z.object({
  contractVersion: z.number(),
  nextSequence: z.number(),
  hasMore: z.boolean(),
  gap: z.object({ reason: z.string() }).nullable(),
  events: z.array(
    z.object({
      kind: z.string(),
      requestId: z.string().optional(),
      requestKind: z.string().optional(),
      requestStatus: z.string().optional(),
    }),
  ),
  state: z.object({
    idle: z.boolean(),
    latestRun: z.object({ runId: z.string(), status: z.string() }).nullable(),
    pendingRequests: z.array(
      z.object({ threadId: z.string(), requestId: z.string(), kind: z.string() }),
    ),
    link: z.string(),
  }),
});
const sendSchema = z.object({ runId: z.string() });
const capabilitiesSchema = z.object({
  providers: z.array(
    z.object({
      providerInstanceId: z.string(),
      canRunChildTask: z.boolean(),
      models: z.array(z.object({ id: z.string() })),
    }),
  ),
});
const questionSchema = z.object({ questions: z.array(z.object({ id: z.string() })) });

/** The provider link is Markdown or an autolink and contains the environment identity. */
export function t3CanonicalLink(link: string, id: string): string {
  const match = /t3-thread:\/\/v2\/([^/\s)>]+)\/([^\s)>]+)/.exec(link);
  if (!match) return "";
  try {
    if (decodeURIComponent(match[2]!) !== id) return "";
    const environment = decodeURIComponent(match[1]!);
    if (!environment) return "";
    return `t3code://threads/${encodeURIComponent(environment)}/${encodeURIComponent(id)}`;
  } catch {
    return "";
  }
}

type RequestedModel = NonNullable<CloudAgentLaunchRequest["modelSelection"]>;

/** T3 names the provider kind in `provider` and the instance in `instanceId`; a bare instance name goes in the latter. */
export function instanceSelection(selection: RequestedModel) {
  if (selection.instanceId || !selection.provider) return selection;
  const { provider, ...rest } = selection;
  return { ...rest, instanceId: provider };
}

/** What the thread actually runs on, worded for the bot; says so when it is not what was asked. */
export function startedNote(
  requested: RequestedModel | undefined,
  started: z.infer<typeof startedModelSchema>,
): string {
  const instance = started.instanceId ? ` on ${started.instanceId}` : "";
  const asked = requested && instanceSelection(requested);
  if (!asked) return `Started ${started.model}${instance}.`;
  if (
    asked.model === started.model &&
    (!asked.instanceId || asked.instanceId === started.instanceId)
  )
    return `Started ${started.model}${instance}.`;
  return `Requested ${asked.model}${asked.instanceId ? ` on ${asked.instanceId}` : ""}, T3 started ${started.model}${instance}.`;
}

/** Thread ids are the agent id; the title tag finds a launch a lost response hid. */
export class T3CloudAgentProvider implements CloudAgentProvider {
  constructor(private readonly options: T3CloudAgentOptions) {}

  describe() {
    return {
      id: "t3",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { launch: true, reply: true, cancel: true, offline: false },
    };
  }

  canonicalizeLinks(text: string, id: string, url: string): string {
    try {
      const canonical = new URL(url);
      if (
        canonical.protocol !== "t3code:" ||
        canonical.hostname !== "threads" ||
        decodeURIComponent(canonical.pathname.split("/").at(-1) ?? "") !== id
      )
        return text;
    } catch {
      return text;
    }
    return text.replace(/(?:t3-thread:\/\/v2\/|t3code:\/\/threads\/)[^\s<>()]+/g, (link) => {
      const match = /^(.*?)([.,!?;]*)$/.exec(link)!;
      const target = match[1]!;
      try {
        return decodeURIComponent(target.split("/").at(-1)!) === id ? url + match[2] : link;
      } catch {
        return link;
      }
    });
  }

  async launch(
    request: CloudAgentLaunchRequest,
    context: AdapterContext,
  ): Promise<CloudAgentHandle> {
    // T3 threads take text; dropping images silently would start different work than agreed.
    if (request.images?.length) throw new CloudAgentRequestRejected("invalid");
    const tag = request.idempotencyKey.slice(0, 13);
    const label = (request.title ?? request.prompt.split(/\r?\n/, 1)[0] ?? "").slice(0, 80);
    const title = `${label} · ${tag}`;
    // The retry key only replays within one MCP sign-in, so look for an accepted launch first.
    const listed = listSchema.parse(
      await this.call(
        "t3_thread_list",
        { allProjects: true, titleContains: `· ${tag}`, includeSubagents: false, limit: 5 },
        context,
      ),
    );
    const found = listed.threads.find((thread) => thread.title.endsWith(`· ${tag}`));
    if (found) return this.handle(found.threadId, context);
    const project =
      request.projectId || request.repository ? await this.projectFor(request, context) : undefined;
    // A workspace is a project's checkout; a scratch thread has none.
    if (request.workspaceStrategy && !project) throw new CloudAgentRequestRejected("invalid");
    // A named model goes in the launch itself, so the thread's first turn runs on it. Otherwise
    // scratch threads, and projects without a default, need one named for them.
    const modelSelection =
      (request.modelSelection && instanceSelection(request.modelSelection)) ??
      (project?.defaultModelSelection ? undefined : await this.defaultModel(context));
    const launched = launchSchema.parse(
      await this.launchWithinCeiling(
        {
          title,
          message: request.prompt,
          clientRequestId: request.idempotencyKey,
          ...(modelSelection ? { modelSelection } : {}),
          ...(project
            ? {
                projectId: project.id,
                workspaceStrategy: request.workspaceStrategy ?? {
                  type: "worktree",
                  baseRef: "origin/HEAD",
                  startFromOrigin: true,
                },
              }
            : { scratch: true }),
          ...(request.runtimeMode ? { runtimeMode: request.runtimeMode } : {}),
          ...(request.interactionMode ? { interactionMode: request.interactionMode } : {}),
        },
        context,
      ),
    );
    // A named model is checked against what T3 started; one left out keeps T3's default unreported.
    // The launch response echoes the request, so only the thread says what really started.
    const started = request.modelSelection
      ? await this.startedModel(launched.threadId, context)
      : undefined;
    const launchNote = started && startedNote(request.modelSelection, started);
    // The tag stays in T3's own title for the lookup above; the owner's card shows the label.
    return {
      id: launched.threadId,
      url: t3CanonicalLink(launched.link ?? "", launched.threadId),
      title: label,
      status: "running",
      ...(launched.runId ? { latestRunId: launched.runId } : {}),
      ...(launchNote ? { launchNote } : {}),
    };
  }

  async get(
    id: string,
    context: AdapterContext,
    _runId?: string,
    cursor = 0,
  ): Promise<CloudAgentSnapshot> {
    return this.read(id, context, cursor, true);
  }

  private async read(
    id: string,
    context: AdapterContext,
    cursor: number,
    hold: boolean,
  ): Promise<CloudAgentSnapshot> {
    let next = cursor;
    let historyGap = false;
    let page: z.infer<typeof eventsSchema> | undefined;
    // The last status each request reached in this window, so one that opened and closed between
    // polls is still seen.
    const requests = new Map<string, { kind: string; status: string }>();
    for (let read = 0; read < MAX_EVENT_PAGES; read += 1) {
      page = eventsSchema.parse(
        await this.call(
          "t3_thread_events",
          {
            threadId: id,
            afterSequence: next,
            limit: 200,
            ...(hold ? { retain: { key: this.options.holdKey } } : {}),
          },
          context,
        ),
      );
      if (page.contractVersion !== EVENTS_CONTRACT_VERSION) throw new CloudAgentRequestRejected();
      historyGap ||= page.gap !== null;
      for (const event of page.events) {
        if (event.kind === "request" && event.requestId && event.requestStatus)
          requests.set(event.requestId, {
            kind: event.requestKind ?? "",
            status: event.requestStatus,
          });
      }
      next = page.nextSequence;
      if (!page.hasMore) break;
    }
    let { state } = page!;
    // Unread events may hold a question that closed, so the thread is not finished until they are read.
    const drained = !page!.hasMore;
    if (drained && state.idle && state.latestRun) {
      // T3 can end a run and queue its continuation (a restart, a delegated result) in separate
      // writes; only a second idle read of the same run says the thread really stopped.
      await new Promise((resolve) => setTimeout(resolve, IDLE_CONFIRM_MS));
      const confirm = eventsSchema.parse(
        await this.call(
          "t3_thread_events",
          { threadId: id, afterSequence: next, limit: 1 },
          context,
        ),
      );
      const again = confirm.state;
      // New events in the meantime are read by the next poll before the thread can finish.
      if (confirm.events.length || !again.idle || again.latestRun?.runId !== state.latestRun.runId)
        state = { ...again, idle: false };
    }
    const run = state.latestRun;
    const pending = new Set(state.pendingRequests.map((request) => request.requestId));
    const missedAttention = [...requests]
      .filter(
        ([requestId, request]) =>
          !pending.has(requestId) &&
          (request.status === "expired" || request.status === "cancelled"),
      )
      .map(([requestId, request]) => attentionOf(requestId, request.kind));
    const status: CloudAgentStatus =
      !drained || !state.idle || !run ? "running" : terminalStatus(run.status);
    return {
      id,
      url: t3CanonicalLink(state.link, id),
      title: "",
      status,
      ...(run ? { latestRunId: run.runId } : {}),
      cursor: next,
      attention: state.pendingRequests.map((request) =>
        attentionOf(
          request.requestId,
          request.kind,
          request.threadId !== id ? request.threadId : undefined,
        ),
      ),
      missedAttention,
      historyGap,
    };
  }

  /** The current state without moving the poller's cursor or hold. */
  private async peek(id: string, context: AdapterContext): Promise<CloudAgentSnapshot> {
    // Past the head and without the hold: only `state` is read, and the poller's cursor stays put.
    const {
      cursor: _cursor,
      historyGap: _gap,
      missedAttention: _missed,
      ...snapshot
    } = await this.read(id, context, Number.MAX_SAFE_INTEGER, false);
    return snapshot;
  }

  /**
   * The current state for a launch or answer. Running until a cursor read has seen the events a
   * peek skips, which may hold a question that closed and still owes a wake.
   */
  private async handle(id: string, context: AdapterContext): Promise<CloudAgentSnapshot> {
    return { ...(await this.peek(id, context)), status: "running" };
  }

  async reply(
    id: string,
    request: CloudAgentReplyRequest,
    context: AdapterContext,
  ): Promise<CloudAgentHandle> {
    if (request.images?.length) throw new CloudAgentRequestRejected("invalid");
    if (request.questionId) {
      const threadId = request.questionThreadId ?? id;
      try {
        const { questions } = questionSchema.parse(
          await this.call(
            "t3_pending_request",
            { action: "read", threadId, requestId: request.questionId },
            context,
          ),
        );
        await this.call(
          "t3_pending_request",
          {
            action: "respond",
            threadId,
            requestId: request.questionId,
            answers: Object.fromEntries(questions.map((question) => [question.id, request.prompt])),
          },
          context,
        );
      } catch (error) {
        // An answer accepted before a lost response leaves nothing to answer; that is success.
        if (!(error instanceof CloudAgentRequestRejected)) throw error;
        const snapshot = await this.peek(id, context);
        if (snapshot.attention?.some((item) => item.requestId === request.questionId)) throw error;
        return { ...snapshot, status: "running" };
      }
      return this.handle(id, context);
    }
    const sent = sendSchema.parse(
      await this.call(
        "t3_thread_send",
        {
          threadId: id,
          message: request.prompt,
          mode: "queue",
          ...(request.idempotencyKey ? { clientRequestId: request.idempotencyKey } : {}),
        },
        context,
      ),
    );
    return { id, url: "", title: "", status: "running", latestRunId: sent.runId };
  }

  async cancel(id: string, context: AdapterContext): Promise<CloudAgentSnapshot> {
    // A thread already stopped refuses another stop; its state still says it ended.
    await this.call("t3_thread_interrupt", { threadId: id, stop: true }, context).catch(
      (error: unknown) => {
        if (!(error instanceof CloudAgentRequestRejected)) throw error;
      },
    );
    const snapshot = await this.peek(id, context);
    return snapshot.status === "failed" ? { ...snapshot, status: "cancelled" } : snapshot;
  }

  /** One read of the new thread for the model and instance it runs on. */
  private async startedModel(id: string, context: AdapterContext) {
    try {
      const { thread } = threadReadSchema.parse(
        await this.call("t3_thread_read", { threadId: id, limit: 1, runLimit: 1 }, context),
      );
      return thread.model
        ? {
            model: thread.model,
            ...(thread.providerInstanceId ? { instanceId: thread.providerInstanceId } : {}),
          }
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async defaultModel(context: AdapterContext) {
    const { providers } = capabilitiesSchema.parse(
      await this.call("orchestrator_capabilities", {}, context),
    );
    const provider = providers.find(
      (candidate) => candidate.canRunChildTask && candidate.models[0],
    );
    if (!provider) throw new CloudAgentRetryLater("unavailable");
    return { instanceId: provider.providerInstanceId, model: provider.models[0]!.id };
  }

  /** The named project, or the one for the repository; both named must be the same project. */
  private async projectFor(
    request: Pick<CloudAgentLaunchRequest, "projectId" | "repository">,
    context: AdapterContext,
  ) {
    const { projects } = projectsSchema.parse(
      await this.call("t3_project_list", { limit: 100 }, context),
    );
    const wanted = request.repository && normalizeRepository(request.repository);
    const holds = (project: (typeof projects)[number]) => {
      const identity = project.repositoryIdentity;
      return [identity?.webUrl, identity?.canonicalKey].some(
        (value) => value && normalizeRepository(value) === wanted,
      );
    };
    const match = projects.find((project) =>
      request.projectId ? project.id === request.projectId : holds(project),
    );
    if (!match || (request.projectId && wanted && !holds(match)))
      throw new CloudAgentRequestRejected("invalid");
    return match;
  }

  /**
   * A mode broader than the connection is refused before any thread exists. Drop that one mode
   * and try again so the thread inherits the connection's ceiling. The prompt, project, workspace
   * and model stay. The same refusal once the mode is gone is final: no thread and no url.
   */
  private async launchWithinCeiling(
    args: Record<string, unknown>,
    context: AdapterContext,
  ): Promise<unknown> {
    const fields = { ...args };
    const dropped = new Set<string>();
    for (;;) {
      try {
        return await this.call("t3_thread_launch", { ...fields }, context, {
          modeEscalation: true,
        });
      } catch (error) {
        const denied = error instanceof ModeEscalationDenied ? error : undefined;
        if (!denied || dropped.has(denied.field) || !(denied.field in fields)) {
          if (denied) throw new CloudAgentRequestRejected("invalid", denied.detail);
          throw error;
        }
        dropped.add(denied.field);
        delete fields[denied.field];
      }
    }
  }

  /** One tool call through the connector, so bot assignment, sign-in and outages apply. */
  private async call(
    tool: string,
    args: Record<string, unknown>,
    context: AdapterContext,
    options?: { modeEscalation?: boolean },
  ): Promise<unknown> {
    const name = `mcp__${this.options.server}__${tool}`;
    const { connector } = this.options;
    const resolved = await connector
      .resolveCall?.({ tool: name, args, executionId: context.operationId }, context)
      .catch(() => undefined);
    if (!resolved) throw new CloudAgentRetryLater("unavailable");
    if (resolved.tool.unavailable === true) throw new CloudAgentRetryLater("unavailable");
    let data: unknown;
    for await (const event of connector.execute(resolved.call, context)) {
      if (event.type === "result") data = event.data;
      else if (event.type === "error") {
        if (event.retryable) throw new CloudAgentRetryLater("unavailable");
        // Not assigned to this bot, or refused outright: retrying cannot change it.
        throw new CloudAgentRequestRejected("invalid", event.message);
      }
    }
    const result = (data ?? {}) as {
      isError?: boolean;
      structuredContent?: unknown;
      content?: unknown;
    };
    if (result.isError) {
      const { code, message } = t3Failure(result);
      if (code === "thread_not_found") throw new CloudAgentRequestRejected("not_found", message);
      if (code === "orchestration_error" || code === "provider_unavailable")
        throw new CloudAgentRetryLater("unavailable");
      if (options?.modeEscalation && code === "runtime_mode_escalation_denied")
        throw new ModeEscalationDenied("runtimeMode", message);
      if (options?.modeEscalation && code === "interaction_mode_escalation_denied")
        throw new ModeEscalationDenied("interactionMode", message);
      throw new CloudAgentRequestRejected("invalid", message);
    }
    return result.structuredContent ?? data;
  }
}

/**
 * The thread a bot launched or messaged by calling T3's own tools, so the same completion wake
 * covers it as a tracked launch. A failed call started nothing.
 */
export function t3DirectThread(
  server: string,
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
): { remoteId: string; title: string } | undefined {
  const data = result as { isError?: boolean; error?: unknown; structuredContent?: unknown } | null;
  // A refused call, from the server or the connector, changed nothing to track.
  if (!data || data.isError || data.error !== undefined) return undefined;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  // Compacting tidies the thread's context between pieces of work; it has no result to judge.
  if (text(args.message).trim() === "/compact") return undefined;
  const title = text(args.title) || (text(args.message).split(/\r?\n/, 1)[0] ?? "");
  const remoteId =
    tool === `mcp__${server}__t3_thread_launch`
      ? launchSchema.safeParse(data.structuredContent).data?.threadId
      : tool === `mcp__${server}__t3_thread_send`
        ? text(args.threadId)
        : undefined;
  return remoteId ? { remoteId, title } : undefined;
}

function attentionOf(requestId: string, kind: string, threadId?: string): CloudAgentAttention {
  return {
    requestId,
    kind: kind === "user_input" ? "question" : "approval",
    ...(threadId ? { threadId } : {}),
  };
}

function terminalStatus(status: string): CloudAgentStatus {
  if (status === "completed") return "finished";
  if (status === "cancelled" || status === "rolled_back") return "cancelled";
  return "failed";
}

function normalizeRepository(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/|git@)/, "")
    .replace(/:/, "/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}
