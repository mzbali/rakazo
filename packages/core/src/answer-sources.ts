import type { MessageBlock } from "@rakazo/contracts";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { hostSite, normalizedHttpUrl } from "./egress.js";

/**
 * A separate entry so the markdown parser and the public suffix list stay off the main core
 * bundle. Importers that never cite a page do not load either.
 */

const URL_MAX = 2048;
const TITLE_MAX = 300;
const SITE_MAX = 40;
const SITE_LABEL_MAX = 18;
/** A citation cluster stops at a sentence end, so the pill stays with the claim it supports. */
const SENTENCE_END = /[.?!。！？…]/u;
/** The text before a link already finished its sentence, ignoring a closing quote or bracket. */
const SENTENCE_ENDED = /[.?!。！？…]['"”’)\]]*$/u;
const JOINING_GAP = /^[\s\p{P}]*$/u;
const TRAILING_TEXT = /^(?:\s*$|[ \t]*\n|\s*[^\s\p{L}\p{N}])/u;
/** A space the model left between a pill marker and the punctuation that follows it. */
const PILL_PUNCTUATION_GAP = /(\]\(rakazo-cite:\d+\))[ \t]+(?=[.?!。！？…,;:)])/gu;
/** The parts of a page title, as in "Mars Facts | NASA Science". */
const TITLE_PARTS = /\s+[-–—|·•]\s+|:\s+/u;

export const CITED_SOURCES_MAX = 12;
export const CITATION_URL_PREFIX = "rakazo-cite:";

/** A page a run searched or fetched, keyed by its normalized URL. */
export type RecordedSource = { url: string; title: string };

/** One cited page, as the reply stores it and the pill shows it. */
export type SourceItem = { url: string; title: string; site: string };

/** Adjacent citations drawn as one pill. `index` is the `rakazo-cite:` marker. */
export type CitationGroup = { index: number; items: SourceItem[] };

type MdNode = {
  type: string;
  url?: string;
  value?: string;
  identifier?: string;
  children?: MdNode[];
  position?: {
    start: { offset?: number | null };
    end: { offset?: number | null };
  };
};

const citationParser = unified().use(remarkParse).use(remarkGfm);

function parseMarkdown(markdown: string): MdNode | undefined {
  try {
    return citationParser.parse(markdown) as MdNode;
  } catch {
    return undefined;
  }
}

/** The short site name on a pill: the registrable domain's first label, without `www`. */
export function citationSiteLabel(url: string): string {
  const normalized = normalizedHttpUrl(url);
  if (!normalized) return "";
  let hostname: string;
  try {
    hostname = new URL(normalized).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
  const site = hostSite(hostname) ?? hostname;
  return (site.split(".")[0] ?? site).slice(0, SITE_LABEL_MAX);
}

/**
 * Remember a searched or fetched page. The first non-empty title wins. URLs that are not http(s),
 * or that are too long to store, are skipped. The same normalization as search-result trust.
 */
export function recordRunSource(
  sources: Map<string, RecordedSource>,
  rawUrl: string,
  title: string,
): void {
  if (rawUrl.length > URL_MAX) return;
  const url = normalizedHttpUrl(rawUrl);
  if (!url || url.length > URL_MAX) return;
  const nextTitle = title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
  const existing = sources.get(url);
  if (!existing) {
    sources.set(url, { url, title: nextTitle });
    return;
  }
  if (!existing.title && nextTitle) existing.title = nextTitle;
}

function sourceItemFromRecord(recorded: RecordedSource): SourceItem | undefined {
  const site = citationSiteLabel(recorded.url).slice(0, SITE_MAX);
  if (!site) return undefined;
  return { url: recorded.url, title: (recorded.title || site).slice(0, TITLE_MAX), site };
}

function definitionUrls(node: MdNode, into = new Map<string, string>()): Map<string, string> {
  if (node.type === "definition" && node.identifier && node.url) {
    into.set(node.identifier.toLowerCase(), node.url);
  }
  if (node.children) for (const child of node.children) definitionUrls(child, into);
  return into;
}

function imageOnly(node: MdNode): boolean {
  const children = node.children ?? [];
  return children.length > 0 && children.every((child) => child.type === "image");
}

function resolvedUrl(node: MdNode, definitions: ReadonlyMap<string, string>): string | undefined {
  if (node.type === "link") return node.url;
  if (node.type === "linkReference" && node.identifier) {
    return definitions.get(node.identifier.toLowerCase());
  }
  return undefined;
}

function matchingUrl(
  node: MdNode,
  known: ReadonlyMap<string, unknown>,
  definitions: ReadonlyMap<string, string>,
): string | undefined {
  if (node.type !== "link" && node.type !== "linkReference") return undefined;
  if (imageOnly(node)) return undefined;
  const raw = resolvedUrl(node, definitions);
  if (!raw) return undefined;
  const url = normalizedHttpUrl(raw);
  return url && known.has(url) ? url : undefined;
}

function collectCited(
  node: MdNode,
  recorded: ReadonlyMap<string, RecordedSource>,
  definitions: ReadonlyMap<string, string>,
  seen: Set<string>,
  items: SourceItem[],
) {
  if (items.length >= CITED_SOURCES_MAX) return;
  if (node.type === "code" || node.type === "inlineCode") return;
  const url = matchingUrl(node, recorded, definitions);
  if (url) {
    if (!seen.has(url)) {
      seen.add(url);
      const recordedSource = recorded.get(url);
      const item = recordedSource ? sourceItemFromRecord(recordedSource) : undefined;
      if (item) items.push(item);
    }
    return;
  }
  if (node.type === "link" || node.type === "linkReference") return;
  if (!node.children) return;
  for (const child of node.children) {
    collectCited(child, recorded, definitions, seen, items);
    if (items.length >= CITED_SOURCES_MAX) return;
  }
}

/** Cited pages in first-link order, capped. A link inside code, or an image-only link, is not one. */
export function citedSourceItems(
  blocks: readonly MessageBlock[],
  recorded: ReadonlyMap<string, RecordedSource>,
): SourceItem[] {
  if (recorded.size === 0) return [];
  const items: SourceItem[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.kind !== "text" || !block.text || items.length >= CITED_SOURCES_MAX) continue;
    const tree = parseMarkdown(block.text);
    if (!tree) continue;
    collectCited(tree, recorded, definitionUrls(tree), seen, items);
  }
  return items;
}

