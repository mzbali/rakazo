import type { PageSectionAnchor } from "@rakazo/contracts";
import { PageSectionOccurrence, VISUAL_IMAGE_MAX_COUNT } from "@rakazo/contracts";

// Same policy as the web preview: nothing loads from the network, so a script
// cannot send what it reads to a remote image or font URL.
export const SANDBOXED_ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'";

const PLAIN_HTML_DOCTYPE = /^\s*<!doctype\s+html\s*>/i;

/**
 * The CSP is a second layer, not the isolation boundary: on web that is the iframe's
 * `sandbox="allow-scripts"` (no `allow-same-origin`); on native it is the WebView never
 * sharing the app's cookies/storage and being blocked from navigating. Within that
 * boundary the CSP still blocks outbound network requests a script might attempt.
 */
export function withSandboxedArtifactCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${SANDBOXED_ARTIFACT_CSP}">`;
  const leadingDoctype = html.match(PLAIN_HTML_DOCTYPE);
  if (!leadingDoctype) return `<!DOCTYPE html>${meta}${html}`;
  const end = leadingDoctype[0].length;
  return `${html.slice(0, end)}${meta}${html.slice(end)}`;
}

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

/** Served by the API; the viewer inlines it, since the sandbox policy loads nothing. */
export const PAGE_RUNTIME_PATH = "/api/v1/assets/page-runtime.js";

/**
 * A page as one self-contained document for the same sandboxed viewers: the runtime
 * and a boot script carrying the page's compiled code. `<` is escaped in the JSON so no page
 * text can close the script element.
 */
export function pageViewerDocument(input: {
  runtime: string;
  /** The page compiled for the viewer, as the API returns it. */
  code: string;
  theme: "light" | "dark";
  errorTitle: string;
  /** The host surface the page sits on, as a hex colour; it paints behind the page on screen. */
  surface?: string;
  /** A touch tablet or phone, where pages sit closer to the edge. */
  touch?: boolean;
  /** The host can put a page's reply in a chat composer beside it; public pages have none. */
  reply?: boolean;
  review?: boolean;
  reviewAnchor?: string;
  reviewAnchorOccurrence?: number;
  /** Pixels the host covers at the bottom (a docked composer); bottom bars and the end clear it. */
  bottomInset?: number;
  /** The reader's app language, for the kit's own words when the page does not set `lang`. */
  lang?: string;
  /**
   * A visual rather than a page: no page margins. `card` draws it in a chat message, fitted to the
   * card's width; `full` opens it whole.
   */
  inline?: "card" | "full";
  /** A preview that only draws and is scaled into a card: it never shows a scrollbar. */
  still?: boolean;
}): string {
  const boot = JSON.stringify({
    code: input.code,
    theme: input.theme,
    errorTitle: input.errorTitle,
    lang: input.lang,
    review: input.review || undefined,
    reviewAnchor: input.review ? input.reviewAnchor : undefined,
    reviewAnchorOccurrence: input.review ? input.reviewAnchorOccurrence : undefined,
  }).replace(/</g, "\\u003c");
  const inset =
    input.bottomInset !== undefined && Number.isFinite(input.bottomInset) && input.bottomInset > 0
      ? `<style>:root{--rk-bottom-inset:${Math.round(input.bottomInset)}px}</style>`
      : "";
  return [
    `<!DOCTYPE html><html${input.touch ? " data-touch" : ""}${input.reply ? " data-reply" : ""}${input.still ? " data-still" : ""}${input.inline === "card" || input.inline === "full" ? ` data-inline="${input.inline}"` : ""}><head><meta charset="utf-8">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<script>${input.runtime}</script>`,
    input.surface !== undefined && HEX_COLOR.test(input.surface)
      ? `<style>@media screen{:root[data-theme]{--background:${input.surface}}}</style>`
      : "",
    inset,
    "</head>",
    `<body><div id="root"></div><script>RakazoPage.mount(${boot})</script></body></html>`,
  ].join("");
}

/** A page reply's text on one line, as the chat's composer takes it; null when unusable. */
export function pageReplyText(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean && clean.length <= 300 ? clean : null;
}

const IMAGE_REQUEST_MESSAGE = "rakazo-page:image";
const IMAGE_DATA_MESSAGE = "rakazo-page:image-data";
/** An artifact id is a short generated token: letters, digits and hyphens, never a URL. */
const PAGE_IMAGE_ID = /^[a-z0-9-]{1,64}$/i;

/**
 * A picture the frame asked the host to load, but only when the message this frame draws carries
 * that id: the sandbox never sees bytes for anything else, and never a URL. Hosts pass their own
 * message's image list, so a guess at another message's id answers nothing.
 */
export function pageImageRequest(
  data: unknown,
  carried: ReadonlyArray<{ id: string }> | undefined,
): { id: string } | null {
  if (!data || typeof data !== "object") return null;
  const { type, id } = data as { type?: unknown; id?: unknown };
  if (type !== IMAGE_REQUEST_MESSAGE || typeof id !== "string") return null;
  if (!PAGE_IMAGE_ID.test(id)) return null;
  return carried?.some((image) => image.id === id) ? { id } : null;
}

