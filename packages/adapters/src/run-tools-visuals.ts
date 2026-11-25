import type { MessageBlock } from "@rakazo/contracts";
import {
  PageTitleSchema,
  pageSourceBytes,
  storedImageMimeType,
  VISUAL_CODE_MAX_BYTES,
  VISUAL_IMAGE_ALT_MAX_LENGTH,
  VISUAL_IMAGE_MAX_COUNT,
  VISUAL_SUMMARY_MAX_LENGTH,
} from "@rakazo/contracts";
import type { VisualImageArg } from "@rakazo/core";
import {
  containsSecret,
  embedLine,
  isBackgroundRunTrigger,
  outboundSiteGate,
  visualImageArgs,
} from "@rakazo/core";
import { normalizedHttpUrl, urlSite } from "@rakazo/core/egress";
import { bestEffort } from "@rakazo/logging";
import { checkPageSource, VISUAL_GUIDE, visualImageReferences } from "@rakazo/page-kit/validate";
import type { RunContext } from "./runs/assembly/run-context.js";
import { isRunTainted } from "./runs/assembly/run-context.js";
import { publishMessage } from "./runs/assembly/run-messages.js";
import { VISUAL_ESSENTIALS } from "./runs/assembly/show-visual.prompt.js";
import type { ToolCall, ToolHandlers } from "./runs/tools/run-tool-gate.js";
import { storeVisualImage, VISUAL_IMAGE_ARTIFACT_ID_LENGTH } from "./storage/thread-artifacts.js";
import { encodeVisualImage, fetchVisualImage } from "./web/visual-image.js";

/** The summary is one paragraph of plain text: every run of whitespace folds into a space. */
function summaryText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const summary = value.replace(/\s+/g, " ").trim();
  return summary && summary.length <= VISUAL_SUMMARY_MAX_LENGTH ? summary : null;
}

type CarriedImage = {
  /** A fetched picture's place in images, or the saved artifact id it was copied from. */
  place: number | string;
  id: string;
  alt: string;
  size: number;
  discard: () => Promise<void>;
};

/** Apply the run’s outbound policy before each request, including redirected requests. */
async function imageUrlGate(ctx: RunContext) {
  const [tainted, rules, trustedSites] = await Promise.all([
    isRunTainted(ctx),
    ctx.trust.loadApprovalRules(),
    ctx.trust.loadTrustedSites(),
  ]);
  return (rawUrl: string) => {
    const url = normalizedHttpUrl(rawUrl);
    const site = url && urlSite(url);
    if (!url || !site || containsSecret([rawUrl, url], ctx.secrets)) return false;
    const trusted =
      !tainted ||
      ctx.trust.searchResultUrls.has(url) ||
      ctx.trust.pageImageUrls.has(url) ||
      trustedSites.has(site);
    return outboundSiteGate({ site, trusted, rules }) === "allow";
  };
}

function visualImageOwner(ctx: RunContext, call: ToolCall) {
  return {
    spaceId: ctx.run.spaceId,
    userId: ctx.run.userId,
    botId: ctx.bot.id,
    groupId: ctx.thread.groupId ?? undefined,
    runId: ctx.runId,
    operationId: call.executionId,
  };
}

/**
 * Copy each picture the chat already holds (image:<id>, from save_web_images or an attachment)
 * into a visual-owned picture. The id must be an image this chat could already show: in this group, or for a private chat this bot's and this user's; it is
 * re-encoded like a fetched one, so what the visual keeps is a small WebP of the same size limits.
 */
