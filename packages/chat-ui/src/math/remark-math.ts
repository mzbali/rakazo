import { createMathScanner } from "@rakazo/core/math-delimiters";
import type { Extension as FromMarkdownExtension } from "mdast-util-from-markdown";
import type { Code, Extension, State, TokenizeContext, Tokenizer } from "micromark-util-types";
import type { Plugin } from "unified";

const BACKSLASH = 92;
const DOLLAR = 36;
const OPEN_PAREN = 40;
const CLOSE_PAREN = 41;
const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;
// micromark's codes for a tab, a space made from a tab, and the three line endings.
const BLANK_CODES = new Set<Code>([-5, -4, -3, -2, -1, 32]);

declare module "micromark-util-types" {
  interface TokenTypeMap {
    rkMath: "rkMath";
    rkMathData: "rkMathData";
  }
}

const TOKEN = "rkMath";
const DATA = "rkMathData";

/** The class on a formula's `<span>`; a display formula adds `DISPLAY_CLASS`. */
export const MATH_CLASS = "rk-math";
export const DISPLAY_CLASS = "rk-math-display";

type Kind = "dollars" | "bracket" | "paren";

// Where a search for a closer ran off the end of its text, per parse and kind. Any later opener
// of that kind inside the same text finds no closer either, so a run of unclosed openers is read
// once instead of once each.
const noCloser = new WeakMap<object, Map<Kind, { from: number; to: number }>>();

function failedBefore(context: TokenizeContext, kind: Kind) {
  const failed = noCloser.get(context.parser)?.get(kind);
  const offset = context.now().offset;
  return failed !== undefined && offset >= failed.from && offset <= failed.to;
}

function rememberFailure(context: TokenizeContext, kind: Kind, from: number) {
  const kinds = noCloser.get(context.parser) ?? new Map();
  noCloser.set(context.parser, kinds);
  kinds.set(kind, { from, to: context.now().offset });
}

/** One construct for all three delimiters; `kind` is what the opener says it is. */
function tokenizer(first: number): Tokenizer {
  return function tokenizeMath(effects, ok, nok) {
    const self = this;
    let kind: Kind;
    let from = 0;
    let hasText = false;
    let nonBlank = 0;
    let lastNonBlank: Code = null;

    // A line ending is a token of its own, so the text stays a run of tokens that end at it.
    function eat(code: Code) {
      if (code !== null && code < -2) {
        effects.exit(DATA);
        effects.enter("lineEnding");
        effects.consume(code);
        effects.exit("lineEnding");
        effects.enter(DATA);
      } else {
        effects.consume(code);
      }
    }

    function start(code: Code): State | undefined {
      effects.enter(TOKEN);
      effects.enter(DATA);
      effects.consume(code);
      return opener;
    }

    function opener(code: Code): State | undefined {
      if (first === DOLLAR && code === DOLLAR) kind = "dollars";
      else if (first === BACKSLASH && code === OPEN_PAREN) kind = "paren";
      else if (first === BACKSLASH && code === OPEN_BRACKET) kind = "bracket";
      else return nok(code);
      if (failedBefore(self, kind)) return nok(code);
      from = self.now().offset;
      eat(code);
      return kind === "dollars" ? afterDollars : body;
    }

    // "$$$" opens nothing, as in the scanner.
    function afterDollars(code: Code): State | undefined {
      return code === DOLLAR ? nok(code) : body(code);
    }

    function body(code: Code): State | undefined {
      if (code === null) {
        rememberFailure(self, kind, from);
        return nok(code);
      }
      if (code === BACKSLASH) {
        eat(code);
        return escaped;
      }
      if (kind === "dollars" && code === DOLLAR) {
        eat(code);
        return secondDollar;
      }
      return content(code);
    }

    function note(code: Code) {
      if (BLANK_CODES.has(code)) return;
      hasText = true;
      nonBlank++;
      lastNonBlank = code;
    }

    function content(code: Code): State | undefined {
      note(code);
      eat(code);
      return body;
    }

    function secondDollar(code: Code): State | undefined {
      if (code === DOLLAR) return close(code);
      // A lone $ is part of the formula.
      hasText = true;
      return body(code);
    }

    // A backslash keeps the next character out of delimiter matching, except to close `\(` or `\[`.
    function escaped(code: Code): State | undefined {
      if (code === null) {
        rememberFailure(self, kind, from);
        return nok(code);
      }
      if (
        (kind === "paren" && code === CLOSE_PAREN) ||
        (kind === "bracket" && code === CLOSE_BRACKET)
      ) {
        return close(code);
      }
      note(BACKSLASH);
      note(code);
      eat(code);
      return body;
    }

    function close(code: Code): State | undefined {
      if (!hasText) return nok(code);
      // `\[x\]` stays literal, as in the scanner.
      if (kind === "bracket" && nonBlank === 1 && (lastNonBlank === 120 || lastNonBlank === 88)) {
        return nok(code);
      }
      eat(code);
      effects.exit(DATA);
      effects.exit(TOKEN);
      return ok;
    }

    return start;
  };
}

const syntax: Extension = {
  text: {
    [BACKSLASH]: { name: TOKEN, tokenize: tokenizer(BACKSLASH), add: "before" },
    [DOLLAR]: { name: TOKEN, tokenize: tokenizer(DOLLAR), add: "before" },
  },
};

/** The formula inside its delimiters, and whether it is a display formula. */
function parseMath(raw: string): { tex: string; display: boolean } {
  const match = createMathScanner(raw)(0);
  return { tex: match?.tex ?? raw, display: match?.display ?? false };
}

const fromMarkdown: FromMarkdownExtension = {
  enter: {
    [TOKEN](token) {
      const { tex, display } = parseMath(this.sliceSerialize(token));
      // Not a node type remark knows: it draws as the span named in `data`.
      this.enter(
        {
          type: TOKEN,
          value: tex,
          data: {
            hName: "span",
            hProperties: { className: display ? [MATH_CLASS, DISPLAY_CLASS] : [MATH_CLASS] },
            hChildren: [{ type: "text", value: tex }],
          },
        } as never,
        token,
      );
    },
  },
  exit: {
    [TOKEN](token) {
      this.exit(token);
    },
  },
};

/** `$$…$$`, `\[…\]` and `\(…\)` become formulas; see `createMathScanner` for the rules. */
export const remarkMath: Plugin<[]> = function remarkMath() {
  const data = this.data() as {
    micromarkExtensions?: Extension[];
    fromMarkdownExtensions?: FromMarkdownExtension[];
  };
  data.micromarkExtensions = [...(data.micromarkExtensions ?? []), syntax];
  data.fromMarkdownExtensions = [...(data.fromMarkdownExtensions ?? []), fromMarkdown];
};
