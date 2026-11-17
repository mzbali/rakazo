import * as z from "zod";
import { AgentImportSetupItemSchema } from "./agent-import-setup.js";
import { botSecretDestinationSchema, LoginFieldLabels, OneTimeCodeTarget } from "./bot-secrets.js";
import { Id, ThinkingLevelSchema } from "./ids.js";
import { McpTransportSchema } from "./mcp.js";
import { McpAppCspSchema } from "./mcp-app.js";
import {
  PAGE_TITLE_MAX_LENGTH,
  pageSourceBytes,
  VISUAL_CODE_MAX_BYTES,
  VISUAL_SUMMARY_MAX_LENGTH,
} from "./pages.js";

export const ProductEventType = z.enum([
  "thread.message.created",
  "thread.cleared",
  "thread.message.updated",
  "thread.message.reaction",
  "thread.progress",
  "thread.artifact",
  "thread.ask",
  "thread.choice",
  "thread.meta",
  "thread.computer",
  "thread.subagent",
  "thread.cloud_agent",
  "thread.call.ended",
  "run.started",
  "run.steering.claimed",
  "run.checkpointed",
  "run.waiting_input",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "computer.status",
  "computer.takeover.requested",
  "computer.takeover.granted",
  "computer.takeover.released",
  "computer.command",
  "memory.revised",
  "routine.created",
  "routine.updated",
  "routine.fired",
  "skill.teaching.started",
  "skill.teaching.stopped",
  "skill.draft.created",
  "skill.saved",
  "effect.recorded",
  "agent.tool.called",
  "agent.tool.completed",
  "effect.reconciled",
  "usage.recorded",
  "bot.spawned",
  "bot.updated",
  "bot.archived",
  "bot.deleted",
  "group.created",
  "group.updated",
  "group.handoff",
  /** Liveness only: never persisted, never applied to a snapshot, always seq 0. */
  "heartbeat",
]);
export type ProductEventType = z.infer<typeof ProductEventType>;

export const MessageRole = z.enum(["user", "bot", "system"]);
export const BotMessageIntent = z.enum(["request", "result", "question", "status", "fyi"]);
export type BotMessageIntent = z.infer<typeof BotMessageIntent>;

export const MAX_CHART_DATA_ROWS = 5_000;

const ChartSpec = z.record(z.string(), z.any());

function embeddedChartRowCount(spec: Record<string, unknown>): number {
  const specData = Array.isArray(spec.data) ? spec.data.length : 0;
  const markData = Array.isArray(spec.marks)
    ? spec.marks.reduce((total, mark) => {
        if (!mark || typeof mark !== "object" || !Array.isArray(mark.data)) return total;
        return total + mark.data.length;
      }, 0)
    : 0;
  return specData + markData;
}

const ChartBlock = z
  .object({
    kind: z.literal("chart"),
    name: z.string(),
    /** Declarative Observable Plot spec, validated by render_plot before publish.
        z.any keeps the inferred type JSON-assignable for persistence. */
    spec: ChartSpec,
    data: z.array(z.any()).max(MAX_CHART_DATA_ROWS),
  })
  .superRefine((block, ctx) => {
    if (block.data.length + embeddedChartRowCount(block.spec) <= MAX_CHART_DATA_ROWS) return;
    ctx.addIssue({
      code: "custom",
      message: `Chart data exceeds the ${MAX_CHART_DATA_ROWS.toLocaleString("en-US")}-row limit`,
    });
  });

export const SecretAskPurpose = z.enum(["otp", "password", "api_key"]);
export type SecretAskPurpose = z.infer<typeof SecretAskPurpose>;

/** The settings a bot can change on itself from chat. */
export const BotSettingsValuesSchema = z.object({
  modelProvider: z.string().trim().min(1).max(80).nullable().optional(),
  modelId: z.string().trim().min(1).max(200).nullable().optional(),
  thinkingLevel: ThinkingLevelSchema.nullable().optional(),
  autoSpeak: z.boolean().optional(),
  voiceId: z.string().max(120).nullable().optional(),
});
export type BotSettingsValues = z.infer<typeof BotSettingsValuesSchema>;

