import { useKatexCss } from "../math/katex.web";
import { MathFormula } from "../math/math.web";

// The page's maths classes do not reach into the visual's shadow root.
const CLASSES = {
  formula: "rkv-formula",
  display: "rkv-formula-display",
  pending: "rkv-formula-source",
  source: "rkv-formula-source",
};

/** A formula in a visual, drawn by the same maths renderer as the chat's text. */
export function FormulaText({ tex }: { tex: string }) {
  const css = useKatexCss();
  return (
    <div className="rkv-formula-block" role="math" aria-label={tex}>
      {css !== undefined ? (
        <>
          <style>{css}</style>
          {/* Keyed by its TeX, so a formula that becomes valid draws instead of staying code. */}
          <MathFormula key={tex} tex={tex} display classes={CLASSES} />
        </>
      ) : (
        // Until KaTeX's rules are in the shadow root a drawing would show its TeX twice.
        <span className={CLASSES.pending}>{tex}</span>
      )}
    </div>
  );
}
