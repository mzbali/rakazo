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
