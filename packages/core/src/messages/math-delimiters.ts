/** A formula found in message text: where it ends, its TeX, and whether it gets its own line. */
export type MathMatch = { end: number; tex: string; display: boolean };

type Kind = "dollars" | "bracket" | "paren";

const BACKSLASH = 92;
const DOLLAR = 36;
const OPEN_PAREN = 40;
const CLOSE_PAREN = 41;
const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;

/**
 * Finds formulas written `$$…$$` and `\[…\]` (display) or `\(…\)` (inline). A single `$` is never
 * maths, so "$5 to $10" stays text. The source decides: an opener with no closer before `limit`
 * stays text, so an open `$$` while a reply streams cannot swallow what follows it. A backslash
 * keeps the character after it out of delimiter matching, so `\$` and `\\)` close nothing.
 *
 * The returned function takes the index of a possible opener. It remembers where a search ran to
 * the end without finding a closer, so a run of unclosed openers is read once, not once each.
 */
export function createMathScanner(
  source: string,
  limit = source.length,
): (start: number) => MathMatch | undefined {
  const noCloserFrom: Partial<Record<Kind, number>> = {};
  return (start) => {
    const first = source.charCodeAt(start);
    const second = source.charCodeAt(start + 1);
    let kind: Kind;
    if (first === DOLLAR && second === DOLLAR) kind = "dollars";
    else if (first === BACKSLASH && second === OPEN_BRACKET) kind = "bracket";
    else if (first === BACKSLASH && second === OPEN_PAREN) kind = "paren";
    else return undefined;
    if (start + 2 > limit) return undefined;
    if (kind === "dollars" && source.charCodeAt(start + 2) === DOLLAR) return undefined;
    const failedFrom = noCloserFrom[kind];
    if (failedFrom !== undefined && start >= failedFrom) return undefined;

    const closer = kind === "bracket" ? CLOSE_BRACKET : CLOSE_PAREN;
    for (let index = start + 2; index < limit; index++) {
      const code = source.charCodeAt(index);
      if (code === BACKSLASH) {
        if (kind !== "dollars" && index + 1 < limit && source.charCodeAt(index + 1) === closer) {
          return closed(source, start, index, kind);
        }
        index++;
      } else if (
        kind === "dollars" &&
        code === DOLLAR &&
        index + 1 < limit &&
        source.charCodeAt(index + 1) === DOLLAR
      ) {
        return closed(source, start, index, kind);
      }
    }
    noCloserFrom[kind] = start;
    return undefined;
  };
}

function closed(source: string, start: number, close: number, kind: Kind): MathMatch | undefined {
  const tex = source.slice(start + 2, close).trim();
  if (tex === "") return undefined;
  return { end: close + 2, tex, display: kind !== "paren" };
}