/** A payment's order as read from the page: every value is page text, none of it checked. */
export const AskReceipt = z.object({
  /** The pay button's label. */
  button: z.string().max(200).optional(),
  items: z.array(z.object({ name: z.string().max(200), amount: z.string().max(100) })).max(30),
  /** Order lines the card leaves out; `atLeast` when the page may list even more. */
  more: z.object({ count: z.number().int().positive(), atLeast: z.boolean() }).optional(),
  /** What is paid: the amount the button names, or else the page's total. */
  amount: z.string().max(100).optional(),
  amountSource: z.enum(["button", "page"]),
  /** The page's total beside a button that names its own amount. */
  total: z.string().max(100).optional(),
});
export type AskReceipt = z.infer<typeof AskReceipt>;

/** What a cloud-agent job shows: the chat card, and a row in the jobs list. */
const CloudAgentFields = z.object({
  agentId: z.string(),
  title: z.string(),
  status: z.enum(["running", "finished", "failed", "cancelled", "expired"]),
  url: z.string(),
  branch: z.string().optional(),
  prUrl: z.string().optional(),
  latestRunId: z.string().optional(),
  /** Waiting for a free slot; still "running" for clients that predate it. */
  queued: z.boolean().optional(),
  /** An open question or approval; still "running" for clients that predate it. */
  needsInput: z.boolean().optional(),
  /** ISO time since the agent's provider could not be reached; polling resumes when it can. */
  unreachableSince: z.string().optional(),
  /** What was picked to run it and why, as the provider reported starting it. */
  note: z.string().optional(),
  /** The model that runs it, ready to show: a readable name, its effort, and an opaque key for the mark beside it. */
  model: z
    .object({ name: z.string(), effort: z.string().optional(), mark: z.string().optional() })
    .optional(),
  /** ISO time the job was created. */
  startedAt: z.string().optional(),
  /** ISO time the work ended; the elapsed clock stops here. */
  endedAt: z.string().optional(),
  /** ISO time a usage-limit pause ends and the work continues. The job stays running. */
  quotaResetsAt: z.string().optional(),
  /** The latest thing the agent said while it works, clipped. */
  progress: z.string().optional(),
  /** The repository or project the work is for. */
  projectName: z.string().optional(),
  /** A decision the owner has to make before the job can go on. */
  ownerQuestion: z.string().optional(),
  /** The provider's open question with the answers it offers, the recommended one first; the card turns them into buttons. */
  question: z
    .object({
      requestId: z.string(),
      text: z.string().optional(),
      options: z.array(z.object({ label: z.string(), recommended: z.boolean().optional() })),
      /** False when only the offered options may be chosen. */
      allowCustomAnswer: z.boolean().optional(),
    })
    .optional(),
  /** What the owner answered from the card; shown while the job goes on. */
  answered: z.string().optional(),
  /** ISO time the owner last sent the job an instruction from its card. */
  steeredAt: z.string().optional(),
  /** The launch itself was refused, so no remote work ever started and nothing waits on the owner. */
  launchFailed: z.boolean().optional(),
  /** Why the provider refused the launch or ended the work, when it said. */
  failureReason: z.string().optional(),
  /** The pull request's check result; absent when it is not known. */
  checks: z.enum(["passing", "failing", "running"]).optional(),
  /** The pull request's state when it is not open, so the card can say merged or closed. */
  prState: z.enum(["merged", "closed"]).optional(),
  /** The agent is watching its open pull request, so the job is waiting on it, not finished. */
  watching: z.boolean().optional(),
  /** What the job's own thread has going besides its run: subagents, commands, monitors and background tasks. */
  work: z
    .array(
      z.object({
        kind: z.enum(["subagent", "command", "monitor", "background_task"]),
        label: z.string().max(120),
        /** Where a child thread opens in its provider. */
        url: z.string().optional(),
      }),
    )
    .max(20)
    .optional(),
  /** The pull requests on the job's thread, each watched or not. */
  pullRequests: z
    .array(
      z.object({
        url: z.string(),
        number: z.number().int(),
        state: z.enum(["open", "merged", "closed"]),
        watching: z.boolean(),
      }),
    )
    .max(10)
    .optional(),
  /** Screenshots the job's pull request showed, copied to the app's own storage; at most three. */
  proofImages: z
    .array(z.object({ artifactId: z.string(), name: z.string(), mimeType: z.string() }))
    .max(3)
    .optional(),
  /** The job's hidden review: under way, or the verdict it reached. */
  review: z.enum(["checking", "accepted", "rejected", "needs_owner"]).optional(),
  /** Earlier attempts at the same request, oldest first; the card shows only the current one. */
  attempts: z
    .array(
      z.object({
        agentId: z.string(),
        status: z.enum(["running", "finished", "failed", "cancelled", "expired"]),
        failureReason: z.string().optional(),
        startedAt: z.string().optional(),
      }),
    )
    .optional(),
});

