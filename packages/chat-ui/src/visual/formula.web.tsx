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
      {css ? <style>{css}</style> : null}
      <MathFormula tex={tex} display classes={CLASSES} />
    </div>
  );
}
