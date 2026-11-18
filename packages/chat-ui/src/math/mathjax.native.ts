import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import "mathjax-full/js/input/tex/base/BaseConfiguration.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";

/** A formula drawn by MathJax: the markup of an `<svg>` that takes its colour from `currentColor`. */
export type MathSvg = { xml: string; width: number; height: number; baseline: number };

// One document for the app: building the input and output jax is the slow part, converting is not.
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const document = mathjax.document("", {
  InputJax: new TeX({
    packages: ["base", "ams", "newcommand"],
    // A parse error throws, so the caller shows the source instead of MathJax's error box.
    formatError: (_jax: unknown, error: Error) => {
      throw error;
    },
  }),
  OutputJax: new SVG({ fontCache: "none" }),
});

function exLength(value: string | null | undefined): number {
  const length = Number.parseFloat(value ?? "");
  return Number.isFinite(length) ? length : 0;
}

/** The formula as SVG, sized in `ex` (the height of an x in the text around it). Throws on bad TeX. */
export function texToSvg(tex: string, display: boolean): MathSvg {
  const container = document.convert(tex, { display });
  const svg = adaptor.firstChild(container);
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
