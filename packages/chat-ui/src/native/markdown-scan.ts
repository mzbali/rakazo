import { createMathScanner } from "@rakazo/core/math-delimiters";
import type { MarkdownEmbed } from "../markdown";
import { appLinkMatches, markdownEmbed } from "../markdown";
import { openingMediaImage } from "../media-row";

/** The parser autolinks only web addresses, so a bare app link is written as an autolink. */
export function withAppAutolinks(markdown: string): string {
  let out = "";
  let from = 0;
  for (const [start, end] of asWrittenSpans(markdown)) {
    out += autolinkProse(markdown.slice(from, start)) + markdown.slice(start, end);
    from = end;
  }
  return out + autolinkProse(markdown.slice(from));
}

function autolinkProse(part: string): string {
  let out = "";
  let from = 0;
  for (const match of appLinkMatches(part)) {
    if (match.index < from || part.slice(Math.max(0, match.index - 1), match.index) === "<") {
      continue;
    }
    out += `${part.slice(from, match.index)}<${match.url}>`;
    from = match.lastIndex;
  }
  return out + part.slice(from);
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]/;
const INDENTED = /^(?: {4}|\t)/;
const BLANK_LINE = /\n[ \t]*\n/g;

/**
 * Block code as written: fences, which open at the start of a line after up to three spaces and
 * close on a line of their own marker at least as long, and code indented four spaces, which
 * only starts after a blank line and outside a list. One pass over the lines.
 */
function blockCodeSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let pos = 0;
  let afterBlank = true;
  let inList = false;
  let inIndented = false;
  while (pos < text.length) {
    const found = text.indexOf("\n", pos);
    const eol = found === -1 ? text.length : found;
    const line = text.slice(pos, eol);
    const open = FENCE_OPEN.exec(line);
    // A backtick fence's info string has no backtick, or the run is inline code.
    if (open?.[1] && !(open[1][0] === "`" && line.slice(open[0].length).includes("`"))) {
      const marker = open[1][0] as string;
      const closer = new RegExp(
        `^ {0,3}${marker === "`" ? "`" : "~"}{${open[1].length},}[ \\t\\r]*$`,
      );
      let end = text.length;
      for (let next = eol + 1; next <= text.length; ) {
        const lineEnd = text.indexOf("\n", next);
        const stop = lineEnd === -1 ? text.length : lineEnd;
        if (closer.test(text.slice(next, stop))) {
          end = stop;
          break;
        }
        if (lineEnd === -1) break;
        next = lineEnd + 1;
      }
      spans.push([pos, end]);
      pos = end + 1;
      afterBlank = false;
      inIndented = false;
      continue;
    }
    if (line.trim() === "") {
      afterBlank = true;
    } else if (INDENTED.test(line)) {
      if ((afterBlank || inIndented) && !inList) {
        spans.push([pos, eol]);
        inIndented = true;
      }
      afterBlank = false;
    } else {
      inIndented = false;
      inList = LIST_ITEM.test(line) || (inList && !afterBlank);
      afterBlank = false;
    }
    pos = eol + 1;
  }
  return spans;
}

/**
 * Where code and explicit links sit, which stay as written: block code, inline code (a backtick
 * run closes on a run of the same length before the next blank line or block code) and a link on
 * one line. A scanner rather than a pattern, so bot text full of backticks or brackets stays
 * linear.
 */
