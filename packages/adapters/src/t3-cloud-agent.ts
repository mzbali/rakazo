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
const launchSchema = z.object({
  threadId: z.string().min(1),
  link: z.string().optional(),
  runId: z.string().nullable(),
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
    if (found) return this.peek(found.threadId, context);
    const project = request.repository
      ? await this.projectFor(request.repository, context)
      : undefined;
    const projectId = project?.id;
    // Scratch threads, and projects without a default, need a model named for them.
    const modelSelection = project?.defaultModelSelection
      ? undefined
      : await this.defaultModel(context);
    const launched = launchSchema.parse(
      await this.call(
        "t3_thread_launch",
        {
          title,
          message: request.prompt,
          clientRequestId: request.idempotencyKey,
          ...(modelSelection ? { modelSelection } : {}),
          ...(projectId
            ? {
                projectId,
                workspaceStrategy: {
                  type: "worktree",
                  baseRef: "origin/HEAD",
                  startFromOrigin: true,
                },
              }
            : { scratch: true }),
        },
        context,
      ),
    );
    return {
      id: launched.threadId,
      url: launched.link ?? "",
      title,
      status: "running",
      ...(launched.runId ? { latestRunId: launched.runId } : {}),
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
      next = page.nextSequence;
      if (!page.hasMore) break;
    }
    let { state } = page!;
    if (state.idle && state.latestRun) {
      // T3 can end a run and queue its continuation (a restart, a delegated result) in separate
      // writes; only a second idle read of the same run says the thread really stopped.
      await new Promise((resolve) => setTimeout(resolve, IDLE_CONFIRM_MS));
      const again = eventsSchema.parse(
        await this.call(
          "t3_thread_events",
          { threadId: id, afterSequence: next, limit: 1 },
          context,
        ),
      ).state;
      if (!again.idle || again.latestRun?.runId !== state.latestRun.runId)
        state = { ...again, idle: false };
    }
    const run = state.latestRun;
    const status: CloudAgentStatus = !state.idle || !run ? "running" : terminalStatus(run.status);
    return {
      id,
      url: state.link,
      title: "",
      status,
      ...(run ? { latestRunId: run.runId } : {}),
      cursor: next,
      attention: state.pendingRequests.map(
        (request): CloudAgentAttention => ({
          requestId: request.requestId,
          kind: request.kind === "user_input" ? "question" : "approval",
          ...(request.threadId !== id ? { threadId: request.threadId } : {}),
        }),
      ),
      historyGap,
    };
  }

  /** The current state without moving the poller's cursor or hold. */
  private async peek(id: string, context: AdapterContext): Promise<CloudAgentSnapshot> {
    // Past the head and without the hold: only `state` is read, and the poller's cursor stays put.
    const {
      cursor: _cursor,
      historyGap: _gap,
      ...snapshot
    } = await this.read(id, context, Number.MAX_SAFE_INTEGER, false);
    return snapshot;
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
        return snapshot;
      }
      return this.peek(id, context);
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

  private async projectFor(repository: string, context: AdapterContext) {
    const wanted = normalizeRepository(repository);
    const { projects } = projectsSchema.parse(
      await this.call("t3_project_list", { limit: 100 }, context),
    );
    const match = projects.find((project) => {
      const identity = project.repositoryIdentity;
      return (
        (identity?.webUrl && normalizeRepository(identity.webUrl) === wanted) ||
        (identity?.canonicalKey && normalizeRepository(identity.canonicalKey) === wanted)
      );
    });
    if (!match) throw new CloudAgentRequestRejected("invalid");
    return match;
  }

  /** One tool call through the connector, so bot assignment, sign-in and outages apply. */
  private async call(
    tool: string,
    args: Record<string, unknown>,
    context: AdapterContext,
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
        throw new CloudAgentRequestRejected("invalid");
      }
    }
    const result = (data ?? {}) as { isError?: boolean; structuredContent?: unknown };
    if (result.isError) {
      const failure = failureSchema.safeParse(result.structuredContent);
      const code = failure.success ? failure.data.code : "";
      if (code === "thread_not_found") throw new CloudAgentRequestRejected("not_found");
      if (code === "orchestration_error" || code === "provider_unavailable")
        throw new CloudAgentRetryLater("unavailable");
      throw new CloudAgentRequestRejected("invalid");
    }
    return result.structuredContent ?? data;
  }
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
