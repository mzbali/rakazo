import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { SidewaysScrollView } from "../native/sideways-scroll";
import type { MathSvg } from "./tex-svg";

// MathJax measures in ex, the height of an x. An x is about this fraction of the font size.
const EX_PER_EM = 0.45;
const MAX_DRAWN = 128;

// A formula that cannot be drawn is remembered as null so it is not tried again on every redraw.
const drawn = new Map<string, MathSvg | null>();

// MathJax is large. It loads the first time a message has a formula, never with the chat.
let load: Promise<typeof import("./tex-svg")> | undefined;

function loadMathJax() {
  load ??= import("./tex-svg").catch((error: unknown) => {
    load = undefined;
    throw error;
  });
  return load;
}

function drawKey(tex: string, display: boolean) {
  return `${display ? "d" : "i"}${tex}`;
}

function remember(key: string, svg: MathSvg | null) {
  drawn.delete(key);
  drawn.set(key, svg);
  if (drawn.size > MAX_DRAWN) {
    const oldest = drawn.keys().next().value;
    if (oldest !== undefined) drawn.delete(oldest);
  }
}

/** The formula as SVG; undefined while MathJax loads, null when it rejects the TeX. */
function useMathSvg(tex: string, display: boolean): MathSvg | null | undefined {
  const key = drawKey(tex, display);
  const [result, setResult] = useState<{ key: string; svg: MathSvg | null }>();
  useEffect(() => {
    if (drawn.has(key)) return;
    let current = true;
    loadMathJax().then(
      (mathjax) => {
        let svg: MathSvg | null = null;
        try {
          svg = mathjax.texToSvg(tex, display);
        } catch {
          // Not TeX MathJax can read: the source is shown instead.
        }
        remember(key, svg);
        if (current) setResult({ key, svg });
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [key, tex, display]);
  if (drawn.has(key)) return drawn.get(key);
  return result?.key === key ? result.svg : undefined;
}

/**
 * A formula drawn at a font size, in a colour. Until MathJax loads, and for TeX it rejects, it
 * shows `source` instead.
 */
export function FormulaView({
  tex,
  display,
  color,
  fontSize,
  source,
}: {
  tex: string;
  display: boolean;
  color: string;
  fontSize: number;
  source: ReactNode;
}) {
  const svg = useMathSvg(tex, display);
  if (!svg) return source;
  const ex = fontSize * EX_PER_EM;
  const width = svg.width * ex;
  const height = svg.height * ex;
  const drawing = (
    <View accessible accessibilityLabel={tex} style={{ width, height }}>
      <SvgXml xml={svg.xml} width={width} height={height} color={color} />
    </View>
  );
  if (!display) return drawing;
  return (
    <SidewaysScrollView>
      <View style={{ minWidth: "100%", alignItems: "center" }}>{drawing}</View>
    </SidewaysScrollView>
  );
}
