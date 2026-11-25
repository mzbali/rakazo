/// <reference path="./sucrase-parser.d.ts" />
import { parse } from "sucrase/dist/parser/index.js";
import { TokenType } from "sucrase/dist/parser/tokenizer/types.js";
import { PAGE_KIT_COMPONENTS } from "./components.js";

const KIT_NAMES: ReadonlySet<string> = new Set(PAGE_KIT_COMPONENTS);

/**
 * The kit components a page or visual draws, in the order they first appear, read from its JSX
 * tags. Source that does not parse uses none.
 */
export function kitComponentsUsed(source: string): string[] {
  let tokens: ReturnType<typeof parse>["tokens"];
  try {
    ({ tokens } = parse(source, true, false, false));
  } catch {
    return [];
  }
  const used = new Set<string>();
  for (const [index, token] of tokens.entries()) {
    const name = tokens[index + 1];
    if (token.type !== TokenType.jsxTagStart || name?.type !== TokenType.jsxName) continue;
    const text = source.slice(name.start, name.end);
    if (KIT_NAMES.has(text)) used.add(text);
  }
  return [...used];
}
