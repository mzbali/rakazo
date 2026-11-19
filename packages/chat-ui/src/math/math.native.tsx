import type {
  ASTNode,
  MarkdownStyleMap,
  RenderRules,
} from "@ronradtke/react-native-markdown-display";
import type { ReactNode } from "react";
import { useContext, useEffect, useState } from "react";
import type { TextStyle } from "react-native";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { DiagramSurfaceContext } from "../native/code";
import { textStyleForParents } from "../native/links";
import { SidewaysScrollView } from "../native/sideways-scroll";
import { TableCellWidthContext } from "../native/table";
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
  const style = StyleSheet.flatten(textStyle as TextStyle | undefined);
  return (
    <FormulaView
      tex={tex}
      display={display}
      color={typeof style?.color === "string" ? style.color : palette.foreground}
      fontSize={style?.fontSize ?? 16}
      source={<Text style={[textStyle, styleMap.code_inline]}>{tex}</Text>}
    />
  );
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
  const cellWidth = useContext(TableCellWidthContext);
  const inCell = cellWidth !== undefined;
  if (!svg) return source;
  const ex = fontSize * EX_PER_EM;
  const width = svg.width * ex;
  const height = svg.height * ex;
  const drawing = (
    <View
      accessible
      accessibilityLabel={tex}
      // An inline formula sits with its bottom on the text baseline; MathJax's baseline is lower
      // when the formula has descenders. A table cell would clip the part that drops below.
      style={{
        width,
        height,
        transform: display || inCell ? undefined : [{ translateY: -svg.baseline * ex }],
      }}
    >
      <SvgXml xml={svg.xml} width={width} height={height} color={color} />
    </View>
  );
  // A table cell is only as wide as its column; a wider formula scrolls inside it.
  if (inCell && width > cellWidth) {
    return (
      <ScrollView horizontal nestedScrollEnabled style={{ maxWidth: cellWidth }}>
        {drawing}
      </ScrollView>
    );
  }
  if (!display) return drawing;
  return (
    <SidewaysScrollView>
      <View style={{ minWidth: "100%", alignItems: "center" }}>{drawing}</View>
    </SidewaysScrollView>
  );
}

/**
 * A line of text with display formulas in it, as runs of text and a block for each formula, in
 * order. Undefined when it has none. A run of only blank text is dropped.
 */
export function splitAtDisplayMath(
  node: ASTNode,
  children: readonly ReactNode[],
  run: (parts: ReactNode[], key: string) => ReactNode,
): ReactNode[] | undefined {
  if (!node.children.some((child) => child.type === MATH_DISPLAY)) return undefined;
  const blocks: ReactNode[] = [];
  let parts: ReactNode[] = [];
  let blank = true;
  const flush = (key: string) => {
    if (parts.length > 0 && !blank) blocks.push(run(parts, key));
    parts = [];
    blank = true;
  };
  node.children.forEach((child, index) => {
    if (child.type === MATH_DISPLAY) {
      flush(`${node.key}-run-${index}`);
      blocks.push(children[index]);
      return;
    }
    parts.push(children[index]);
    if (child.type !== "text" || child.content.trim() !== "") blank = false;
  });
  flush(`${node.key}-run-end`);
  return blocks;
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
