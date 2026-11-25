import type { MessageBlock } from "@rakazo/contracts";
import {
  PageTitleSchema,
  pageSourceBytes,
  VISUAL_CODE_MAX_BYTES,
  VISUAL_IMAGE_ALT_MAX_LENGTH,
  VISUAL_IMAGE_MAX_COUNT,
  VISUAL_SUMMARY_MAX_LENGTH,
} from "@rakazo/contracts";
import { containsSecret, embedLine, isBackgroundRunTrigger, outboundSiteGate } from "@rakazo/core";
import { normalizedHttpUrl, urlSite } from "@rakazo/core/egress";
import { checkPageSource, VISUAL_GUIDE } from "@rakazo/page-kit/validate";
import type { RunContext } from "./runs/assembly/run-context.js";
import { isRunTainted } from "./runs/assembly/run-context.js";
import { publishMessage } from "./runs/assembly/run-messages.js";
import { VISUAL_ESSENTIALS } from "./runs/assembly/show-visual.prompt.js";
import type { ToolCall, ToolHandlers } from "./runs/tools/run-tool-gate.js";
import { storeVisualImage } from "./storage/thread-artifacts.js";
import { fetchVisualImage } from "./web/visual-image.js";

/** The summary is one paragraph of plain text: every run of whitespace folds into a space. */
function summaryText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const summary = value.replace(/\s+/g, " ").trim();
  return summary && summary.length <= VISUAL_SUMMARY_MAX_LENGTH ? summary : null;
}

/** One picture the model passed: its 1-based place in images, with the address and alt text. */
type VisualImageArg = { place: number; url: string; alt: string };

/** The images argument, or why it cannot be used; an absent or empty list is no pictures. */
function visualImageArgs(value: unknown): VisualImageArg[] | string {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return [];
  if (!Array.isArray(value)) return "images must be a list of {url, alt}.";
  if (value.length > VISUAL_IMAGE_MAX_COUNT)
    return `Pass at most ${VISUAL_IMAGE_MAX_COUNT} images.`;
  const parsed: VisualImageArg[] = [];
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== "object") return `image ${index + 1} needs a url and alt.`;
    const record = entry as Record<string, unknown>;
    const url = typeof record.url === "string" ? normalizedHttpUrl(record.url) : undefined;
    if (!url) return `image ${index + 1} needs an http(s) url.`;
    const alt = typeof record.alt === "string" ? record.alt.replace(/\s+/g, " ").trim() : "";
    if (!alt) return `image ${index + 1} needs alt text.`;
    parsed.push({ place: index + 1, url, alt: alt.slice(0, VISUAL_IMAGE_ALT_MAX_LENGTH) });
  }
  return parsed;
}

/** The 1-based places the compiled code names a picture by, and whether any name is malformed. */
function imageReferences(code: string): { places: number[]; malformed: boolean } {
  const places: number[] = [];
  for (const match of code.matchAll(/rakazo-image:([0-9]+)/g)) {
    const place = Number(match[1]);
    if (!places.includes(place)) places.push(place);
  }
  return { places, malformed: /rakazo-image:(?![0-9])/.test(code) };
}

/** A picture the visual carries: its place, the stored artifact's id, and what the message keeps. */
type CarriedImage = { place: number; id: string; alt: string; size: number };

/**
 * Once outside text entered this run, a picture whose site the run was not given is refused, as a
 * fetch would be: injected text must not choose where a request goes. The owner's own words are
 * the request, so an untainted run fetches its pictures like any page it reads.
 */
async function imageSiteGates(
  ctx: RunContext,
  images: VisualImageArg[],
): Promise<Map<string, string>> {
  const gates = new Map<string, string>();
  if (!(await isRunTainted(ctx))) return gates;
  const [rules, trustedSites] = await Promise.all([
    ctx.trust.loadApprovalRules(),
    ctx.trust.loadTrustedSites(),
  ]);
  for (const image of images) {
    const site = urlSite(image.url);
    if (!site) {
      gates.set(image.url, "the url names no site");
      continue;
    }
    const trusted =
      ctx.trust.searchResultUrls.has(image.url) ||
      ctx.trust.pageImageUrls.has(image.url) ||
      trustedSites.has(site);
    if (outboundSiteGate({ site, trusted, rules }) !== "allow") {
      gates.set(image.url, `the site ${site} is not approved for this run`);
    }
  }
  return gates;
}

type CarriedResult = CarriedImage | { place: number; error: string };

