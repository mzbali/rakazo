import type {
  AdapterContext,
  CloudAgentAttention,
  CloudAgentHandle,
  CloudAgentLaunchRequest,
  CloudAgentProvider,
  CloudAgentPullRequest,
  CloudAgentReplyRequest,
  CloudAgentSnapshot,
  CloudAgentStatus,
  ConnectorProvider,
} from "@rakazo/adapter-kit";
import { CloudAgentRequestRejected, CloudAgentRetryLater } from "@rakazo/adapter-kit";
import { z } from "zod";
import {
  candidateNames,
  normalizeRepository,
  projectNames,
  projectsSchema,
  repositoryKeys,
} from "./t3-cloud-agent-projects.js";
import { parseThreadWork, shownPullRequest } from "./t3-cloud-agent-pull-requests.js";
import type { T3ModelRoutes } from "./t3-model-routes.js";
import { answerFor, questionOf, questionSchema } from "./t3-pending-question.js";

/** T3 Code's thread tools, reached through the space's MCP connection as the requesting bot. */
export interface T3CloudAgentOptions {
  connector: ConnectorProvider;
  /** The MCP server slug, so tools are `mcp__<slug>__<tool>`. */
  server: string;
  /** Names this Rakazo's event holds; one per configured connection. */
  holdKey: string;
  /** Ordered models per kind of work; a launch with a `workKind` takes the first with quota. */
  routes?: T3ModelRoutes;
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
/** The final message is kept to this many characters, from a timeline read this many pages deep. */
const MAX_RESULT_CHARS = 12_000;
/** A longer one keeps its start and its end, where conclusions usually are. */
const RESULT_HEAD_CHARS = 8_000;
const RESULT_TAIL_CHARS = 3_500;
/** T3's own per-item cap, so it never cuts the message before the end can be kept. */
const T3_ITEM_CHARS = 50_000;
const MAX_RESULT_PAGES = 10;
/** A live progress line reads fewer pages: a long run's line may lag, never block the poll. */
const MAX_PROGRESS_PAGES = 3;
const PROGRESS_CHARS = 1_000;

const INTERNAL_SERVER_ERROR = "Tool execution failed due to an internal server error.";

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
const titleSchema = z.object({ thread: z.object({ title: z.string().optional() }) });
const timelineSchema = z.object({
  items: z
    .array(z.object({ type: z.string(), runId: z.string(), text: z.string().nullish() }))
    .default([]),
  nextPosition: z.number().nullish().default(null),
  hasMore: z.boolean().default(false),
});
const listSchema = z.object({
  threads: z.array(
    z.object({ threadId: z.string(), title: z.string(), link: z.string().optional() }),
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
    /**
     * Set when the latest run failed on a usage limit and nothing ran after it.
     * Older servers omit it. `autoResume` means the server sends the continuation itself.
     */
    limit: z.object({ resetAt: z.string(), autoResume: z.boolean() }).nullable().optional(),
  }),
});
const sendSchema = z.object({ runId: z.string() });
/** Quota fields come from newer T3 builds; without them every model has room. */
const capabilitiesSchema = z.object({
  providers: z.array(
    z.object({
      providerInstanceId: z.string(),
      canRunChildTask: z.boolean(),
      models: z.array(
        z.object({
          id: z.string(),
          exhausted: z.boolean().optional(),
          resetsAt: z.string().optional(),
        }),
      ),
      usage: z
        .object({
          windows: z.array(
            z.object({ exhausted: z.boolean().optional(), resetsAt: z.string().optional() }),
          ),
        })
        .optional(),
    }),
  ),
  earliestResetAt: z.string().optional(),
});
type Capabilities = z.infer<typeof capabilitiesSchema>;

const MIN_QUOTA_WAIT_MS = 60_000;
const MAX_QUOTA_WAIT_MS = 6 * 3_600_000;
/** How long to wait when T3 says a model is out of quota but not when it comes back. */
const UNKNOWN_QUOTA_WAIT_MS = 15 * 60_000;

/** A model's quota as the capabilities report it; the reset falls back to its provider's, then T3's earliest. */
function quotaOf(capabilities: Capabilities, model: string, instanceId?: string) {
  for (const provider of capabilities.providers) {
    if (instanceId && provider.providerInstanceId !== instanceId) continue;
    const entry = provider.models.find((candidate) => candidate.id === model);
    if (!entry) continue;
    const windows = (provider.usage?.windows ?? [])
      .filter((window) => window.exhausted)
      .map((window) => window.resetsAt);
    const resetsAt = [entry.resetsAt, ...windows, capabilities.earliestResetAt]
      .map((value) => (value ? Date.parse(value) : Number.NaN))
      .find((value) => !Number.isNaN(value));
    return { provider, exhausted: entry.exhausted === true, resetsAt };
  }
  return undefined;
}

