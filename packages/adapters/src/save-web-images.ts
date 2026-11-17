import { ARTIFACT_NAME_MAX_LENGTH } from "@rakazo/contracts";
import { embedLine, messageBlockForArtifact } from "@rakazo/core";
import { citationSiteLabel } from "@rakazo/core/answer-sources";
import { normalizedHttpUrl } from "@rakazo/core/egress";
import { getLogger } from "@rakazo/logging";
import type { RunContext } from "./run-context.js";
import { persistMessageInTransaction, runLeaseFor } from "./run-messages.js";
import type { ToolCall } from "./run-tool-gate.js";
import { attachWorkspaceFileToThread } from "./thread-artifacts.js";
import type { ResolveHostname } from "./web-ssrf.js";
import { fetchSafeWebBytes } from "./web-ssrf.js";

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_FIRST =
  "Fetch the page with web_fetch first. save_web_images only saves an image URL that fetch returned.";
const NOT_AN_IMAGE = "Only PNG, JPEG, WebP and GIF images can be saved.";
const SVG = "SVG images are not saved.";

type ImagePageSource = { url: string; site: string };

type SavedImage = {
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
  caption: string;
  source?: ImagePageSource;
};

export type SaveWebImagesDeps = {
  /** Image URLs a fetch named. `get` is the page, when the caller remembered one. */
  trustedUrls: { has(url: string): boolean; get?(url: string): string | undefined };
  /** False when the outbound site gate would not allow the fetch. */
  siteAllowed: (url: string) => boolean;
  fetch?: typeof globalThis.fetch;
  resolveHostname?: ResolveHostname;
  save: (image: SavedImage) => Promise<{ artifactId: string }>;
};

type ImageResult = { embed: string } | { error: string };

const SIGNATURES: Record<string, { extension: string; matches: (bytes: Uint8Array) => boolean }> = {
  "image/png": {
    extension: "png",
    matches: (bytes) =>
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47,
  },
  "image/jpeg": {
    extension: "jpg",
    matches: (bytes) =>
      bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  "image/webp": {
    extension: "webp",
    matches: (bytes) =>
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50,
  },
  "image/gif": {
    extension: "gif",
    matches: (bytes) =>
      bytes.length >= 6 &&
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38 &&
      (bytes[4] === 0x37 || bytes[4] === 0x39) &&
      bytes[5] === 0x61,
  },
};

function mediaType(contentType: string | null): string {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function imageKind(
  contentType: string | null,
  bytes: Uint8Array,
): SavedImage["extension"] | string {
  const type = mediaType(contentType);
  if (type === "image/svg+xml") return SVG;
  const signature = SIGNATURES[type];
  if (!signature?.matches(bytes)) return NOT_AN_IMAGE;
  return signature.extension;
}

const SOURCE_URL_MAX = 2048;

/** The page label under a saved image. An upload, or a page with no site name, has none. */
function imageSource(pageUrl: string | undefined): ImagePageSource | undefined {
  if (!pageUrl || pageUrl.length > SOURCE_URL_MAX) return undefined;
  const site = citationSiteLabel(pageUrl);
  if (!site) return undefined;
  return { url: pageUrl, site };
}

function captionOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const caption = value.replace(/\s+/g, " ").trim();
  if (!caption) return undefined;
  return caption.slice(0, ARTIFACT_NAME_MAX_LENGTH);
}

/** Save images a fetched page named. Anything else is refused before a request is made. */
export async function saveWebImages(
  args: Record<string, unknown>,
  deps: SaveWebImagesDeps,
): Promise<{ error: string } | { images: ImageResult[] }> {
  const images = args.images;
  if (!Array.isArray(images)) return { error: "images must be a list of {url, caption}." };
  if (images.length === 0) return { error: "Pass at least one image." };
  if (images.length > MAX_IMAGES) return { error: "Save at most 6 images at a time." };
  const saved: ImageResult[] = [];
  for (const entry of images) {
    saved.push(await saveOne(entry, deps));
  }
  return { images: saved };
}

async function saveOne(entry: unknown, deps: SaveWebImagesDeps): Promise<ImageResult> {
  if (!entry || typeof entry !== "object")
    return { error: "Each image needs a url and a caption." };
  const record = entry as Record<string, unknown>;
  const url = typeof record.url === "string" ? normalizedHttpUrl(record.url) : undefined;
  if (!url?.startsWith("https://") || !deps.trustedUrls.has(url)) return { error: FETCH_FIRST };
  const caption = captionOf(record.caption);
  if (!caption) return { error: "caption is required" };
  if (!deps.siteAllowed(url)) {
    return { error: "That site is not approved for this run, so its image was not fetched." };
  }
  let fetched: { body: Uint8Array; contentType: string | null };
  try {
    fetched = await fetchSafeWebBytes(url, {
      fetch: deps.fetch,
      resolveHostname: deps.resolveHostname,
      maxBytes: MAX_IMAGE_BYTES,
      truncate: false,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not fetch the image." };
  }
  const kind = imageKind(fetched.contentType, fetched.body);
  if (kind === SVG || kind === NOT_AN_IMAGE) return { error: kind };
  const source = imageSource(deps.trustedUrls.get?.(url));
  const stored = await deps.save({
    bytes: fetched.body,
    mimeType: mediaType(fetched.contentType),
    extension: kind,
    caption,
    ...(source ? { source } : {}),
  });
  return { embed: embedLine("image", caption, stored.artifactId) };
}

/** Store one fetched image and post it as its own message, so the reply can fold it on its own. */
export async function postSavedWebImage(
  ctx: RunContext,
  call: ToolCall,
  image: SavedImage,
): Promise<{ artifactId: string }> {
  const { deps, run, bot, thread } = ctx;
  if (!deps.artifacts) throw new Error("Image storage is not configured.");
  const lease = runLeaseFor(deps, run.id);
  let committed: Awaited<ReturnType<typeof persistMessageInTransaction>> | undefined;
  const saved = await attachWorkspaceFileToThread(
    {
      prisma: deps.prisma,
      artifacts: deps.artifacts,
      maxUploadSizeBytes: deps.maxUploadSizeBytes,
    },
    {
      spaceId: run.spaceId,
      userId: run.userId,
      botId: bot.id,
      groupId: thread.groupId ?? undefined,
      runId: run.id,
      filePath: `web-image.${image.extension}`,
      bytes: image.bytes,
      operationId: call.executionId,
      name: image.caption,
      onAttached: async (tx, artifact) => {
        const block = messageBlockForArtifact(artifact);
        committed = await persistMessageInTransaction(
          tx,
          run,
          "bot",
          [block.kind === "image" && image.source ? { ...block, source: image.source } : block],
          run.trigger === "bot_message" ? false : undefined,
          undefined,
          false,
          lease,
        );
      },
    },
  );
  if (!committed) throw new Error("The image was stored but not posted.");
  await deps.events
    .notify(run.threadId, committed.eventSeq, committed.firstResponseRunId)
    .catch((error) => getLogger().error("thread message realtime notification", error));
  return { artifactId: saved.artifactId };
}
