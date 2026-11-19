import { VISUAL_CODE_MAX_BYTES } from "@rakazo/contracts";
import {
  checkVisualTag,
  holdsVisualElements,
  isVisualTag,
  visualContent,
} from "./visual-catalog.js";
import type { VisualObject, VisualValue } from "./visual-literal.js";
import { literalEnd, parseVisualLiteral } from "./visual-literal.js";

/**
 * `complete` once its closing tag or `/>` has arrived and its props check out; `open` while more
 * may come; `invalid` when it is closed but cannot be drawn.
 */
export type VisualElement = {
  /** The path of opening tags that leads here, so it never changes as more text arrives. */
  key: string;
  tag: string;
  props: VisualObject;
  /** Plain text between the tags, whitespace collapsed the way JSX does. */
  text: string;
  children: VisualElement[];
  state: "open" | "complete" | "invalid";
  reason?: string;
};

export type VisualParse = {
  /** The `<Visual>`; undefined when the fence is not one, and then it stays a code block. */
  root: VisualElement | undefined;
  /** The scan stopped inside a tag, or an element that draws whole is still open. */
  tail: boolean;
  /** The fence is longer than `VISUAL_CODE_MAX_BYTES`; only the first part was read. */
  truncated: boolean;
};

const MAX_TABS = 8;
const UPPER = /[A-Z]/;
const NAME_PART = /[A-Za-z0-9]/;
const ATTR_START = /[A-Za-z_]/;
const ATTR_PART = /[A-Za-z0-9_-]/;
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const ENTITY = /&(lt|gt|amp|quot);/g;
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"' };

/** `&lt; &gt; &amp; &quot;` as written characters; nothing else is decoded. */
export function decodeVisualEntities(text: string): string {
  return text.includes("&") ? text.replace(ENTITY, (_all, name: string) => ENTITIES[name]!) : text;
}

