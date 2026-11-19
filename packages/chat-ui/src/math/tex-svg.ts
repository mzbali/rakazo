import type { LiteElement } from "mathjax-full/js/adaptors/lite/Element.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import "mathjax-full/js/input/tex/base/BaseConfiguration.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";

/** A formula drawn by MathJax: the markup of an `<svg>` that takes its colour from `currentColor`. */
export type MathSvg = { xml: string; width: number; height: number; baseline: number };

// The output jax and adaptor are built once; the input jax is built for each formula. A formula can
// define things (`\\DeclareMathOperator`), and a fresh input jax keeps them from reaching the next
// one, whichever reply it is in. The newcommand package is left out, so `\\def` is an error.
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const output = new SVG({ fontCache: "none" });

function newDocument() {
  return mathjax.document("", {
    InputJax: new TeX({
      packages: ["base", "ams"],
      // A parse error throws, so the caller shows the source instead of MathJax's error box.
      formatError: (_jax: unknown, error: Error) => {
        throw error;
      },
    }),
    OutputJax: output,
  });
}

function exLength(value: string | null | undefined): number {
  const length = Number.parseFloat(value ?? "");
  return Number.isFinite(length) ? length : 0;
}

/** The formula as SVG, sized in `ex` (the height of an x in the text around it). Throws on bad TeX. */
export function texToSvg(tex: string, display: boolean): MathSvg {
  const container = newDocument().convert(tex, { display });
  const svg = adaptor.firstChild(container) as LiteElement | null;
  if (!svg) throw new Error("MathJax drew nothing");
  const xml = adaptor.outerHTML(svg);
  const verticalAlign = /vertical-align:\s*(-?[\d.]+)ex/.exec(
    adaptor.getAttribute(svg, "style") ?? "",
  );
  return {
    xml: xml.replace(/ style="[^"]*"/, ""),
    width: exLength(adaptor.getAttribute(svg, "width")),
    height: exLength(adaptor.getAttribute(svg, "height")),
    baseline: exLength(verticalAlign?.[1]),
  };
}
