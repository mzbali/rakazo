/** A literal a prop can hold: the data subset of JSON5, never an expression. */
export type VisualValue = string | number | boolean | null | VisualValue[] | VisualObject;
export type VisualObject = { [key: string]: VisualValue };

const MAX_DEPTH = 8;
const MAX_NODES = 2000;
const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  "\\": "\\",
  "'": "'",
  '"': '"',
  "/": "/",
};

class Reject extends Error {}

/**
 * Where the `{` at `start` closes, skipping strings, or -1 when the text ends first. One pass:
 * a `>` or `}` inside a quoted string never counts.
 */
export function literalEnd(text: string, start: number): number {
  let depth = 0;
  for (let at = start; at < text.length; at++) {
    const char = text[at]!;
    if (char === '"' || char === "'") {
      for (at++; at < text.length && text[at] !== char; at++) if (text[at] === "\\") at++;
      if (at >= text.length) return -1;
    } else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return at;
  }
  return -1;
}

class Reader {
  private at = 0;
  private nodes = 0;
  constructor(private readonly text: string) {}

  done(): boolean {
    this.space();
    return this.at >= this.text.length;
  }

  private space() {
    while (this.at < this.text.length && /\s/.test(this.text[this.at]!)) this.at++;
  }

  value(depth: number): VisualValue {
    if (++this.nodes > MAX_NODES || depth > MAX_DEPTH) throw new Reject();
    this.space();
    const char = this.text[this.at];
    if (char === "{") return this.object(depth);
    if (char === "[") return this.array(depth);
    if (char === '"' || char === "'") return this.string();
    const number = NUMBER.exec(this.text.slice(this.at, this.at + 40));
    if (number) {
      this.at += number[0].length;
      return Number(number[0]);
    }
    const word = this.word();
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    throw new Reject();
  }

  private word(): string {
    const from = this.at;
    while (this.at < this.text.length && IDENT_PART.test(this.text[this.at]!)) this.at++;
    return this.text.slice(from, this.at);
  }

  private string(): string {
    const quote = this.text[this.at++]!;
    let out = "";
    while (this.at < this.text.length) {
      const char = this.text[this.at++]!;
      if (char === quote) return out;
      if (char !== "\\") {
        out += char;
        continue;
      }
      const next = this.text[this.at++];
      if (next === "u") {
        const hex = this.text.slice(this.at, this.at + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Reject();
        out += String.fromCharCode(Number.parseInt(hex, 16));
        this.at += 4;
      } else if (next !== undefined && Object.hasOwn(ESCAPES, next)) out += ESCAPES[next];
      else throw new Reject();
    }
    throw new Reject();
  }

  private array(depth: number): VisualValue[] {
    this.at++;
    const items: VisualValue[] = [];
    for (;;) {
      this.space();
      if (this.text[this.at] === "]") {
        this.at++;
        return items;
      }
      items.push(this.value(depth + 1));
      this.space();
      if (this.text[this.at] === ",") this.at++;
      else if (this.text[this.at] !== "]") throw new Reject();
    }
  }

  private object(depth: number): VisualObject {
    this.at++;
    const entries: VisualObject = {};
    for (;;) {
      this.space();
      if (this.text[this.at] === "}") {
        this.at++;
        return entries;
      }
      const char = this.text[this.at];
      const key =
        char === '"' || char === "'"
          ? this.string()
          : char !== undefined && IDENT_START.test(char)
            ? this.word()
            : undefined;
      if (key === undefined || BAD_KEYS.has(key)) throw new Reject();
      this.space();
      if (this.text[this.at++] !== ":") throw new Reject();
      entries[key] = this.value(depth + 1);
      this.space();
      if (this.text[this.at] === ",") this.at++;
      else if (this.text[this.at] !== "}") throw new Reject();
    }
  }
}

/**
 * The value written in a prop's `{…}`: literals only, so a call, an arrow function, a variable
 * or a spread rejects the element. Undefined when `text` is not such a literal.
 */
export function parseVisualLiteral(text: string): { value: VisualValue } | undefined {
  const reader = new Reader(text);
  try {
    const value = reader.value(0);
    return reader.done() ? { value } : undefined;
  } catch (error) {
    if (error instanceof Reject) return undefined;
    throw error;
  }
}