/**
 * Fetch, check and store each picture the visual names. One that cannot load fails the whole
 * call, naming the picture: nothing is ever shown with a picture silently dropped.
 */
async function carryImages(
  ctx: RunContext,
  call: ToolCall,
  places: number[],
  images: VisualImageArg[],
): Promise<CarriedImage[] | string> {
  if (places.length === 0) return [];
  const artifacts = ctx.deps.artifacts;
  if (!artifacts)
    return "Image storage is not configured, so the visual was not shown. Call without images.";
  if (isBackgroundRunTrigger(ctx.run.trigger))
    return "A background run's visual is never shown, so its pictures are not fetched. Call without images.";
  const wanted = places.map((place) => images[place - 1]!);
  const gates = await imageSiteGates(ctx, wanted);
  const carried = await Promise.all(
    wanted.map(async (image): Promise<CarriedResult> => {
      const gate = gates.get(image.url);
      if (gate) return { place: image.place, error: gate };
      try {
        const resolved = await fetchVisualImage(image.url);
        const id = await storeVisualImage(
          { prisma: ctx.deps.prisma, artifacts },
          {
            spaceId: ctx.run.spaceId,
            userId: ctx.run.userId,
            botId: ctx.bot.id,
            groupId: ctx.thread.groupId ?? undefined,
            runId: ctx.runId,
            operationId: call.executionId,
          },
          { bytes: resolved.bytes },
        );
        return { place: image.place, id, alt: image.alt, size: resolved.bytes.byteLength };
      } catch (error) {
        return {
          place: image.place,
          error: error instanceof Error ? error.message : "the picture could not be fetched",
        };
      }
    }),
  );
  const failed = carried.find(
    (entry): entry is { place: number; error: string } => "error" in entry,
  );
  if (failed) {
    const image = images[failed.place - 1]!;
    return `rakazo-image:${failed.place} (${image.url}) could not be shown: ${failed.error}. Nothing was shown. Drop that picture or try another URL, then call again.`;
  }
  return carried.flatMap((entry) => ("error" in entry ? [] : [entry]));
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
  const { places, malformed } = imageReferences(code);
  if (malformed) {
    return {
      error: "A picture src must be rakazo-image:<its 1-based place in images>.",
    };
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
        'The source shows no picture, so images would never appear. Give each picture src="rakazo-image:<its 1-based place in images>", or leave images out.',
    };
  }
  // The message stays in the chat and its history, so it never holds a value this run keeps secret.
  if (
    containsSecret(
      [title.data, summary, source, code, ...images.map((image) => image.alt)],
      ctx.secrets,
    )
  ) {
    return {
      error: "The visual contains a secret value; nothing was shown. Remove it and try again.",
    };
  }
  const carried = await carryImages(ctx, call, places, images);
  if (typeof carried === "string") return { error: carried };
  // The code that ships names each picture by its stored id, so the frame can only ever ask for
  // pictures of its own message, never an address.
  const placed = carried.length
    ? code.replace(/rakazo-image:([0-9]+)/g, (token, digits) => {
        const stored = carried.find((entry) => entry.place === Number(digits));
        return stored ? `rakazo-image:${stored.id}` : token;
      })
    : code;
  const placedBytes = pageSourceBytes(placed);
  if (placedBytes > VISUAL_CODE_MAX_BYTES) {
    return {
      error: `The visual is ${placedBytes} bytes compiled with its pictures; the limit is ${VISUAL_CODE_MAX_BYTES}. Show less, or build a page with save_page.`,
    };
  }
  const block: MessageBlock = {
    kind: "visual",
    title: title.data,
    text: summary,
    code: placed,
    ...(carried.length ? { images: carried.map(({ id, alt, size }) => ({ id, alt, size })) } : {}),
  };
  // A background run posts nothing to the chat, and a cancelled run's message does not commit.
  const posted = await publishMessage(ctx.deps, ctx.run, "bot", [block]);
  if (!posted) {
    return { error: "The visual was not posted to the chat; nothing was shown." };
  }
  return {
    shown: true,
    embed: embedLine("visual", title.data, posted.id),
    note: "Place embed in your reply where the visual belongs. Do not repeat what it shows or paste its source.",
    ...(check.warnings?.length ? { warnings: check.warnings } : {}),
  };
}

export const visualTools: ToolHandlers = {
  async show_visual(ctx, call) {
    return call.finish(await showVisual(ctx, call));
  },
};
