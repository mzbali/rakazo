import type { MessageBlock } from "@rakazo/contracts";
import { codeSkipEnds } from "./messages/page-links.js";

export type EmbedKind = "visual" | "image";

/** A `![label](visual:<id>)` or `![label](image:<id>)` reference outside code. */
export type EmbedReference = {
  kind: EmbedKind;
  id: string;
  label: string;
};

/** A thread row the fold can see, including the live `progress:<runId>` row. */
export type EmbedFoldMessage = {
  id: string;
  role: string;
  runId?: string;
  blocks: readonly MessageBlock[];
};

export type EmbedTarget =
  | { kind: "visual"; messageId: string; block: Extract<MessageBlock, { kind: "visual" }> }
  | { kind: "image"; block: Extract<MessageBlock, { kind: "image" }> }
  | { kind: "file"; block: Extract<MessageBlock, { kind: "file" }> };

const EMBED_KINDS = new Set<EmbedKind>(["visual", "image"]);
const STANDALONE_KINDS = new Set(["visual", "image", "file"]);
// Markdown escapes only ASCII punctuation; any other backslash is part of the label.
const ESCAPABLE = /[!-/:-@[-`{-~]/;
const EMBED_DEST = /^\((visual|image):([A-Za-z0-9_-]{1,64})\)/;

/** The line a tool returns for the reply to paste. `[]\` and line breaks leave the label. */
export function embedLine(kind: EmbedKind, label: string, id: string): string {
  const safe = label.replace(/[\r\n]+/g, " ").replace(/[\\[\]]/g, "\\$&");
  return `![${safe}](${kind}:${id})`;
}

function skipEnds(text: string): Int32Array | null {
  return text.includes("`") || text.includes("~~~") ? codeSkipEnds(text) : null;
}

/**
 * The next embed at or after `at`, or where to resume when `at` is not one.
 * Code spans and fenced blocks are not embeds.
 */
function nextEmbed(
  text: string,
  at: number,
  skips: Int32Array | null,
): { ref: EmbedReference; from: number; to: number } | undefined {
  while (at < text.length) {
    const char = text[at];
    if (char === "\\") {
      at += 2;
      continue;
    }
    if (char === "`" || char === "~") {
      at = skips?.[at] || at + 1;
      continue;
    }
    if (char !== "!" || text[at + 1] !== "[") {
      at += 1;
      continue;
    }
    let end = at + 2;
    let label = "";
    let closed = false;
    while (end < text.length) {
      const next = text[end]!;
      if (next === "\\" && ESCAPABLE.test(text[end + 1] ?? "")) {
        label += text[end + 1];
        end += 2;
      } else if (next === "]") {
        closed = true;
        break;
      } else if (next === "[" || next === "\n") {
        break;
      } else {
        label += next;
        end += 1;
      }
    }
    const dest = closed ? EMBED_DEST.exec(text.slice(end + 1)) : null;
    if (dest && EMBED_KINDS.has(dest[1] as EmbedKind)) {
      return {
        ref: { kind: dest[1] as EmbedKind, id: dest[2]!, label },
        from: at,
        to: end + 1 + dest[0].length,
      };
    }
    at = closed ? end + 1 : end === at + 2 ? at + 1 : end;
  }
  return undefined;
}

function eachEmbed(text: string, visit: (ref: EmbedReference, from: number, to: number) => void) {
  if (!text.includes("![")) return;
  const skips = skipEnds(text);
  let at = 0;
  while (at < text.length) {
    const found = nextEmbed(text, at, skips);
    if (!found) return;
    visit(found.ref, found.from, found.to);
    at = found.to;
  }
}

/** Embed references outside code, in order. A sample inside a fence does not count. */
export function embedReferencesIn(text: string): EmbedReference[] {
  const refs: EmbedReference[] = [];
  eachEmbed(text, (ref) => refs.push(ref));
  return refs;
}

/** `![Title](visual:<id>)` as `[visual: Title]`, and the same for images. Code stays as written. */
export function plainEmbedReferences(text: string): string {
  if (!text.includes("![")) return text;
  let out = "";
  let copied = 0;
  eachEmbed(text, (ref, from, to) => {
    out += `${text.slice(copied, from)}[${ref.kind}: ${ref.label}]`;
    copied = to;
  });
  return out + text.slice(copied);
}

function textReferences(blocks: readonly MessageBlock[]): EmbedReference[] {
  const refs: EmbedReference[] = [];
  for (const block of blocks) {
    if (block.kind === "text" || block.kind === "progress") {
      for (const ref of embedReferencesIn(block.text)) refs.push(ref);
    }
  }
  return refs;
}

/** A bot message that is only visual, image or file blocks. */
export function isStandaloneEmbedMessage(message: EmbedFoldMessage): boolean {
  return (
    message.role === "bot" &&
    message.blocks.length > 0 &&
    message.blocks.every((block) => STANDALONE_KINDS.has(block.kind))
  );
}

/** Whether `refs` place every card in the message, so hiding it loses nothing. */
function placesWholeMessage(message: EmbedFoldMessage, refs: readonly EmbedReference[]): boolean {
  return message.blocks.every((block) =>
    block.kind === "visual"
      ? refs.some((ref) => ref.kind === "visual" && ref.id === message.id)
      : (block.kind === "image" || block.kind === "file") &&
        refs.some((ref) => ref.kind === "image" && ref.id === block.artifactId),
  );
}

/**
 * Standalone bot messages whose every card a later message of the same run places with an
 * embed reference. A card left unplaced keeps its message where it is, and so does a
 * reference from another run.
 */
export function placedEmbedMessages<T extends EmbedFoldMessage>(messages: readonly T[]): T[] {
  const refsAfter = new Map<string, EmbedReference[]>();
  const placed = new Set<string>();
  // Walk backwards so each standalone sees only the references its run made after it.
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (!message.runId) continue;
    const refs = refsAfter.get(message.runId) ?? [];
    if (refs.length && isStandaloneEmbedMessage(message) && placesWholeMessage(message, refs))
      placed.add(message.id);
    const own = textReferences(message.blocks);
    if (own.length) refsAfter.set(message.runId, [...refs, ...own]);
  }
  return messages.filter((message) => placed.has(message.id));
}

/**
 * The card a reference names, among messages the client already holds.
 * An image artifact wins over a file with the same id. Nothing is fetched.
 */
export function embedTarget(
  messages: readonly { id: string; blocks: readonly MessageBlock[] }[],
  ref: { kind: EmbedKind; id: string },
): EmbedTarget | null {
  if (ref.kind === "visual") {
    for (const message of messages) {
      if (message.id !== ref.id) continue;
      const block = message.blocks.find((item) => item.kind === "visual");
      if (block?.kind === "visual") return { kind: "visual", messageId: message.id, block };
    }
    return null;
  }
  let file: Extract<MessageBlock, { kind: "file" }> | undefined;
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind === "image" && block.artifactId === ref.id) return { kind: "image", block };
      if (!file && block.kind === "file" && block.artifactId === ref.id) file = block;
    }
  }
  return file ? { kind: "file", block: file } : null;
}