async function carrySavedImages(
  ctx: RunContext,
  call: ToolCall,
  ids: string[],
  carried: CarriedImage[],
): Promise<string | undefined> {
  if (ids.length === 0) return;
  const artifacts = ctx.deps.artifacts;
  if (!artifacts)
    return "Image storage is not configured, so the visual was not shown. Call without images.";
  if (isBackgroundRunTrigger(ctx.run.trigger))
    return "A background run's visual is never shown, so its pictures are not copied. Call without images.";
  const rows = await ctx.deps.prisma.artifact.findMany({
    where: { id: { in: ids }, spaceId: ctx.run.spaceId },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const sourceBytes = [];
  for (const id of ids) {
    const row = byId.get(id);
    // A group chat's picture belongs to that group; a private chat's to this bot and this user.
    const here =
      row &&
      (ctx.thread.groupId
        ? row.groupId === ctx.thread.groupId
        : row.groupId === null && row.botId === ctx.bot.id && row.userId === ctx.run.userId);
    if (!row || !here || !storedImageMimeType(row.mimeType) || row.mimeType.includes(";")) {
      return `image:${id} is not an image saved in this chat; nothing was shown. Use an image:<id> from save_web_images or an image attached here, or pass its url in images.`;
    }
    const bytes = await artifacts.get(row.storageKey, ctx.context);
    const resolved = await encodeVisualImage(bytes);
    if (!resolved) {
      return `image:${id} is not a usable picture; nothing was shown. Drop it and call again.`;
    }
    sourceBytes.push({ id, alt: row.name, bytes: resolved.bytes });
  }
  const owner = visualImageOwner(ctx, call);
  const stored = await Promise.allSettled(
    sourceBytes.map(async ({ id, alt, bytes }) => ({
      place: id,
      alt: alt.slice(0, VISUAL_IMAGE_ALT_MAX_LENGTH),
      ...(await storeVisualImage({ prisma: ctx.deps.prisma, artifacts }, owner, { bytes })),
      size: bytes.byteLength,
    })),
  );
  for (const result of stored) {
    if (result.status === "fulfilled") carried.push(result.value);
  }
  const failed = stored.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}

/**
 * Fetch, check and store each picture the visual names. One that cannot load fails the whole
 * call, naming the picture: nothing is ever shown with a picture silently dropped.
 */
async function carryImages(
  ctx: RunContext,
  call: ToolCall,
  places: number[],
  images: VisualImageArg[],
  carried: CarriedImage[],
): Promise<string | undefined> {
  if (places.length === 0) return;
  const artifacts = ctx.deps.artifacts;
  if (!artifacts)
    return "Image storage is not configured, so the visual was not shown. Call without images.";
  if (isBackgroundRunTrigger(ctx.run.trigger))
    return "A background run's visual is never shown, so its pictures are not fetched. Call without images.";
  const wanted = places.map((place) => images[place - 1]!);
  const allowUrl = await imageUrlGate(ctx);
  const fetched = await Promise.allSettled(
    wanted.map(async (image) => {
      if (!allowUrl(image.url)) throw new Error("the destination is not approved for this run");
      return fetchVisualImage(image.url, { allowUrl, signal: ctx.context.signal });
    }),
  );
  const owner = visualImageOwner(ctx, call);
  const ready = [];
  for (const [index, result] of fetched.entries()) {
    const { place, alt } = wanted[index]!;
    if (result.status === "rejected") {
      const error =
        result.reason instanceof Error ? result.reason.message : "the picture could not be fetched";
      return `rakazo-image:${place} could not be shown: ${error}. Nothing was shown. Drop that picture or try another URL, then call again.`;
    }
    ready.push({ place, alt, bytes: result.value.bytes });
  }
  const stored = await Promise.allSettled(
    ready.map(async ({ place, alt, bytes }) => ({
      place,
      alt,
      ...(await storeVisualImage({ prisma: ctx.deps.prisma, artifacts }, owner, { bytes })),
      size: bytes.byteLength,
    })),
  );
  for (const result of stored) {
    if (result.status === "fulfilled") carried.push(result.value);
  }
  const failed = stored.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}

/**
 * Draws page-kit JSX in the chat as its own message, without saving a page.
 * The reply places the returned embed where the visual belongs.
 * The source goes through the page check, and the compiled code must stay small because it
 * travels inside the message; pictures the source names by their place in images are fetched,
 * checked and stored, and the code that ships names them by id instead.
 */
async function showVisual(ctx: RunContext, call: ToolCall) {
  const { args } = call;
  if (args.help === true) return { guide: VISUAL_GUIDE };
  const title = PageTitleSchema.safeParse(args.title);
  if (!title.success) return { error: "title must be 1 to 200 characters." };
  const summary = summaryText(args.summary);
  if (!summary) {
    return {
      error: `summary must be plain text of 1 to ${VISUAL_SUMMARY_MAX_LENGTH} characters.`,
    };
  }
  if (typeof args.source !== "string" || !args.source.trim()) {
    return { error: "source must be the visual as JSX.", patterns: VISUAL_ESSENTIALS };
  }
  const source = args.source;
  const check = checkPageSource(source);
  if (!check.ok) {
    return {
      error:
        "The visual has problems; nothing was shown. Follow patterns and call again with source.",
      problems: check.errors,
      patterns: VISUAL_ESSENTIALS,
    };
  }
  const { code } = check;
  const bytes = pageSourceBytes(code);
  if (bytes > VISUAL_CODE_MAX_BYTES) {
    return {
      error: `The visual is ${bytes} bytes compiled; the limit is ${VISUAL_CODE_MAX_BYTES}. Show less, or build a page with save_page.`,
    };
  }
  const images = visualImageArgs(args.images);
  if (typeof images === "string") return { error: images };
  const { places, saved, unsupported, malformed, replace } = visualImageReferences(code);
  if (malformed) {
    return {
      error: "A picture src must be rakazo-image:<its 1-based place in images>.",
    };
  }
  if (unsupported.length > 0) {
    return {
      error: `The viewer cannot load ${unsupported.map((source) => `"${source}"`).join(", ")}; nothing was shown. A picture src is rakazo-image:<n> for a url in images, image:<id> for a picture saved in this chat, or a data: URI. Fix it and call again.`,
    };
  }
  if (places.length + saved.length > VISUAL_IMAGE_MAX_COUNT) {
    return { error: `Show at most ${VISUAL_IMAGE_MAX_COUNT} pictures per visual.` };
  }
  const outOfList = places.find((place) => place < 1 || place > images.length);
  if (outOfList !== undefined) {
    return {
      error: `The source uses rakazo-image:${outOfList}, which images does not have (it lists ${images.length}). Number pictures from 1, in the order of images.`,
    };
  }
  if (images.length > 0 && places.length === 0) {
    return {
      error:
        'The source shows no picture. Use <Image src="rakazo-image:1" /> for the first item in images.',
    };
  }
  if (places.length !== images.length) {
    return { error: "Reference every image in the visual or remove it from images." };
  }
  // The message stays in the chat and its history, so it never holds a value this run keeps secret.
  if (
    containsSecret(
      [title.data, summary, source, code, ...images.flatMap(({ url, alt }) => [url, alt])],
      ctx.secrets,
    )
  ) {
    return {
      error: "The visual contains a secret value; nothing was shown. Remove it and try again.",
    };
  }
  const maxId = "x".repeat(VISUAL_IMAGE_ARTIFACT_ID_LENGTH);
  const placedBytes = pageSourceBytes(
    replace(
      () => maxId,
      () => maxId,
    ),
  );
  if (placedBytes > VISUAL_CODE_MAX_BYTES) {
    return {
      error: `The visual is ${placedBytes} bytes compiled with its pictures; the limit is ${VISUAL_CODE_MAX_BYTES}. Show less, or build a page with save_page.`,
    };
  }

  const carried: CarriedImage[] = [];
  let published = false;
  try {
    const error =
      (await carryImages(ctx, call, places, images, carried)) ??
      (await carrySavedImages(ctx, call, saved, carried));
    if (error) return { error };
    const ids = new Map(carried.map(({ place, id }) => [place, id]));
    const block: MessageBlock = {
      kind: "visual",
      title: title.data,
      text: summary,
      code: replace(
        (place) => ids.get(place)!,
        (artifactId) => ids.get(artifactId)!,
      ),
      ...(carried.length
        ? { images: carried.map(({ id, alt, size }) => ({ id, alt, size })) }
        : {}),
    };
    const posted = await publishMessage(ctx.deps, ctx.run, "bot", [block]);
    if (!posted) {
      return { error: "The visual was not posted to the chat; nothing was shown." };
    }
    published = true;
    return {
      shown: true,
      embed: embedLine("visual", title.data, posted.id),
      note: "Place embed in your reply where the visual belongs. Do not repeat what it shows or paste its source.",
      ...(check.warnings?.length ? { warnings: check.warnings } : {}),
    };
  } finally {
    if (!published)
      await Promise.all(
        carried.map(({ discard }) => bestEffort("unposted visual image", discard())),
      );
  }
}

export const visualTools: ToolHandlers = {
  async show_visual(ctx, call) {
    return call.finish(await showVisual(ctx, call));
  },
};
