/** A formula as written, in monospace, until the shared maths renderer draws it. */
export function FormulaText({ tex }: { tex: string }) {
  return (
    <p className="rkv-formula" role="math" aria-label={tex}>
      {tex}
    </p>
  );
}