export function asWrittenSpans(text: string): Array<[number, number]> {
  const blocks = blockCodeSpans(text);
  const spans: Array<[number, number]> = [];
  const found = new Map<string, number>();
  // The next index of `char` from `from`, remembered because `from` only moves forward.
  const next = (char: string, from: number) => {
    let at = found.get(char);
    if (at === undefined || (at !== -1 && at < from)) {
      at = text.indexOf(char, from);
      found.set(char, at);
    }
    return at === -1 ? text.length : at;
  };
  // Where the paragraph holding `from` ends; `from` only moves forward, so a result is reused.
  let paragraph = -1;
  const paragraphEnd = (from: number) => {
    if (paragraph < from) {
      BLANK_LINE.lastIndex = from;
      paragraph = BLANK_LINE.exec(text)?.index ?? text.length;
    }
    return paragraph;
  };
  // Backtick run lengths with no closer before this paragraph end.
  const unclosed = new Map<number, number>();
  let block = 0;
  let i = 0;
  while (i < text.length) {
    const code = blocks[block];
    if (code && i >= code[0]) {
      spans.push(code);
      i = Math.max(i, code[1]);
      block++;
      continue;
    }
    const char = text[i];
    if (char === "`") {
      let end = i;
      while (text[end] === "`") end++;
      const length = end - i;
      const stop = Math.min(paragraphEnd(end), code ? code[0] : text.length);
      if ((unclosed.get(length) ?? -1) < stop) {
        const close = backtickRun(text, end, stop, length);
        if (close !== -1) {
          spans.push([i, close + length]);
          i = close + length;
          continue;
        }
        unclosed.set(length, stop);
      }
      i = end;
      continue;
    }
    if (char === "[") {
      const lineEnd = next("\n", i);
      const label = next("]", i);
      const target = label < lineEnd && text[label + 1] === "(" ? next(")", label) : -1;
      if (target !== -1 && target < lineEnd) {
        spans.push([i, target + 1]);
        i = target + 1;
        continue;
      }
    }
    i++;
  }
  return spans;
}

/** Where a run of exactly `length` backticks starts in [from, to), or -1. */
function backtickRun(text: string, from: number, to: number, length: number): number {
  let i = from;
  while (i < to) {
    if (text[i] !== "`") {
      i++;
      continue;
    }
    let end = i;
    while (end < to && text[end] === "`") end++;
    if (end - i === length) return i;
    i = end;
  }
  return -1;
}

/** A run of Markdown, or a block the native text cannot draw between two runs. */
export type MarkdownSegment =
  | { kind: "markdown"; text: string }
  | { kind: "math"; tex: string; display: boolean }
  | {
      kind: "media";
      embed: MarkdownEmbed;
      alt: string;
      /** The rest of the item, as Markdown. */
      copy: string;
      /** A media row sits right under another one. */
      divided: boolean;
    };

// Lines that make a formula part of a list, quote, table or indented block rather than a block
// of its own.
const NESTED_LINE = /^(?: {2,}|\t|[ ]{0,3}>|[ ]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t])/;

