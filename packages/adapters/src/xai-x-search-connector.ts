import type {
  AdapterContext,
  ConnectorCall,
  ConnectorEvent,
  ConnectorProvider,
  ConnectorTool,
  SecretStore,
} from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { findModelCredential } from "@rakazo/db";
import { combineSignals } from "./connector-safety.js";
import { resolveStoredModelAuth } from "./model-credential-refresh.js";

const CONNECTOR_ID = "xai-x-search";
const TOOL_NAME = "x_search";
const PROVIDER = "xai";
const ENDPOINT = "https://api.x.ai/v1/responses";
// xAI runs the search itself; the model only reads the posts and writes the summary.
const MODEL = "grok-4.3";
const TIMEOUT_MS = 120_000;
const MAX_ANSWER_CHARS = 12_000;
const MAX_POSTS = 25;
const MAX_HANDLES = 10;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Without this the model may answer from memory instead of searching.
const INSTRUCTIONS =
  "Answer only from posts you find with x_search; always search first. Link every post you mention.";

const TOOL: ConnectorTool = {
  name: TOOL_NAME,
  description:
    "Search recent posts on X. Returns a short summary and the links of the posts it used. Read-only.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to find on X." },
      handles: {
        type: "array",
        items: { type: "string" },
        maxItems: MAX_HANDLES,
        description: "Only posts from these accounts, without @.",
      },
      excludeHandles: {
        type: "array",
        items: { type: "string" },
        maxItems: MAX_HANDLES,
        description: "Leave out posts from these accounts, without @.",
      },
      fromDate: { type: "string", description: "Earliest post date, YYYY-MM-DD." },
      toDate: { type: "string", description: "Latest post date, YYYY-MM-DD." },
    },
    required: ["query"],
  },
  readOnly: true,
  label: "Search X",
  route: { connectorId: CONNECTOR_ID, toolName: TOOL_NAME },
};

export type XaiXSearchDeps = {
  prisma: Pick<
    PrismaClient,
    "$transaction" | "secret" | "userModelCredential" | "userModelPreference"
  >;
  secrets: Pick<SecretStore, "load" | "put" | "delete">;
  fetch?: typeof fetch;
};

/** X search through the xAI connection a person already uses for models; offered only with one. */
export class XaiXSearchConnector implements ConnectorProvider {
  constructor(private readonly deps: XaiXSearchDeps) {}

  describe() {
    return {
      id: CONNECTOR_ID,
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { discover: true, oauth: false, secretsBrokered: true },
    };
  }

  async discoverTools(context: AdapterContext): Promise<ConnectorTool[]> {
    const credential = await findModelCredential(this.deps.prisma, context, PROVIDER);
    return credential ? [TOOL] : [];
  }

  async *execute(call: ConnectorCall, context: AdapterContext): AsyncIterable<ConnectorEvent> {
    if (call.tool !== TOOL_NAME) {
      yield { type: "error", message: `unknown tool ${call.tool}` };
      return;
    }
    const search = xSearchOptions(call.args);
    if ("error" in search) {
      yield { type: "error", message: search.error };
      return;
    }
    const apiKey = await this.apiKey(context).catch(() => undefined);
    if (!apiKey) {
      yield {
        type: "error",
        message: "X search needs a working xAI connection. Reconnect it in model settings.",
      };
      return;
    }
    let response: Response;
    try {
      response = await (this.deps.fetch ?? fetch)(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          instructions: INSTRUCTIONS,
          input: xSearchInput(search),
          tools: [{ type: "x_search", ...search.filters }],
          store: false,
        }),
        signal: combineSignals(context.signal, AbortSignal.timeout(TIMEOUT_MS)),
      });
    } catch {
      yield { type: "error", message: "X search could not reach xAI or timed out. Try again." };
      return;
    }
    if (response.status === 401 || response.status === 403) {
      yield {
        type: "error",
        message: "xAI refused the connection. Reconnect it in model settings.",
      };
      return;
    }
    if (!response.ok) {
      yield { type: "error", message: `X search failed (HTTP ${response.status}).` };
      return;
    }
    const body = (await response.json().catch(() => undefined)) as unknown;
    yield { type: "result", data: xSearchResult(body) };
  }

  private async apiKey(context: AdapterContext): Promise<string | undefined> {
    const { prisma, secrets } = this.deps;
    const scope = { userId: context.userId, spaceId: context.spaceId };
    const credential = await findModelCredential(prisma, scope, PROVIDER);
    if (!credential) return undefined;
    const secret = await prisma.secret.findFirst({
      where: { id: credential.secretId, userId: scope.userId, spaceId: null },
      select: { id: true, ciphertext: true },
    });
    if (!secret) return undefined;
    const plaintext = await secrets.load(secret.ciphertext, secret.id);
    // Refreshes under the shared lock, so a rotated token is never spent twice.
    const auth = await resolveStoredModelAuth(
      prisma,
      secrets,
      scope,
      credential,
      plaintext,
      PROVIDER,
      {
        signal: context.signal,
      },
    );
    return auth.apiKey;
  }
}

