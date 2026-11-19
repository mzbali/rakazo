import type katex from "katex";
import { useEffect, useState } from "react";

type Katex = typeof katex;

let loaded: Katex | undefined;
let load: Promise<Katex> | undefined;

// KaTeX and its stylesheet (with the fonts it names) are large. They load the first time a
// message has a formula, never with the chat.
function loadKatex(): Promise<Katex> {
  load ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([module]) => {
      loaded = module.default;
      return module.default;
    },
    (error: unknown) => {
      // A failed chunk load is retried by the next formula instead of failing every later one.
      load = undefined;
      throw error;
    },
  );
  return load;
}

/** KaTeX once it has loaded; undefined until then, and for good if its chunk cannot load. */
export function useKatex(): Katex | undefined {
  const [katex, setKatex] = useState(loaded);
  useEffect(() => {
    if (katex) return;
    let current = true;
    loadKatex().then(
      (module) => {
        if (current) setKatex(() => module);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [katex]);
  return katex;
}

let cssLoad: Promise<string> | undefined;
let cssLoaded: string | undefined;

/**
 * KaTeX's rules as text, for a shadow root: the page's own stylesheet does not reach into one.
 * Its fonts still come from the page's sheet, loaded with KaTeX, since a shadow root cannot
 * declare fonts. Undefined until loaded.
 */
export function useKatexCss(): string | undefined {
  const [css, setCss] = useState(cssLoaded);
  useEffect(() => {
    if (css) return;
    let current = true;
    cssLoad ??= import("katex/dist/katex.min.css?inline").then((module) => {
      cssLoaded = module.default;
      return module.default;
    });
    cssLoad.then(
      (text) => {
        if (current) setCss(text);
      },
      () => {
        cssLoad = undefined;
      },
    );
    return () => {
      current = false;
    };
  }, [css]);
  return css;
}