/** Text between tags: lines trimmed, blank lines dropped, joined by one space, as in JSX. */
function collapse(raw: string): string {
  return decodeVisualEntities(
    raw
      .split("\n")
      .map((line) => line.trim().replace(/[ \t]+/g, " "))
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * How many leading characters fit in `max` UTF-8 bytes. It stops counting as soon as the next one
 * does not, so a huge source costs no more than `max` bytes of scanning.
 */
function bytePrefixLength(text: string, max: number): number {
  let bytes = 0;
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    // A surrogate pair is one character of four bytes; a lone surrogate encodes as three.
    const pair = code >= 0xd800 && code < 0xdc00 && (text.charCodeAt(at + 1) & 0xfc00) === 0xdc00;
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : pair ? 4 : 3;
    if (bytes + size > max) return at;
    bytes += size;
    if (pair) at++;
  }
  return text.length;
}

type Tag = { name: string; attrs: string; selfClosing: boolean; end: number };

/** The tag that starts at `at` (a `<` and a capital letter), or undefined while it is unfinished. */
function scanTag(source: string, at: number): Tag | undefined {
  let end = at + 1;
  while (end < source.length && NAME_PART.test(source[end]!)) end++;
  const name = source.slice(at + 1, end);
  const attrsFrom = end;
  while (end < source.length) {
    const char = source[end]!;
    if (char === '"') {
      const close = source.indexOf('"', end + 1);
      if (close < 0) return undefined;
      end = close + 1;
    } else if (char === "{") {
      const close = literalEnd(source, end);
      if (close < 0) return undefined;
      end = close + 1;
    } else if (char === ">") {
      return { name, attrs: source.slice(attrsFrom, end), selfClosing: false, end: end + 1 };
    } else if (char === "/" && source[end + 1] === ">") {
      return { name, attrs: source.slice(attrsFrom, end), selfClosing: true, end: end + 2 };
    } else end++;
  }
  return undefined;
}

/** The props written in a tag, or why they cannot be read. */
function readAttrs(raw: string): { props: VisualObject } | { error: string } {
  const props: VisualObject = {};
  let at = 0;
  while (at < raw.length) {
    const char = raw[at]!;
    if (/\s/.test(char)) {
      at++;
      continue;
    }
    if (!ATTR_START.test(char)) return { error: "a prop must be written name=value" };
    const from = at;
    while (at < raw.length && ATTR_PART.test(raw[at]!)) at++;
    const name = raw.slice(from, at);
    if (
      /^on[A-Z]/.test(name) ||
      name === "key" ||
      name === "ref" ||
      name === "dangerouslySetInnerHTML"
    )
      return { error: `${name} is not allowed` };
    if (raw[at] !== "=") {
      props[name] = true;
      continue;
    }
    at++;
    const first = raw[at];
    let value: VisualValue;
    if (first === '"') {
      const close = raw.indexOf('"', at + 1);
      value = decodeVisualEntities(raw.slice(at + 1, close));
      at = close + 1;
    } else if (first === "{") {
      const close = literalEnd(raw, at);
      const literal = parseVisualLiteral(raw.slice(at + 1, close));
      if (!literal) return { error: `${name} must be a literal, not an expression` };
      value = literal.value;
      at = close + 1;
    } else {
      const number = NUMBER.exec(raw.slice(at, at + 40));
      if (number) {
        value = Number(number[0]);
        at += number[0].length;
      } else if (raw.startsWith("true", at) || raw.startsWith("false", at)) {
        value = raw[at] === "t";
        at += value ? 4 : 5;
      } else return { error: `${name} needs a "string", a number, true, false or {literal}` };
    }
    if (Object.hasOwn(props, name) || name === "__proto__") return { error: `${name} is repeated` };
    props[name] = value;
  }
  return { props };
}

type Frame = { element: VisualElement; raw: string; count: number };

/** Whether the element is a tag that holds elements; an unknown tag is not drawn at all. */
const holdsElements = (element: VisualElement) => holdsVisualElements(element.tag);

function parse(source: string): VisualParse {
  const stack: Frame[] = [];
  let root: VisualElement | undefined;
  let tail = false;
  let rootDone = false;

  /** Closes the frame on top: leaves it `invalid` when its tag or body cannot be drawn. */
  const settle = (frame: Frame) => {
    const { element } = frame;
    if (element.state !== "open") return;
    if (!isVisualTag(element.tag)) return;
    const body = collapse(frame.raw);
    const checked = checkVisualTag(element.tag, element.props, body);
    if ("error" in checked) {
      element.state = "invalid";
      element.reason = checked.error;
    } else {
      element.props = checked.props;
      element.text = body;
      element.state = "complete";
    }
  };

  const open = (tag: Tag): VisualElement | undefined => {
    const parent = stack.at(-1);
    const element: VisualElement = {
      key: parent ? `${parent.element.key}.${parent.count++}` : "0",
      tag: tag.name,
      props: {},
      text: "",
      children: [],
      state: "open",
    };
    if (!parent) {
      if (tag.name !== "Visual") return undefined;
      root = element;
    } else parent.element.children.push(element);
    const reject = (reason: string) => {
      element.state = "invalid";
      element.reason = reason;
    };
    const attrs = readAttrs(tag.attrs);
    if (!isVisualTag(tag.name)) reject(`${tag.name} is not a known tag`);
    else if ("error" in attrs) reject(attrs.error);
    else if (tag.name === "Visual" && parent) reject("Visual is the root only");
    else if (tag.name === "Grid" && stack.some((frame) => frame.element.tag === "Grid"))
      reject("Grid does not nest");
    else if (tag.name === "Tab" && parent?.element.tag !== "Tabs") reject("Tab goes inside Tabs");
    else if (parent?.element.tag === "Tabs" && tag.name !== "Tab") reject("Tabs holds only Tab");
    else if (tag.name === "Tabs" && stack.some((frame) => frame.element.tag === "Tabs"))
      reject("Tabs does not nest");
    else if (tag.name === "Tab" && parent!.count > MAX_TABS)
      reject(`a Tabs holds at most ${MAX_TABS} tabs`);
    else if (parent && !holdsElements(parent.element))
      reject(`${parent.element.tag} holds no elements`);
    else {
      element.props = attrs.props;
      // A tag that holds elements is checked now, so its children can draw while it is open.
      if (visualContent(tag.name) === "elements") {
        const checked = checkVisualTag(tag.name, element.props, "");
        if ("error" in checked) reject(checked.error);
        else element.props = checked.props;
      }
    }
    return element;
  };

  let at = 0;
  const hold = (until: number) => {
    const top = stack.at(-1);
    if (top) top.raw += source.slice(at, until);
    else if (source.slice(at, until).trim()) rootDone = true; // prose before the root: not a visual
  };

  while (at < source.length && !rootDone) {
    const lt = source.indexOf("<", at);
    hold(lt < 0 ? source.length : lt);
    if (rootDone || lt < 0) break;
    const next = source[lt + 1];
    if (next === undefined) {
      tail = true;
      break;
    }
    if (next === "/") {
      let end = lt + 2;
      while (end < source.length && NAME_PART.test(source[end]!)) end++;
      const name = source.slice(lt + 2, end);
      let after = end;
      while (source[after] === " " || source[after] === "\t") after++;
      if (after >= source.length && name) {
        tail = true;
        break;
      }
      if (name && source[after] === ">") {
        let found = stack.length - 1;
        while (found >= 0 && stack[found]!.element.tag !== name) found--;
        if (found >= 0) {
          while (stack.length - 1 > found) {
            const lost = stack.pop()!.element;
            lost.state = "invalid";
            lost.reason = `${lost.tag} is not closed`;
          }
          settle(stack.pop()!);
          if (stack.length === 0) rootDone = true;
        }
        at = after + 1;
        continue;
      }
      const top = stack.at(-1);
      if (top) top.raw += "<";
      else rootDone = true;
      at = lt + 1;
      continue;
    }
    if (!UPPER.test(next)) {
      const top = stack.at(-1);
      if (top) top.raw += "<";
      else rootDone = true;
      at = lt + 1;
      continue;
    }
    const tag = scanTag(source, lt);
    if (!tag) {
      tail = true;
      break;
    }
    const element = open(tag);
    if (!element) {
      root = undefined;
      break;
    }
    const frame: Frame = { element, raw: "", count: 0 };
    if (tag.selfClosing) {
      settle(frame);
      if (!stack.length) rootDone = true;
    } else stack.push(frame);
    at = tag.end;
  }
  const top = stack.at(-1);
  // A tag that draws whole cannot show before its closer; only a container's children can.
  if (top && !holdsElements(top.element)) tail = true;
  return { root, tail, truncated: false };
}

const cache = new Map<string, VisualParse>();
const CACHE_ENTRIES = 24;

/**
 * Reads a ```ui fence body in one forward pass, whole or cut anywhere, without repairing it:
 * a closing tag that has not arrived is never invented. Cached per body, so redrawing the same
 * reply costs nothing.
 */
export function parseVisualFence(source: string): VisualParse {
  // Only the first 32 KB is ever read, so only that much is measured, hashed and kept.
  const fits =
    source.length <= VISUAL_CODE_MAX_BYTES &&
    (source.length * 3 <= VISUAL_CODE_MAX_BYTES ||
      bytePrefixLength(source, VISUAL_CODE_MAX_BYTES) === source.length);
  // A cut tag is just an unfinished tag, so what has drawn does not change.
  const body = fits
    ? source
    : source.slice(
        0,
        bytePrefixLength(source.slice(0, VISUAL_CODE_MAX_BYTES), VISUAL_CODE_MAX_BYTES),
      );
  const key = `${fits ? "=" : "!"}${body}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result: VisualParse = { ...parse(body), truncated: !fits };
  if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