/** One job in the jobs list: the card's fields and the chat that holds it. */
export const CloudAgentJobSchema = CloudAgentFields.extend({
  botId: z.string(),
  botName: z.string(),
  threadId: z.string(),
  /** The chat message that holds the job's card, so a link can scroll to it. */
  messageId: z.string().optional(),
  groupId: z.string().optional(),
  groupName: z.string().optional(),
});
export type CloudAgentJob = z.infer<typeof CloudAgentJobSchema>;

/** What opening a job shows beyond its card: the brief it was given and what it reported. */
export const CloudAgentDetailSchema = z.object({
  job: CloudAgentJobSchema,
  brief: z.string().optional(),
  result: z.string().optional(),
});
/** The outcome of an owner's action on a job; `duplicate` means this tap was already accepted. */
export const CloudAgentOwnerActionSchema = z.object({ duplicate: z.boolean() });

export type CloudAgentDetail = z.infer<typeof CloudAgentDetailSchema>;

export const MessageBlock = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({
    kind: z.literal("card"),
    lines: z.array(z.object({ k: z.string(), v: z.string() })),
  }),
  z.object({
    kind: z.literal("ask"),
    text: z.string(),
    approvalEffectId: Id.optional(),
    instructionUpdate: z
      .object({
        botId: Id,
        before: z.string(),
        after: z.string(),
        reason: z.string(),
        undoVersionId: Id.optional(),
      })
      .optional(),
    /** A settings change made from chat; undo writes `before` back while `after` still holds. */
    settingsUpdate: z
      .object({ botId: Id, before: BotSettingsValuesSchema, after: BotSettingsValuesSchema })
      .optional(),
    detail: z.string().optional(),
    detailFormat: z.enum(["text", "code"]).optional(),
    /** On a payment card, the order as the page shows it, drawn as a receipt in place of `detail`. */
    receipt: AskReceipt.optional(),
    input: z.enum(["text", "secret"]).optional(),
    /** Why the secret is needed; drives field label on the masked card. */
    purpose: SecretAskPurpose.optional(),
    // Records what the runtime could produce under either deployment mode, so
    // an ask persisted before an owner toggles the private-HTTP flag still
    // validates on replay.
    credential: botSecretDestinationSchema({ allowPrivateHttpOrigin: true }).optional(),
    /** A texted or emailed code for this site's page; answered once, never saved. */
    oneTimeCode: OneTimeCodeTarget.optional(),
    /** On a login card, the saved login this card replaces and the site it is saved for. */
    replaces: z.object({ id: z.string().max(64), origin: z.string().max(2048) }).optional(),
    /** The fields a login card asks for, by label; absent means DEFAULT_LOGIN_FIELD_LABELS. */
    loginFields: LoginFieldLabels.optional(),
    /** On a login card in a shared Space: the site stays signed in for everyone in it. */
    sharedBrowser: z.literal(true).optional(),
    /** On a fetch approval, the site an "always" answer allows. */
    site: z.string().optional(),
    status: z.enum(["pending", "answered"]).optional(),
    answer: z.string().optional(),
    /** Composer message that durably records this answer; absent on older or card-only replies. */
    answerMessageId: z.string().optional(),
    /** A secret request the user dismissed instead of answering. */
    dismissed: z.literal(true).optional(),
    /** A login the user used for this run only instead of saving it. */
    remembered: z.literal(false).optional(),
    actions: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          outcome: z.enum(["created", "cancelled"]).optional(),
        }),
      )
      .optional(),
  }),
  z.object({
    kind: z.literal("choice"),
    question: z.string(),
    subtitle: z.string().optional(),
    options: z.array(z.object({ id: z.string(), letter: z.string(), label: z.string() })),
    /** Set once the user picks an option; renders the picker as answered. */
    answerId: z.string().optional(),
  }),
  z.object({
    /** Inline app authorization card (Composio-backed): logo, name, one-line
        description, and an Authorize button that flips to connected. */
    kind: z.literal("app_connect"),
    connectorId: z.string().optional(),
    provider: z.string(),
    name: z.string(),
    description: z.string(),
    logo: z.string().nullable(),
    status: z.enum(["pending", "connected"]),
  }),
  z.object({
    kind: z.literal("connect"),
    name: z.string(),
    initial: z.string(),
    color: z.string(),
    status: z.enum(["pending", "connected"]),
  }),
  z.object({
    kind: z.literal("computer"),
    state: z.string(),
    text: z.string(),
  }),
  z.object({
    /** Transcript card left in the thread when the bot hangs up a voice call. */
    kind: z.literal("voice_call"),
    /** Absent when the call had no client nonce to derive an id from. */
    callId: z.string().optional(),
    title: z.string(),
    farewell: z.string(),
    /** Connected time the caller's client measured; absent when the bot hung up. */
    durationSeconds: z.number().int().nonnegative().optional(),
  }),
  z.object({
    /** The bot is calling the user; the card tracks the call from ringing to its outcome. */
    kind: z.literal("call_request"),
    callId: z.string(),
    /** Why the bot is calling, shown on the incoming call. */
    reason: z.string(),
    /** The bot's first spoken sentence once the user answers. */
    opening: z.string(),
    status: z.enum(["ringing", "answered", "declined", "missed"]),
    expiresAt: z.string(),
    /** Connected time the user's client measured after answering. */
    durationSeconds: z.number().int().nonnegative().optional(),
  }),
  z.object({ kind: z.literal("meta"), text: z.string() }),
  /**
   * Marks a user message as what woke the bot (a webhook, an email, a chat message). Its text
   * block is the bot's full prompt, so chats, previews and search leave the message out.
   */
  z.object({ kind: z.literal("delivery") }),
  z.object({
    kind: z.literal("progress"),
    text: z.string(),
    /** Provider-generated tool status rather than assistant-authored narration. */
    activity: z.literal(true).optional(),
    pendingToolNames: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal("steps"),
    steps: z.array(
      z.object({
        label: z.string(),
        count: z.number().int().positive(),
        /** What the bot wrote just before this step, kept out of its reply. */
        note: z.string().optional(),
        /** How many of this step's calls succeeded, failed, or were stopped before finishing. */
        outcomes: z
          .object({
            succeeded: z.number().int().positive().optional(),
            failed: z.number().int().positive().optional(),
            stopped: z.number().int().positive().optional(),
          })
          .optional(),
      }),
    ),
    durationMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("subagent"),
    agentId: z.string(),
    name: z.string(),
    task: z.string(),
    status: z.enum(["running", "completed", "failed"]),
    progress: z.string().optional(),
    result: z.string().optional(),
  }),
  z.object({
    kind: z.literal("child_bot"),
    botId: z.string(),
    name: z.string(),
    status: z.enum(["created", "archived", "deleted"]),
  }),
  CloudAgentFields.extend({ kind: z.literal("cloud_agent") }),
  z.object({
    kind: z.literal("skill_draft"),
    skillId: Id,
    name: z.string(),
    goal: z.string(),
    playbook: z.object({
      whenToUse: z.string(),
      inputs: z.array(z.string()),
      steps: z.array(z.string()),
      howToCheck: z.string(),
      whatToReturn: z.string(),
      approvalBoundaries: z.string(),
      failureHandling: z.string(),
    }),
    status: z.enum(["draft", "saved"]),
  }),
  ChartBlock,
  z.object({
    /** Approval card for an agent-created MCP server. The user completes the
        OAuth popup (or confirms no authorization is needed) in the UI. The
        status persists so the card renders its decision after a remount. */
    kind: z.literal("mcp_approval"),
    name: z.string(),
    serverId: Id,
    transport: McpTransportSchema,
    endpoint: z.string().nullable(),
    needsOAuth: z.boolean(),
    status: z.enum(["pending", "connected", "dismissed"]).default("pending"),
  }),
  z.object({
    kind: z.literal("import_setup"),
    items: z.array(AgentImportSetupItemSchema),
    /** Set on checklists an earlier Undo retired, with `items` emptied; it is then hidden. */
    undone: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("image"),
    /** Explicit visual input requested by a confirmation-aware client. */
    imageHandling: z.literal("confirm").optional(),
    artifactId: Id,
    mimeType: z.string(),
    name: z.string(),
    /** The page a saved web image came from. Absent for an upload. */
    source: z
      .object({
        url: z.string().min(1).max(2048),
        site: z.string().min(1).max(40),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal("file"),
    artifactId: Id,
    mimeType: z.string(),
    name: z.string(),
    size: z.number().int().nonnegative(),
  }),
  z.object({
    /**
     * An MCP server's app showing one tool call. The app's HTML is a hidden artifact; the
     * arguments and result are what its view receives, the result as the bot got it (credentials
     * redacted).
     */
    kind: z.literal("app"),
    artifactId: Id,
    server: z.string().max(200),
    tool: z.string().max(200),
    toolArguments: z.record(z.string(), z.any()),
    toolResult: z.record(z.string(), z.any()),
    csp: McpAppCspSchema.optional(),
    prefersBorder: z.boolean().optional(),
  }),
  z.object({
    /**
     * A visual the bot drew in the chat with the page kit, without saving a page. `code` is the
     * compiled viewer code; `text` is its plain summary, which clients that cannot draw it show.
     */
    kind: z.literal("visual"),
    title: z.string().max(PAGE_TITLE_MAX_LENGTH),
    text: z.string().max(VISUAL_SUMMARY_MAX_LENGTH),
    code: z
      .string()
      .max(VISUAL_CODE_MAX_BYTES, { abort: true })
      .refine((code) => pageSourceBytes(code) <= VISUAL_CODE_MAX_BYTES),
  }),
  z.object({
    /** A page the bot saved. Title and version are as sent; read the page for its latest. */
    kind: z.literal("page"),
    pageId: Id,
    version: z.number().int().positive(),
    title: z.string().max(PAGE_TITLE_MAX_LENGTH),
  }),
  z.object({
    kind: z.literal("handoff"),
    fromBotId: Id,
    toBotId: Id,
    text: z.string(),
    /** Links ownership transfers in one user-started group turn. */
    hop: z.number().int().positive().optional(),
  }),
  z.object({
    /** A group-chat message delivered into a member bot's own thread. */
    kind: z.literal("channel_message"),
    provider: z.string(),
    /** Per-message network when a provider spans multiple transports. */
    transport: z.string().optional(),
    channelId: Id,
    fromAddress: z.string(),
    fromLabel: z.string(),
    text: z.string(),
    hop: z.number().int().nonnegative().optional(),
  }),
  z.object({
    /** Shown in the sending bot's own chat, so the user can see what it sent. */
    kind: z.literal("bot_message_sent"),
    toBotId: Id,
    toBotName: z.string(),
    text: z.string(),
    intent: BotMessageIntent.optional(),
  }),
  z.object({
    /** Delivered into the receiving bot's own chat as the prompt that woke it. */
    kind: z.literal("bot_message_received"),
    fromBotId: Id,
    fromBotName: z.string(),
    text: z.string(),
    intent: BotMessageIntent.optional(),
    /** Sender-thread echo this delivery answers, when applicable. */
    returnToMessageId: Id.optional(),
    /** Links in a bot-started chain; absent when a person started it. */
    hop: z.number().int().nonnegative().optional(),
  }),
  z.object({
    /**
     * Pages this reply cited. The links stay in the text; this is the list a citation pill and
     * the sources row open. Absent when the reply cited nothing.
     */
    kind: z.literal("sources"),
    items: z
      .array(
        z.object({
          url: z.string().min(1).max(2048),
          title: z.string().max(300),
          site: z.string().min(1).max(40),
        }),
      )
      .min(1)
      .max(12),
  }),
]);
export type MessageBlock = z.infer<typeof MessageBlock>;

