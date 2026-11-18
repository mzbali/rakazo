import type {
  ASTNode,
  MarkdownStyleMap,
  RenderRules,
} from "@ronradtke/react-native-markdown-display";
import { useContext, useEffect, useState } from "react";
import type { TextStyle } from "react-native";
import { StyleSheet, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { DiagramSurfaceContext } from "../native/code";
import { textStyleForParents } from "../native/links";
import { SidewaysScrollView } from "../native/sideways-scroll";
import { MATH_DISPLAY, MATH_INLINE } from "./markdown-it-math";
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

function Formula({
  tex,
  display,
  textStyle,
  styleMap,
}: {
  tex: string;
  display: boolean;
  textStyle: ReturnType<typeof textStyleForParents>;
  styleMap: MarkdownStyleMap;
}) {
  const { palette } = useContext(DiagramSurfaceContext);
  const svg = useMathSvg(tex, display);
  // Until MathJax loads, and for TeX it rejects, the source shows as code.
  if (!svg) return <Text style={[textStyle, styleMap.code_inline]}>{tex}</Text>;
  const style = StyleSheet.flatten(textStyle as TextStyle | undefined);
  const ex = (style?.fontSize ?? 16) * EX_PER_EM;
  const width = svg.width * ex;
  const height = svg.height * ex;
  const drawing = (
    <View
      accessible
      accessibilityLabel={tex}
      // MathJax's baseline is below the bottom edge for a formula with descenders.
      style={{ width, height, transform: [{ translateY: -svg.baseline * ex }] }}
    >
      <SvgXml
        xml={svg.xml}
        width={width}
        height={height}
        color={style?.color ?? palette.foreground}
      />
    </View>
  );
  if (!display) return drawing;
  return (
    <SidewaysScrollView contentWidth={width}>
      <View style={{ minWidth: "100%", alignItems: "center" }}>{drawing}</View>
    </SidewaysScrollView>
  );
}

/** A paragraph that is one display formula and nothing else, which is laid out as a block. */
export function isDisplayMathOnly(node: ASTNode): boolean {
  const parts = node.children.filter(
    (child) => child.type !== "text" || child.content.trim() !== "",
  );
  return parts.length === 1 && parts[0]?.type === MATH_DISPLAY;
}

export const mathRenderRules: RenderRules = {
  [MATH_INLINE]: (node, _children, parents, styleMap, inherited) => (
    <Formula
      key={node.key}
      tex={node.content}
      display={false}
      textStyle={textStyleForParents(inherited, parents, styleMap)}
      styleMap={styleMap}
    />
  ),
  [MATH_DISPLAY]: (node, _children, parents, styleMap, inherited) => (
    <Formula
      key={node.key}
      tex={node.content}
      display
      textStyle={textStyleForParents(inherited, parents, styleMap)}
      styleMap={styleMap}
    />
  ),
};