/** A reset in UTC; the date only when it is not today. */
function utcStamp(at: number, now: number): string {
  const iso = new Date(at).toISOString();
  const time = `${iso.slice(11, 16)} UTC`;
  return iso.slice(0, 10) === new Date(now).toISOString().slice(0, 10)
    ? time
    : `${iso.slice(0, 10)} ${time}`;
}

/** Every model that could run the work is out: retry at the earliest reset, not as an outage. */
function quotaWait(resets: Array<number | undefined>, now: number, detail?: string) {
  const known = resets.filter((at): at is number => at !== undefined && at > now);
  const at = known.length ? Math.min(...known) : undefined;
  const wait = Math.min(
    MAX_QUOTA_WAIT_MS,
    Math.max(MIN_QUOTA_WAIT_MS, (at ?? now + UNKNOWN_QUOTA_WAIT_MS) - now),
  );
  const note = `Waiting for quota${at ? ` until ${utcStamp(at, now)}` : ""}${detail ? `: ${detail}` : ""}.`;
  return new CloudAgentRetryLater("quota", wait, note);
}
/**
 * The provider link is Markdown or an autolink and contains the environment identity, as a
 * `t3-thread://` link or the web form `https://<host>/threads/<environment>/<thread>`.
 */
export function t3CanonicalLink(link: string, id: string): string {
  const match =
    /t3-thread:\/\/v2\/([^/\s)>]+)\/([^\s)>]+)/.exec(link) ??
    /https:\/\/[^/\s)>]+\/threads\/([^/\s)>]+)\/([^/\s)>?#]+)/.exec(link);
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
    const label = (request.title ?? "Cloud agent").slice(0, 80);
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
    const project = await this.projectFor(request, context);
    // A workspace is a project's checkout; a scratch thread has none.
    if (request.workspaceStrategy && !project) throw new CloudAgentRequestRejected("invalid");
    const chosen = await this.chooseModel(request, context);
    const requested = request.modelSelection ?? chosen?.selection;
    // A named model goes in the launch itself, so the thread's first turn runs on it. Otherwise
    // scratch threads, and projects without a default, need one named for them.
    const modelSelection =
      (requested && instanceSelection(requested)) ??
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
                // Local HEAD: a project with no remote has no origin/HEAD to start from.
                workspaceStrategy: request.workspaceStrategy ?? {
                  type: "worktree",
                  baseRef: "HEAD",
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
    const started = requested ? await this.startedModel(launched.threadId, context) : undefined;
    const startedText = started && startedNote(requested, started);
    // A route's note says what was picked and why; T3 starting something else is added to it.
    const launchNote = chosen?.note
      ? startedText?.startsWith("Requested")
        ? `${chosen.note} ${startedText}`
        : chosen.note
      : startedText;
    // The thread keeps the tag in its title until a poll has seen it, for the lookup above.
    return {
      id: launched.threadId,
      url: t3CanonicalLink(launched.link ?? "", launched.threadId),
      title: label,
      status: "running",
      ...(launched.runId ? { latestRunId: launched.runId } : {}),
      ...(launchNote ? { launchNote } : {}),
    };
  }

  /** Settles the thread in T3, so finished work leaves the owner's list. */
  async settle(id: string, context: AdapterContext): Promise<void> {
    await this.call("t3_thread_organize", { threadId: id, action: "settle" }, context, {
      optional: true,
    });
  }

  async get(
    id: string,
    context: AdapterContext,
    _runId?: string,
    cursor = 0,
  ): Promise<CloudAgentSnapshot> {
    // Once a poll sees the thread, the tag has done its job: T3 shows the card's title instead.
    const snapshot = await this.read(id, context, cursor, true);
    if (cursor === 0) await this.dropTitleTag(id, context).catch(() => undefined);
    return snapshot;
  }

  /** Renames a thread still carrying the launch tag; a title anyone changed is left alone. */
  private async dropTitleTag(id: string, context: AdapterContext) {
    const read = titleSchema.parse(
      await this.call("t3_thread_read", { threadId: id, limit: 1, runLimit: 1 }, context),
    );
    const label = /^(.*) · [\w-]{12,13}$/.exec(read.thread.title ?? "")?.[1];
    if (label)
      await this.call(
        "t3_thread_update",
        { threadId: id, action: "rename", title: label },
        context,
        {
          optional: true,
        },
      );
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
    let sawEvents = false;
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
      sawEvents ||= page.events.length > 0;
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
    const limit = usageLimit(state.limit);
    const pending = new Set(state.pendingRequests.map((request) => request.requestId));
    const missedAttention = [...requests]
      .filter(
        ([requestId, request]) =>
          !pending.has(requestId) &&
          (request.status === "expired" || request.status === "cancelled"),
      )
      .map(([requestId, request]) => attentionOf(requestId, request.kind));
    // A usage limit is a pause: the run failed, and the work continues after the reset.
    const status: CloudAgentStatus = limit
      ? "running"
      : !drained || !state.idle || !run
        ? "running"
        : terminalStatus(run.status);
    const result =
      status === "finished" && run ? await this.finalMessage(id, run.runId, context) : undefined;
    // The events carry no text, so the latest line is read only when this poll saw new events.
    const progress =
      status === "running" && run && sawEvents
        ? await this.latestMessage(id, run.runId, context, MAX_PROGRESS_PAGES)
        : undefined;
    // A merge or an ended watch is no run event: a waiting thread is read every poll, a working one when it did something.
    const threadWork =
      sawEvents || status !== "running" || run?.status !== "running"
        ? await this.readThreadWork(id, t3CanonicalLink(state.link, id), context, true)
        : undefined;
    const pullRequest = threadWork ? shownPullRequest(threadWork, run) : {};
    return {
      id,
      url: t3CanonicalLink(state.link, id),
      title: "",
      status,
      ...pullRequest,
      ...(run ? { latestRunId: run.runId } : {}),
      cursor: next,
      attention: await Promise.all(
        state.pendingRequests.map(async (request) => ({
          ...attentionOf(
            request.requestId,
            request.kind,
            request.threadId !== id ? request.threadId : undefined,
          ),
          ...(hold && request.kind === "user_input"
            ? await this.questionFor(request.threadId, request.requestId, context)
            : {}),
        })),
      ),
      missedAttention,
      historyGap,
      ...(result ? { result } : {}),
      ...(progress ? { progress: progress.slice(0, PROGRESS_CHARS) } : {}),
      ...limit,
    };
  }

  /**
   * The run's last assistant message. The events feed carries no text, and a bot's helper may not
   * read the thread itself, so it is read here. The timeline pages oldest first.
   */
  private async finalMessage(id: string, runId: string, context: AdapterContext) {
    const { text, complete } = await this.readLastMessage(id, runId, context, MAX_RESULT_PAGES);
    // A timeline longer than the read cap may end in a later message, so an earlier one is not the result.
    if (!complete || text === undefined) return undefined;
    return text.length > MAX_RESULT_CHARS
      ? `${text.slice(0, RESULT_HEAD_CHARS)}\n…\n${text.slice(-RESULT_TAIL_CHARS)}`
      : text;
  }

  /**
   * The newest assistant message, only when the timeline was read to its end. The timeline pages
   * oldest first, so a read cut short by the cap holds an older message, never the latest.
   */
  private async latestMessage(id: string, runId: string, context: AdapterContext, pages: number) {
    const { text, complete } = await this.readLastMessage(id, runId, context, pages);
    return complete ? text : undefined;
  }

  private async readLastMessage(id: string, runId: string, context: AdapterContext, pages: number) {
    let text: string | undefined;
    let complete = false;
    try {
      let afterPosition: number | undefined;
      for (let read = 0; read < pages; read += 1) {
        const page = timelineSchema.parse(
          await this.call(
            "t3_thread_read",
            {
              threadId: id,
              limit: 100,
              runLimit: 1,
              maxCharsPerItem: T3_ITEM_CHARS,
              ...(afterPosition === undefined ? {} : { afterPosition }),
            },
            context,
            { optional: true },
          ),
        );
        for (const item of page.items)
          if (item.type === "assistant_message" && item.runId === runId && item.text?.trim())
            text = item.text;
        if (!page.hasMore || page.nextPosition === null) {
          complete = true;
          break;
        }
        afterPosition = page.nextPosition;
      }
    } catch (error) {
      // A refused or unreadable result leaves the agent finished without one; an outage is retried.
      if (error instanceof CloudAgentRetryLater) throw error;
    }
    return { text, complete };
  }

  /** The options for the card's answer buttons; a question that cannot be read still shows as one. */
  private async questionFor(threadId: string, requestId: string, context: AdapterContext) {
    try {
      const question = questionOf(
        await this.call("t3_pending_request", { action: "read", threadId, requestId }, context),
      );
      return question ? { question } : {};
    } catch (error) {
      if (error instanceof CloudAgentRetryLater || error instanceof CloudAgentRequestRejected)
        return {};
      throw error;
    }
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
    // A question just answered may still show the limit for a moment. Poll soon and let the
    // next read put the pause back if the thread is still stopped.
    const {
      quotaResetsAt: _reset,
      quotaAutoResume: _resume,
      ...snapshot
    } = await this.peek(id, context);
    return { ...snapshot, status: "running" };
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
            answers: Object.fromEntries(
              questions.map((question) => [question.id, answerFor(question, request.prompt)]),
            ),
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
    // A limit pause reports running. Stopping it ends the job, the same as a run that already failed.
    if (snapshot.status === "failed" || snapshot.quotaResetsAt) {
      const { quotaResetsAt: _reset, quotaAutoResume: _resume, ...rest } = snapshot;
      return { ...rest, status: "cancelled" };
    }
    return snapshot;
  }

  async pullRequests(id: string, context: AdapterContext): Promise<CloudAgentPullRequest[]> {
    const { pullRequests } = (await this.readThreadWork(id, "", context))!;
    return pullRequests.map(({ watching: _watching, ...pr }) => pr);
  }

  /** `lenient`: a bot whose assignment leaves out the thread read just shows nothing of it. */
  private async readThreadWork(id: string, link: string, context: AdapterContext, lenient = false) {
    try {
      const read = await this.call(
        "t3_thread_read",
        { threadId: id, limit: 1, runLimit: 1 },
        context,
        { optional: lenient },
      );
      // A child thread sits in the same environment as its parent.
      return parseThreadWork(read, (childId) =>
        link.replace(/[^/]+$/, encodeURIComponent(childId)),
      );
    } catch (error) {
      if (lenient && error instanceof CloudAgentRequestRejected) return undefined;
      throw error;
    }
  }

  /**
   * Quota first, then kind of work: the first route for the work's kind with quota room, or the
   * model the owner named if it has room. Out of quota everywhere, the launch waits for the
   * earliest reset. Without a kind or routes for it, or a T3 that reports no quota, nothing changes.
   */
  private async chooseModel(
    request: CloudAgentLaunchRequest,
    context: AdapterContext,
  ): Promise<{ selection?: RequestedModel; note?: string } | undefined> {
    const kind = request.workKind;
    const routes = kind && this.options.routes?.[kind];
    if (!kind || !routes?.length) return undefined;
    const capabilities = capabilitiesSchema.parse(
      await this.call("orchestrator_capabilities", {}, context),
    );
    const now = Date.now();
    if (request.modelSelection) {
      const asked = instanceSelection(request.modelSelection);
      const quota = quotaOf(capabilities, asked.model, asked.instanceId);
      if (quota?.exhausted)
        throw quotaWait([quota.resetsAt], now, `${asked.model} is out of quota`);
      return undefined;
    }
    const skipped: Array<{ model: string; resetsAt?: number }> = [];
    for (const route of routes) {
      const quota = quotaOf(capabilities, route.model, route.instanceId);
      // An instance that is absent or cannot run tasks is not a quota matter: try the next.
      if (!quota?.provider.canRunChildTask) continue;
      if (quota.exhausted) {
        skipped.push({ model: route.model, resetsAt: quota.resetsAt });
        continue;
      }
      const why = skipped.map(
        ({ model, resetsAt }) =>
          `${model} out of quota${resetsAt && resetsAt > now ? ` until ${utcStamp(resetsAt, now)}` : ""}`,
      );
      return {
        selection: {
          model: route.model,
          instanceId: route.instanceId,
          ...(route.options ? { options: route.options } : {}),
        },
        note: `Picked ${route.model} on ${route.instanceId} (${[kind, ...why, ...(route.options ?? []).filter((option) => option.id === "effort").map((option) => `effort ${option.value}`)].join("; ")}).`,
      };
    }
    if (skipped.length)
      throw quotaWait(
        skipped.map((route) => route.resetsAt),
        now,
      );
    return { note: `No ${kind} route is available; T3's default was used.` };
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

  /**
   * The project the work belongs to, by id, repository or name; all that are given must name the
   * same one. No project is a scratch thread, and only when the launch asks for it: a refusal
   * lists the candidates so the bot can pick.
   */
  private async projectFor(
    request: Pick<CloudAgentLaunchRequest, "projectId" | "repository" | "project" | "scratch">,
    context: AdapterContext,
  ) {
    const named = request.projectId || request.repository || request.project;
    if (request.scratch) {
      if (named) throw new CloudAgentRequestRejected("invalid", "scratch cannot name a project.");
      return undefined;
    }
    const { projects: listed } = projectsSchema.parse(
      await this.call("t3_project_list", { limit: 100 }, context),
    );
    const projects = listed.filter((project) => !project.archivedAt);
    const refuse = (problem: string) =>
      new CloudAgentRequestRejected("invalid", `${problem} ${candidateNames(projects)}`);
    if (!named)
      throw refuse(
        "No project given. Pass project (a project or repository name) or repository, or scratch: true for work that belongs to no project.",
      );
    const wanted = request.repository && normalizeRepository(request.repository);
    const name = request.project?.trim().toLowerCase();
    const matches = projects.filter(
      (project) =>
        (!request.projectId || project.id === request.projectId) &&
        (!wanted || repositoryKeys(project).includes(wanted)) &&
        (!name || projectNames(project).includes(name)),
    );
    if (!matches.length) throw refuse(`No project matches "${named}".`);
    if (name && matches.length > 1) throw refuse(`"${request.project}" matches several projects.`);
    return matches[0]!;
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
    options?: { modeEscalation?: boolean; optional?: boolean },
  ): Promise<unknown> {
    const name = `mcp__${this.options.server}__${tool}`;
    const { connector } = this.options;
    const resolved = await connector
      .resolveCall?.({ tool: name, args, executionId: context.operationId }, context)
      .then((call) => call ?? null)
      .catch(() => undefined);
    // An optional tool the bot's assignment leaves out is refused, not an outage to wait out.
    if (resolved === null && options?.optional)
      throw new CloudAgentRequestRejected("invalid", `${tool} is not assigned`);
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
      // T3's own server fault carries no code, only this text; a later call may succeed.
      if (!code && message === INTERNAL_SERVER_ERROR) throw new CloudAgentRetryLater("unavailable");
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
): { remoteId: string; title: string; brief?: string } | undefined {
  const data = result as { isError?: boolean; error?: unknown; structuredContent?: unknown } | null;
  // A refused call, from the server or the connector, changed nothing to track.
  if (!data || data.isError || data.error !== undefined) return undefined;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  // Compacting tidies the thread's context between pieces of work; it has no result to judge.
  if (text(args.message).trim() === "/compact") return undefined;
  const title = text(args.title) || "Cloud agent";
  const remoteId =
    tool === `mcp__${server}__t3_thread_launch`
      ? launchSchema.safeParse(data.structuredContent).data?.threadId
      : tool === `mcp__${server}__t3_thread_send`
        ? text(args.threadId)
        : undefined;
  const sent = tool === `mcp__${server}__t3_thread_send`;
  return remoteId ? { remoteId, title, ...(sent ? { brief: text(args.message) } : {}) } : undefined;
}

/**
 * The thread whose finished result a bot just received by waiting on or reading it, so it reports
 * that result to the owner itself. A refused call, a timed-out wait or a read of a thread still at
 * work showed the bot no result, so it is nothing.
 */
export function t3WatchedThread(
  server: string,
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
): string | undefined {
  if (typeof args.threadId !== "string") return undefined;
  const data = result as { isError?: boolean; error?: unknown; structuredContent?: unknown } | null;
  if (!data || data.isError || data.error !== undefined) return undefined;
  const content = (data.structuredContent ?? {}) as {
    status?: unknown;
    timedOut?: unknown;
    thread?: { status?: unknown; activeRunId?: unknown };
  };
  const finished =
    tool === `mcp__${server}__t3_thread_wait`
      ? content.status === "completed" && content.timedOut === false
      : tool === `mcp__${server}__t3_thread_read`
        ? content.thread?.status === "completed" && content.thread.activeRunId == null
        : false;
  return finished ? args.threadId : undefined;
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

/** A usage-limit stop with a known reset. A missing or unreadable time behaves as no limit. */
function usageLimit(
  limit: { resetAt: string; autoResume: boolean } | null | undefined,
): { quotaResetsAt: string; quotaAutoResume: boolean } | undefined {
  if (!limit) return undefined;
  const at = Date.parse(limit.resetAt);
  if (Number.isNaN(at)) return undefined;
  return { quotaResetsAt: new Date(at).toISOString(), quotaAutoResume: limit.autoResume };
}
