import { useLayoutEffect, useRef, useState } from "react";
import { useKatex } from "./katex.web";
import { DISPLAY_CLASS } from "./remark-math";

/**
 * A formula in message text. Until KaTeX loads it shows the TeX as written, which keeps roughly
 * the room the formula will take; TeX KaTeX rejects stays as code instead of an error box.
 */
export function MathSpan({ tex, className }: { tex: string; className?: string }) {
  const display = className?.split(" ").includes(DISPLAY_CLASS) ?? false;
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
      <code className={display ? "rk-math-source rk-math-display" : "rk-math-source"}>{tex}</code>
    );
  }
  return (
    <span className={display ? "rk-math rk-math-display" : "rk-math"}>
      {/* A span, since a formula sits inside a paragraph. KaTeX fills this span itself; React never gives it children. */}
      <span ref={target} />
      {state === "pending" ? <span className="rk-math-pending">{tex}</span> : null}
    </span>
  );
}
