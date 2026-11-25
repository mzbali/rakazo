/// <reference path="./sucrase-parser.d.ts" />
import { parse } from "sucrase/dist/parser/index.js";
import { IdentifierRole } from "sucrase/dist/parser/tokenizer/index.js";
import { TokenType } from "sucrase/dist/parser/tokenizer/types.js";

type Reference = { start: number; end: number; place: number };
const IMAGE_SOURCE_KEYS = new Set(["src", "image", "poster"]);
const COMPONENT_IMAGE_PROPS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Image", new Set(["src"])],
  ["Video", new Set(["poster"])],
  ["ProductCard", new Set(["image", "photos"])],
]);

/**
 * Find literal image sources after JSX becomes props. The same keys are used in data
 * objects for Gallery, PhotoStrip and ProductRows. ProductCard also takes a photos array
 * of source strings. Values elsewhere, including text children and captions, are untouched.
 */
export function visualImageReferences(code: string) {
  const { tokens } = parse(code, false, false, false);
  const references: Reference[] = [];
  let malformed = false;
  function read(index: number) {
    const token = tokens[index]!;
    if (token.type !== TokenType.string) return;
    const source = code.slice(token.start + 1, token.end - 1);
    if (!/^rakazo-image:/i.test(source)) return;
    const digits = /^rakazo-image:(\d+)$/i.exec(source)?.[1];
    if (!digits) malformed = true;
    else references.push({ start: token.start + 1, end: token.end - 1, place: Number(digits) });
  }

  const components = new Map<number, string>();
  const text = (index: number) => code.slice(tokens[index]!.start, tokens[index]!.end);
  for (const [index, token] of tokens.entries()) {
    if (
      token.type === TokenType.braceL &&
      token.contextId !== null &&
      tokens[index - 1]?.type === TokenType.comma
    ) {
      // Sucrase emits createElement(Component, {...}) or createElement(Module.Component, {...}).
      const componentIndex = index - 2;
      const first =
        tokens[componentIndex - 1]?.type === TokenType.dot ? componentIndex - 2 : componentIndex;
      if (
        tokens[first - 1]?.type === TokenType.parenL &&
        first >= 2 &&
        text(first - 2) === "createElement"
      ) {
        components.set(token.contextId, text(componentIndex));
      }
    }
    if (token.identifierRole !== IdentifierRole.ObjectKey) continue;
    if (tokens[index + 1]?.type !== TokenType.colon) continue;
    const key = code.slice(token.start, token.end).replace(/^["']|["']$/g, "");
    const component = token.contextId === null ? undefined : components.get(token.contextId);
    if (component !== undefined && !COMPONENT_IMAGE_PROPS.get(component)?.has(key)) continue;
    const value = index + 2;
    const next = tokens[value + 1]?.type;
    if (IMAGE_SOURCE_KEYS.has(key) && (next === TokenType.comma || next === TokenType.braceR)) {
      read(value);
    }
    if (key === "photos" && tokens[value]?.type === TokenType.bracketL) {
      for (let item = value + 1; tokens[item]?.type === TokenType.string; item += 2) {
        const separator = tokens[item + 1]?.type;
        if (separator !== TokenType.comma && separator !== TokenType.bracketR) break;
        read(item);
        if (separator === TokenType.bracketR) break;
      }
    }
  }
  return {
    malformed,
    places: [...new Set(references.map(({ place }) => place))],
    replace(idAt: (place: number) => string) {
      let previous = 0;
      const parts: string[] = [];
      for (const { start, end, place } of references) {
        parts.push(code.slice(previous, start), `rakazo-image:${idAt(place)}`);
        previous = end;
      }
      return parts.join("") + code.slice(previous);
    },
  };
}