/** One call a reply kept for the bot's later turns: what it was sent and what came back. */
export const ToolStepCallSchema = z.object({
  /** The call's arguments as JSON. */
  arguments: z.string().optional(),
  result: z.string().optional(),
  /** The screenshot the call returned, kept as a hidden artifact runs read. */
  image: z.object({ artifactId: z.string() }).optional(),
  /** The call ended in an error; its result is that error. */
  failed: z.literal(true).optional(),
});
export type ToolStepCall = z.infer<typeof ToolStepCallSchema>;

/**
 * What a bot reply's tool calls were sent and returned, for its later runs to replay. Stored
 * encrypted beside the message, never in its blocks, so clients never receive it. One entry per
 * step of the message's steps blocks, in order; null for a step whose calls were not all kept.
 */
export const ToolHistorySchema = z.object({
  steps: z.array(z.object({ tool: z.string(), calls: z.array(ToolStepCallSchema) }).nullable()),
});
export type ToolHistory = z.infer<typeof ToolHistorySchema>;
/** A step as a run replays it: what the UI shows, with its tool and kept calls when it has them. */
export type HistoryToolStep = Extract<MessageBlock, { kind: "steps" }>["steps"][number] & {
  tool?: string;
  calls?: ToolStepCall[];
};

/**
 * Something the bot did on its computer, shown in the terminal's Activity view: a shell
 * command (with a redacted output tail) or a file/app action, whose `command` is the path or
 * app name.
 */