/** The answer a frame's image request waits for: the bytes as a data URI, or null when it has none. */
export function pageImageResult(id: string, src: string | null) {
  return { type: IMAGE_DATA_MESSAGE, id, src };
}

/**
 * Each document gets one download and one reply per carried id. The frame's own bridge shares
 * that reply among all consumers; repeated requests have no work to do, even after it arrives.
 */
export function createPageImageResponder(load: (id: string) => Promise<string | null>) {
  const requested = new Set<string>();
  return (
    data: unknown,
    carried: ReadonlyArray<{ id: string }> | undefined,
    answer: (message: object) => void,
  ): boolean => {
    const image = pageImageRequest(data, carried);
    if (!image) return false;
    if (requested.has(image.id) || requested.size >= VISUAL_IMAGE_MAX_COUNT) return true;
    requested.add(image.id);
    void load(image.id).then((src) => answer(pageImageResult(image.id, src)));
    return true;
  };
}

/** A page's copy buttons send at most this much; the kit refuses longer text before asking. */
export const PAGE_COPY_MAX_LENGTH = 20_000;

/**
 * Text a page asked the app to put on the clipboard, which the sandbox cannot reach on every
 * browser or WebView. The app only ever writes it: no page message reads the clipboard back.
 */
export function pageCopyRequest(data: unknown): { id: string; text: string } | null {
  if (!data || typeof data !== "object") return null;
  const { type, id, text } = data as { type?: unknown; id?: unknown; text?: unknown };
  if (type !== "rakazo-page:copy" || typeof id !== "string" || typeof text !== "string")
    return null;
  if (id.length === 0 || id.length > 64 || text.length === 0) return null;
  return text.length <= PAGE_COPY_MAX_LENGTH ? { id, text } : null;
}

/** A web or mail link a page asked the app to open; anything else stays inside the page. */
export function pageLinkRequest(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const { type, url } = data as { type?: unknown; url?: unknown };
  if (type !== "rakazo-page:open-link" || typeof url !== "string" || url.length > 4096) return null;
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** The answer a page's copy button waits for. */
export function pageCopyResult(id: string, ok: boolean) {
  return { type: "rakazo-page:copied", id, ok };
}

/**
 * How a visual sits in the chat. One that fits works there at its own height, and its controls
 * take taps; it has no full-screen control. A taller one (a report, a dashboard) shows its top
 * as a preview that opens whole from a full-screen button. `drawing` holds until it first
 * reports its height.
 */
export type VisualFit = "drawing" | "inline" | "preview";

/**
 * The tallest a visual stays live in the chat, in CSS pixels and in points. A calculator, a
 * checklist or a timeline fits and works in place at full height. Past this, a report or a
 * dashboard shows its top and opens whole.
 */
export const MAX_INLINE_VISUAL_HEIGHT = 2400;

/** How much of a too-tall visual the chat shows as its preview. */
export const VISUAL_PREVIEW_HEIGHT = 1200;

/**
 * The fit from the first height the visual reports, kept after that: a control that grows the
 * visual while someone uses it must not turn it into a preview under their finger.
 */
export function visualFit(current: VisualFit, height: number, maxInline: number): VisualFit {
  if (current !== "drawing" || !Number.isFinite(height) || height <= 0) return current;
  return height <= maxInline ? "inline" : "preview";
}

/** Untrusted labels from the shown frame, used only as choices in the host's comment form. */
export function pageReviewSections(message: unknown): PageSectionAnchor[] | undefined {
  if (
    !message ||
    typeof message !== "object" ||
    !("type" in message) ||
    message.type !== "rakazo-page:sections" ||
    !("sections" in message) ||
    !Array.isArray(message.sections)
  )
    return undefined;
  const cleanSection = (label: unknown) =>
    typeof label === "string" ? label.slice(0, 200).replace(/\s+/g, " ").trim() : "";
  if ("anchors" in message && Array.isArray(message.anchors)) {
    const seen = new Set<string>();
    return message.anchors.slice(0, 80).flatMap((anchor: unknown) => {
      if (!anchor || typeof anchor !== "object" || !("section" in anchor)) return [];
      const section = cleanSection(anchor.section);
      const occurrence = PageSectionOccurrence.safeParse(
        "sectionOccurrence" in anchor ? anchor.sectionOccurrence : undefined,
      );
      if (!section || !occurrence.success) return [];
      const key = JSON.stringify([section, occurrence.data]);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ section, sectionOccurrence: occurrence.data }];
    });
  }
  const labels = message.sections.slice(0, 80).flatMap((label: unknown) => {
    const text = cleanSection(label);
    return text ? [text] : [];
  });
  return [...new Set(labels)].map((section) => ({ section }));
}
