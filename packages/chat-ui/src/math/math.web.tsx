import { useLayoutEffect, useRef, useState } from "react";
import { useKatex } from "./katex.web";
import { DISPLAY_CLASS } from "./remark-math";

/**
 * A formula in message text. Until KaTeX loads it shows the TeX as written, which keeps roughly
 * the room the formula will take; TeX KaTeX rejects stays as code instead of an error box.
 */
export function MathSpan({ tex, className }: { tex: string; className?: string }) {
  return (
    <MathFormula
      tex={tex}
      display={className?.split(" ").includes(DISPLAY_CLASS) ?? false}
      classes={PROSE_CLASSES}
    />
  );
}

const PROSE_CLASSES = {
  formula: "rk-math",
  display: "rk-math-display",
  pending: "rk-math-pending",
  source: "rk-math-source",
};

/** The class names a formula wears, which each place that draws one styles for itself. */
type FormulaClasses = typeof PROSE_CLASSES;

export function MathFormula({
  tex,
  display,
  classes,
}: {
  tex: string;
  display: boolean;
  classes: FormulaClasses;
}) {
  const katex = useKatex();
  const target = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<"pending" | "drawn" | "invalid">("pending");
  useLayoutEffect(() => {
    if (!katex || !target.current) return;
    try {
      katex.render(tex, target.current, {
        displayMode: display,
        throwOnError: true,
        strict: "ignore",
      });
      setState("drawn");
    } catch {
      setState("invalid");
    }
  }, [katex, tex, display]);
  if (state === "invalid") {
    return (
      <code className={display ? `${classes.source} ${classes.display}` : classes.source}>
        {tex}
      </code>
    );
  }
  return (
    <span className={display ? `${classes.formula} ${classes.display}` : classes.formula}>
      {/* A span, since a formula sits inside a paragraph. KaTeX fills this span itself; React never gives it children. */}
      <span ref={target} />
      {state === "pending" ? <span className={classes.pending}>{tex}</span> : null}
    </span>
  );
}