/**
 * Append one sources block for the links this message cites. No block when nothing was cited,
 * the run recorded nothing, or a sources block is already there.
 */
export function withCitedSourceBlock(
  blocks: MessageBlock[],
  recorded: ReadonlyMap<string, RecordedSource> | undefined,
): MessageBlock[] {
  if (!recorded || recorded.size === 0) return blocks;
  if (blocks.some((block) => block.kind === "sources")) return blocks;
  const items = citedSourceItems(blocks, recorded);
  if (items.length === 0) return blocks;
  return [...blocks, { kind: "sources", items }];
}

/** The sources block on a message, if it has one. */
export function messageSources(blocks: readonly MessageBlock[] | undefined): SourceItem[] {
  const block = blocks?.find((item) => item.kind === "sources");
  return block?.kind === "sources" ? block.items : [];
}

/** One source is already a pill, so the row starts at two. */
export function showSourcesRow(count: number): boolean {
  return count > 1;
}

/** The group a `rakazo-cite:<index>` link draws, if this href is one. */
export function citationGroupIndex(href: string | undefined): number | undefined {
  if (!href?.startsWith(CITATION_URL_PREFIX)) return undefined;
  const raw = href.slice(CITATION_URL_PREFIX.length);
  if (!/^\d+$/.test(raw)) return undefined;
  const index = Number(raw);
  return index <= Number.MAX_SAFE_INTEGER ? index : undefined;
}

type Replacement = { start: number; end: number; index: number; site: string };

function nodeRange(node: MdNode): { start: number; end: number } | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof start !== "number" || typeof end !== "number" || end < start) return undefined;
  return { start, end };
}

function isJoiningGap(node: MdNode): boolean {
  return (
    node.type === "text" &&
    typeof node.value === "string" &&
    JOINING_GAP.test(node.value) &&
    !SENTENCE_END.test(node.value)
  );
}

/**
 * Whether citations end their claim here: at the end of the line or before punctuation. A link
 * the sentence reads on through ("see [the analysis](…) for details") keeps its words.
 */
function endsClaim(following: MdNode | undefined): boolean {
  if (!following || following.type === "break") return true;
  return following.type === "text" && TRAILING_TEXT.test(following.value ?? "");
}

/** Letters and digits only, lowercased, so "BBC News" and "bbc-news" compare equal. */
function labelKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function nodeText(node: MdNode): string {
  return node.value ?? (node.children ?? []).map(nodeText).join("");
}

function hostKey(url: string): string {
  try {
    return labelKey(new URL(url).hostname);
  } catch {
    return "";
  }
}

/**
 * Whether a link's words name its page (the site, its address, a part of its title or a footnote
 * number) rather than carry the claim. Only those become a pill, so a claim keeps its words.
 */