type XSearchFilters = {
  allowed_x_handles?: string[];
  excluded_x_handles?: string[];
  from_date?: string;
  to_date?: string;
};

function xSearchOptions(
  args: Record<string, unknown>,
): { query: string; filters: XSearchFilters } | { error: string } {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { error: "query is required" };
  const handles = handleList(args.handles);
  const excluded = handleList(args.excludeHandles);
  if (handles === null || excluded === null) {
    return { error: `handles must be at most ${MAX_HANDLES} X usernames` };
  }
  if (handles.length && excluded.length) {
    return { error: "Use handles or excludeHandles, not both." };
  }
  const filters: XSearchFilters = {};
  if (handles.length) filters.allowed_x_handles = handles;
  if (excluded.length) filters.excluded_x_handles = excluded;
  for (const [arg, key] of [
    ["fromDate", "from_date"],
    ["toDate", "to_date"],
  ] as const) {
    const value = args[arg];
    if (value === undefined || value === "") continue;
    if (typeof value !== "string" || !DATE.test(value))
      return { error: `${arg} must be YYYY-MM-DD` };
    filters[key] = value;
  }
  return { query, filters };
}

/** The model never sees the tool's filters, so the question repeats them. */
function xSearchInput({ query, filters }: { query: string; filters: XSearchFilters }): string {
  const handles = (list: string[]) => list.map((handle) => `@${handle}`).join(", ");
  const scope = [
    filters.allowed_x_handles && `only posts from ${handles(filters.allowed_x_handles)}`,
    filters.excluded_x_handles && `no posts from ${handles(filters.excluded_x_handles)}`,
    filters.from_date && `dated from ${filters.from_date}`,
    filters.to_date && `dated up to ${filters.to_date}`,
  ].filter(Boolean);
  return scope.length ? `${query}\n\nSearch ${scope.join(", ")}.` : query;
}

/** Usernames without @; null when the list is too long or a name is not a valid one. */
function handleList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_HANDLES) return null;
  const handles = value.map((item) =>
    typeof item === "string" ? item.trim().replace(/^@/, "") : "",
  );
  return handles.every((handle) => HANDLE.test(handle)) ? handles : null;
}

function xSearchResult(body: unknown) {
  const record = isRecord(body) ? body : {};
  const output = Array.isArray(record.output) ? record.output.filter(isRecord) : [];
  const parts = output.flatMap((item) =>
    item.type === "message" && Array.isArray(item.content) ? item.content.filter(isRecord) : [],
  );
  const answer = parts
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
    .trim();
  const urls = [
    ...(Array.isArray(record.citations) ? record.citations : []),
    ...parts.flatMap((part) =>
      Array.isArray(part.annotations)
        ? part.annotations.filter(isRecord).map((annotation) => annotation.url)
        : [],
    ),
  ];
  const posts = [...new Set(urls.filter(isXUrl))].slice(0, MAX_POSTS);
  const usage = isRecord(record.usage) ? record.usage.server_side_tool_usage_details : undefined;
  const xSearchCalls =
    isRecord(usage) && typeof usage.x_search_calls === "number" ? usage.x_search_calls : 0;
  return {
    answer: answer.slice(0, MAX_ANSWER_CHARS) || "X search found nothing to report.",
    posts,
    xSearchCalls,
  };
}

function isXUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && (url.hostname === "x.com" || url.hostname === "twitter.com")
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
