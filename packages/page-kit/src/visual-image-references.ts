/// <reference path="./sucrase-parser.d.ts" />
import { parse } from "sucrase/dist/parser/index.js";
import { IdentifierRole } from "sucrase/dist/parser/tokenizer/index.js";
import { TokenType } from "sucrase/dist/parser/tokenizer/types.js";

type Reference = { start: number; end: number; place?: number; saved?: string };
const IMAGE_SOURCE_KEYS = new Set(["src", "image", "poster"]);
/** A value the viewer would try to load: any scheme, a protocol-relative or a relative path. Plain words are data. */
const LOADS_AS_URL = /^([a-z][a-z0-9+.-]*:|\/|\.\.?\/)/i;
const COMPONENT_IMAGE_PROPS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Image", new Set(["src"])],
  ["Video", new Set(["poster"])],
  ["ProductCard", new Set(["image", "photos"])],
]);

/**
 * Find literal image sources after JSX becomes props. The same keys are used in data
 * objects for Gallery, PhotoStrip, ProductRows and NewsRows. ProductCard also takes a photos array
 * of source strings. Values elsewhere, including text children and captions, are untouched.
 * A source is a data:image URI, rakazo-image:<n> (a fetched picture) or image:<artifactId> (a
 * picture already saved in the chat). Data and blob URIs pass, as media items use them; any other
 * URL, and a template string, cannot be checked or drawn and is returned in unsupported.
 */
export function visualImageReferences(code: string) {
  const { tokens } = parse(code, false, false, false);
  const references: Reference[] = [];
  const unsupported = new Set<string>();
  let malformed = false;
  function read(index: number) {
    const token = tokens[index]!;
    if (token.type !== TokenType.string) return;
    const source = code.slice(token.start + 1, token.end - 1);
    const start = token.start + 1;
    const end = token.end - 1;
    if (/^rakazo-image:/i.test(source)) {
      const digits = /^rakazo-image:(\d+)$/i.exec(source)?.[1];
      if (!digits) malformed = true;
      else references.push({ start, end, place: Number(digits) });
      return;
    }
    const saved = /^image:([A-Za-z0-9_-]{1,64})$/.exec(source)?.[1];
    if (saved) references.push({ start, end, saved });
    else if (LOADS_AS_URL.test(source.trim()) && !/^(data|blob):/i.test(source.trim())) {
      unsupported.add(source.length > 60 ? `${source.slice(0, 57)}...` : source);
    }
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
    if (IMAGE_SOURCE_KEYS.has(key) && tokens[value]?.type === TokenType.backQuote) {
      unsupported.add("a `template` string (write the source in quotes)");
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
    unsupported: [...unsupported],
    places: [...new Set(references.flatMap(({ place }) => (place === undefined ? [] : [place])))],
    saved: [...new Set(references.flatMap(({ saved }) => (saved === undefined ? [] : [saved])))],
    /** The stored id each reference becomes: idAt for a fetched place, savedAt for a saved id. */
    replace(idAt: (place: number) => string, savedAt: (artifactId: string) => string = () => "") {
      let previous = 0;
      const parts: string[] = [];
      for (const { start, end, place, saved } of references) {
        const id = place === undefined ? savedAt(saved!) : idAt(place);
        parts.push(code.slice(previous, start), `rakazo-image:${id}`);
        previous = end;
      }
      return parts.join("") + code.slice(previous);
    },
  };
}