function namesSource(node: MdNode, url: string, item: SourceItem): boolean {
  const key = labelKey(nodeText(node));
  if (!key || /^\d+$/.test(key)) return true;
  const site = labelKey(item.site);
  if (key === site || (key.length >= 3 && site.startsWith(key))) return true;
  if (key.includes(site) && hostKey(url).endsWith(key)) return true;
  return item.title.split(TITLE_PARTS).some((part) => labelKey(part) === key);
}

/** A recorded-source link, whether or not its words name the page. */
function recordedLinkUrl(
  node: MdNode,
  byUrl: ReadonlyMap<string, SourceItem>,
  definitions: ReadonlyMap<string, string>,
): string | undefined {
  return matchingUrl(node, byUrl, definitions);
}

function namesRecordedSource(
  node: MdNode,
  url: string,
  byUrl: ReadonlyMap<string, SourceItem>,
): boolean {
  const item = byUrl.get(url);
  return item ? namesSource(node, url, item) : false;
}

/**
 * The text immediately before this node already ended a sentence ("…in 2031. [NASA, 16 November]").
 * A link the next words read through is not in that position.
 */
function sentenceEndedBefore(children: readonly MdNode[], start: number): boolean {
  for (let index = start - 1; index >= 0; index -= 1) {
    const node = children[index];
    if (!node || node.type === "break") continue;
    if (node.type !== "text") return false;
    const value = node.value ?? "";
    if (value.trim() === "") continue;
    return SENTENCE_ENDED.test(value.trimEnd());
  }
  return false;
}

/**
 * Nothing but the line's end follows. One link after a sentence that ends in its own full stop is a
 * sentence of its own ("Budget news. [The agency cancels it](…)."), so it keeps its words.
 */
function endsLine(following: MdNode | undefined): boolean {
  if (!following || following.type === "break") return true;
  return following.type === "text" && /^[ \t]*(?:\n|$)/u.test(following.value ?? "");
}

/** The run is the whole content of one parenthesis, as in "was cut ([Space.com, 11 November])." */
function parenWraps(children: readonly MdNode[], start: number, next: number): boolean {
  const before = children[start - 1];
  const after = children[next];
  return (
    before?.type === "text" &&
    /\(\s*$/u.test(before.value ?? "") &&
    after?.type === "text" &&
    /^\s*\)/u.test(after.value ?? "")
  );
}

/**
 * The claim ends after the closing parenthesis. The parenthesis itself is not the ending: "…) and
 * more" keeps the link, while "…)." is a citation.
 */
function claimEndedAfterParen(following: MdNode | undefined): boolean {
  if (following?.type !== "text") return false;
  const rest = (following.value ?? "").replace(/^\s*\)/u, "");
  return TRAILING_TEXT.test(rest);
}

function markdownLinkLabel(label: string): string {
  return label.replace(/[\\[\]]/g, (character) => `\\${character}`);
}

function sourcesByUrl(sources: readonly SourceItem[]): Map<string, SourceItem> {
  const map = new Map<string, SourceItem>();
  for (const item of sources) {
    const url = normalizedHttpUrl(item.url);
    if (url && !map.has(url)) map.set(url, item);
  }
  return map;
}

type RunEntry = { node: MdNode; url: string };

function gatherRun(
  children: readonly MdNode[],
  start: number,
  accept: (node: MdNode, url: string) => boolean,
  byUrl: ReadonlyMap<string, SourceItem>,
  definitions: ReadonlyMap<string, string>,
): { run: RunEntry[]; next: number } {
  const first = children[start];
  const firstUrl = first ? recordedLinkUrl(first, byUrl, definitions) : undefined;
  if (!first || !firstUrl || !accept(first, firstUrl)) return { run: [], next: start };
  const run: RunEntry[] = [{ node: first, url: firstUrl }];
  let next = start + 1;
  while (next < children.length) {
    const candidate = children[next];
    if (!candidate) break;
    const nextUrl = recordedLinkUrl(candidate, byUrl, definitions);
    if (nextUrl && accept(candidate, nextUrl)) {
      run.push({ node: candidate, url: nextUrl });
      next += 1;
      continue;
    }
    if (!isJoiningGap(candidate)) break;
    let after = next + 1;
    while (after < children.length && children[after] && isJoiningGap(children[after]!)) {
      after += 1;
    }
    const following = children[after];
    const followingUrl = following ? recordedLinkUrl(following, byUrl, definitions) : undefined;
    if (!following || !followingUrl || !accept(following, followingUrl)) break;
    run.push({ node: following, url: followingUrl });
    next = after + 1;
  }
  return { run, next };
}

/**
 * A cluster is a citation when every link names its page and the claim ends, or — whatever the
 * words say — when it sits after the sentence or is the parenthesis at the end of the claim.
 */