export const COMPUTER_COMMAND_OUTPUT_MAX_CHARS = 16_000;
export const ComputerCommandKind = z.enum([
  "shell",
  "write_file",
  "attach_file",
  "open_path",
  "launch_app",
]);
export type ComputerCommandKind = z.infer<typeof ComputerCommandKind>;
export const ComputerCommandSchema = z.object({
  executionId: z.string(),
  kind: ComputerCommandKind,
  command: z.string(),
  cwd: z.string(),
  status: z.enum(["running", "done"]),
  exitCode: z.number().int().nullable(),
  output: z.string(),
  /** Size written by write_file. */
  bytes: z.number().int().nonnegative().optional(),
});
export type ComputerCommand = z.infer<typeof ComputerCommandSchema>;

/**
 * Collapse running/done events into one entry per command, in start order. A finished
 * command stays finished, so history and live events can be merged in either order.
 */
export function foldComputerCommands<T extends ComputerCommand>(events: T[]): T[] {
  const byId = new Map<string, T>();
  for (const event of events) {
    if (byId.get(event.executionId)?.status === "done" && event.status === "running") continue;
    byId.set(event.executionId, event);
  }
  return [...byId.values()];
}

/** Coarse live run state. Never accepts provider reasoning content or partial messages. */
export const ThreadActivityPayloadSchema = z
  .object({
    activity: z.object({ thinking: z.boolean() }).strict(),
  })
  .strict();