function codeSpan(source: string): string {
  const longest = Math.max(0, ...(source.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks} ${source} ${ticks}`;
}

function tidy(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, "").trimEnd();
}

/**
 * The Markdown split at each formula on a line of its own level, which draws as a view between
 * runs of text. A formula inside a list, quote, table or indented block stays text, as code, so
 * its backslashes survive. Code and links stay as written. A single `$` is never a formula.
 */
function splitAtMath(markdown: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const kept = asWrittenSpans(markdown);
  const scan = createMathScanner(markdown);
  let current = "";
  let from = 0;
  let line = 0;
  let nextLine = markdown.indexOf("\n");
  let span = 0;
  const flush = () => {
    const text = tidy(current);
    if (text) segments.push({ kind: "markdown", text });
    current = "";
  };
  for (let i = 0; i < markdown.length; i++) {
    while (kept[span] && (kept[span]?.[1] as number) <= i) span++;
    const written = kept[span];
    if (written && i >= written[0]) {
      i = written[1] - 1;
      continue;
    }
    while (nextLine !== -1 && nextLine < i) {
      line = nextLine + 1;
      nextLine = markdown.indexOf("\n", line);
    }
    const char = markdown.charCodeAt(i);
    if (char !== 0x5c && char !== 0x24) continue;
    // A backslash that is itself escaped, or an escaped `$`, does not open a formula.
    let slashes = 0;
    while (markdown.charCodeAt(i - 1 - slashes) === 0x5c) slashes++;
    if (slashes % 2 === 1) continue;
    const match = scan(i);
    if (!match) continue;
    const rowEnd = markdown.indexOf("\n", match.end);
    const row = markdown.slice(line, rowEnd === -1 ? markdown.length : rowEnd);
    const nested = NESTED_LINE.test(markdown.slice(line, i + 1)) || row.includes("|");
    current += markdown.slice(from, i);
    if (nested) {
      current += codeSpan(markdown.slice(i, match.end));
    } else {
      flush();
      segments.push({ kind: "math", tex: match.tex, display: match.display });
    }
    from = match.end;
    // The words after a formula start the next run, not their separating space.
    if (!nested) while (markdown[from] === " ") from++;
    i = from - 1;
  }
  current += markdown.slice(from);
  flush();
  return segments;
}

const MEDIA_ITEM = /^(?:[-+*]|\d{1,9}[.)])[ \t]+!\[([^\]\n]*)\]\(([^)\s]+)\)[ \t]*(.*)$/;

/**
 * A top-level list item (no indent, so not a nested one) that opens with an `image:` embed and goes on with text is a media row.
 * Those items become segments of their own; the rest of the Markdown, other list items
 * included, stays as written.
 */
function splitMediaRows(markdown: string): MarkdownSegment[] {
  if (!markdown.includes("](image:")) return [{ kind: "markdown", text: markdown }];
  const written = asWrittenSpans(markdown);
  const lines = markdown.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  // Lines only move forward, so the spans are walked once.
  let writtenAt = 0;
  const inWritten = (index: number) => {
    const start = starts[index] as number;
    while (written[writtenAt] && (written[writtenAt]?.[1] as number) <= start) writtenAt++;
    const span = written[writtenAt];
    return span !== undefined && start >= span[0];
  };
  const segments: MarkdownSegment[] = [];
  let plain: string[] = [];
  let previousMedia = false;
  const flush = () => {
    const text = tidy(plain.join("\n"));
    if (text) segments.push({ kind: "markdown", text });
    plain = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as string;
    const item = inWritten(index) ? null : MEDIA_ITEM.exec(line);
    // The item's text may go on below its first line, indented.
    const continuation: string[] = [];
    let last = index;
    if (item) {
      for (let next = index + 1; next < lines.length; next++) {
        const following = lines[next] as string;
        if (following.trim() === "") continue;
        if (!/^(?: {2,}|\t)/.test(following)) break;
        continuation.push(following.replace(/^(?: {1,4}|\t)/, ""));
        last = next;
      }
    }
    const rest = [item?.[3] ?? "", ...continuation].join("\n");
    const embed = item ? markdownEmbed(item[2], item[1]) : undefined;
    const opening = item
      ? openingMediaImage([
          { type: "image", src: item[2] as string, alt: item[1] as string },
          { type: "text", value: rest },
        ])
      : undefined;
    if (!item || !embed || !opening) {
      if (item || line.trim() !== "") previousMedia = false;
      plain.push(line);
      continue;
    }
    flush();
    segments.push({
      kind: "media",
      embed,
      alt: item[1] as string,
      copy: tidy(rest),
      divided: previousMedia,
    });
    previousMedia = true;
    index = last;
  }
  flush();
  return segments;
}

/**
 * The Markdown as runs of native text with the blocks it cannot draw between them: a formula,
 * and, when `mediaRows` is on, a list item that opens with an `image:` embed.
 */
export function markdownSegments(markdown: string, mediaRows: boolean): MarkdownSegment[] {
  const maybeMath = markdown.includes("$$") || markdown.includes("\\(") || markdown.includes("\\[");
  const parts: MarkdownSegment[] = maybeMath
    ? splitAtMath(markdown)
    : [{ kind: "markdown", text: markdown }];
  if (!mediaRows) return parts;
  return parts.flatMap((part) => (part.kind === "markdown" ? splitMediaRows(part.text) : [part]));
}
