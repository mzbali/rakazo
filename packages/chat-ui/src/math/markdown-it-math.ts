import { createMathScanner } from "@rakazo/core/math-delimiters";
import type { createMarkdownIt } from "@ronradtke/react-native-markdown-display";

/** The parts of markdown-it's inline state this rule reads and writes. */
type InlineState = {
  src: string;
  pos: number;
  posMax: number;
  push(type: string, tag: string, nesting: number): { content: string; markup: string };
};

const BACKSLASH = 0x5c;
const DOLLAR = 0x24;

/** Token types the rule produces; the render rules take these names. */
export const MATH_INLINE = "math_inline";
export const MATH_DISPLAY = "math_display";

/**
 * `$$…$$`, `\[…\]` and `\(…\)` become `math_display` and `math_inline` tokens holding the TeX; see
 * `createMathScanner` for the rules. It runs before the escape rule, which would otherwise take
 * the backslash of `\(` and `\[`.
 */
export function markMath(parser: ReturnType<typeof createMarkdownIt>) {
  // The scanner remembers what it has searched for one inline text, so it lives as long as that
  // text's state.
  const scanners = new WeakMap<object, ReturnType<typeof createMathScanner>>();
  parser.inline.ruler.before("escape", "rk_math", (state: InlineState, silent: boolean) => {
    const code = state.src.charCodeAt(state.pos);
    if (code !== BACKSLASH && code !== DOLLAR) return false;
    let scan = scanners.get(state);
    if (!scan) {
      scan = createMathScanner(state.src, state.posMax);
      scanners.set(state, scan);
    }
    const match = scan(state.pos);
    if (!match) return false;
    if (!silent) {
      const token = state.push(match.display ? MATH_DISPLAY : MATH_INLINE, "", 0);
      token.content = match.tex;
      token.markup = state.src.slice(state.pos, state.pos + 2);
    }
    state.pos = match.end;
    return true;
  });
}