function isCitationRun(
  run: readonly RunEntry[],
  children: readonly MdNode[],
  start: number,
  next: number,
  byUrl: ReadonlyMap<string, SourceItem>,
): boolean {
  const after = children[next];
  if (run.every((entry) => namesRecordedSource(entry.node, entry.url, byUrl)) && endsClaim(after)) {
    return true;
  }
  // Several links joined by "·" or commas can't be one claim, so they may end in a full stop too.
  const ended = endsLine(after) || (run.length > 1 && endsClaim(after));
  if (sentenceEndedBefore(children, start) && ended) return true;
  return parenWraps(children, start, next) && claimEndedAfterParen(after);
}

function emitRun(
  run: readonly RunEntry[],
  byUrl: ReadonlyMap<string, SourceItem>,
  groups: CitationGroup[],
  replacements: Replacement[],
) {
  const start = nodeRange(run[0]?.node ?? { type: "text" });
  const end = nodeRange(run[run.length - 1]?.node ?? { type: "text" });
  if (!start || !end) return;
  const items: SourceItem[] = [];
  const seen = new Set<string>();
  for (const entry of run) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    const item = byUrl.get(entry.url);
    if (item) items.push(item);
  }
  const first = items[0];
  if (!first) return;
  const groupIndex = groups.length;
  groups.push({ index: groupIndex, items });
  replacements.push({ start: start.start, end: end.end, index: groupIndex, site: first.site });
}

function groupChildren(
  children: readonly MdNode[],
  byUrl: ReadonlyMap<string, SourceItem>,
  definitions: ReadonlyMap<string, string>,
  groups: CitationGroup[],
  replacements: Replacement[],
) {
  let index = 0;
  while (index < children.length) {
    const child = children[index];
    if (!child) break;
    const url = recordedLinkUrl(child, byUrl, definitions);
    if (!url) {
      if (child.type !== "link" && child.type !== "linkReference" && child.children) {
        groupChildren(child.children, byUrl, definitions, groups, replacements);
      }
      index += 1;
      continue;
    }
    const recorded = gatherRun(children, index, () => true, byUrl, definitions);
    if (isCitationRun(recorded.run, children, index, recorded.next, byUrl)) {
      emitRun(recorded.run, byUrl, groups, replacements);
      index = recorded.next;
      continue;
    }
    // A trailing named link must still pill when an earlier claim-link made the whole run fail.
    if (namesRecordedSource(child, url, byUrl)) {
      const named = gatherRun(
        children,
        index,
        (node, linkUrl) => namesRecordedSource(node, linkUrl, byUrl),
        byUrl,
        definitions,
      );
      if (named.run.length > 0 && endsClaim(children[named.next])) {
        emitRun(named.run, byUrl, groups, replacements);
        index = named.next;
        continue;
      }
    }
    index += 1;
  }
}

/**
 * Rewrite cited links into one `rakazo-cite:` marker per adjacent cluster. A recorded source is a
 * citation when its words name the page, when it sits after the sentence, or when it is the
 * parenthesis at the end of the claim. A link the sentence reads through stays as written.
 */
export function citationMarkdown(
  markdown: string,
  sources: readonly SourceItem[],
): { markdown: string; groups: CitationGroup[] } {
  if (!markdown || sources.length === 0) return { markdown, groups: [] };
  const tree = parseMarkdown(markdown);
  if (!tree?.children) return { markdown, groups: [] };
  const groups: CitationGroup[] = [];
  const replacements: Replacement[] = [];
  groupChildren(tree.children, sourcesByUrl(sources), definitionUrls(tree), groups, replacements);
  if (replacements.length === 0) return { markdown, groups };
  replacements.sort((left, right) => right.start - left.start);
  let next = markdown;
  for (const replacement of replacements) {
    const marker = `[${markdownLinkLabel(replacement.site)}](${CITATION_URL_PREFIX}${replacement.index})`;
    // The pill is its own bracket, so "claim ([NASA](…))" drops the parentheses around it.
    const wrapped = next[replacement.start - 1] === "(" && next[replacement.end] === ")";
    const start = wrapped ? replacement.start - 1 : replacement.start;
    const end = wrapped ? replacement.end + 1 : replacement.end;
    next = `${next.slice(0, start)}${marker}${next.slice(end)}`;
  }
  return { markdown: next.replace(PILL_PUNCTUATION_GAP, "$1"), groups };
}

/** Streaming text stays as written: a pill would jump while the link is still arriving. */
export function preparedCitationMarkdown(
  markdown: string,
  sources: readonly SourceItem[] | undefined,
  streaming: boolean,
): { markdown: string; groups: CitationGroup[] } {
  if (streaming || !sources?.length) return { markdown, groups: [] };
  return citationMarkdown(markdown, sources);
}