/** Distinguish this live lifecycle subtype from unrelated thread metadata. */
export function hasThinkingActivityMarker(payload: Record<string, unknown>): payload is {
  activity: { thinking: unknown };
} {
  const activity = payload.activity;
  return activity !== null && typeof activity === "object" && "thinking" in activity;
}

export const ProductEventSchema = z
  .object({
    id: Id,
    spaceId: Id,
    threadId: Id,
    botId: Id,
    seq: z.number().int().nonnegative(),
    type: ProductEventType,
    runId: Id.optional(),
    createdAt: z.string(),
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((event, ctx) => {
    if (event.type !== "thread.meta" || !hasThinkingActivityMarker(event.payload)) return;
    if (!event.runId || !ThreadActivityPayloadSchema.safeParse(event.payload).success) {
      ctx.addIssue({ code: "custom", path: ["payload"], message: "Invalid run activity" });
    }
  });
export type ProductEvent = z.infer<typeof ProductEventSchema>;

/** The person who wrote a user message, when known. */
export const MessageAuthorSchema = z.object({ id: Id, name: z.string() });
export type MessageAuthor = z.infer<typeof MessageAuthorSchema>;

export const ReplyPreviewSchema = z.object({
  role: MessageRole,
  /** The parent is a page card. */
  page: z.literal(true).optional(),
  botId: Id.optional(),
  author: MessageAuthorSchema.optional(),
  text: z.string(),
  attachment: z
    .object({
      kind: z.enum(["image", "file"]),
      artifactId: Id,
      mimeType: z.string(),
      name: z.string(),
    })
    .optional(),
});
export type ReplyPreview = z.infer<typeof ReplyPreviewSchema>;

export const ThreadMessageSchema = z.object({
  id: Id,
  threadId: Id,
  seq: z.number().int().nonnegative(),
  role: MessageRole,
  blocks: z.array(MessageBlock),
  botId: Id.optional(),
  author: MessageAuthorSchema.optional(),
  replyToMessageId: Id.optional(),
  replyQuote: z.string().optional(),
  replyPreview: ReplyPreviewSchema.nullable().optional(),
  runId: Id.optional(),
  /** Set when the message was sent from a live voice call; groups one call's transcript. */
  callId: z.string().optional(),
  createdAt: z.string(),
});
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

export function canReactToThreadMessage(message: Pick<ThreadMessage, "id" | "blocks">): boolean {
  return (
    !message.id.startsWith("progress:") &&
    !message.id.startsWith("subagent:") &&
    !message.blocks.some((block) => block.kind === "channel_message")
  );
}
