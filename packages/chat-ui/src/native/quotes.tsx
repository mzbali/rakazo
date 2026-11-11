import type {
  ASTNode,
  createMarkdownIt,
  MarkdownStyleMap,
} from "@ronradtke/react-native-markdown-display";
import type { ComponentType, ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";

/**
 * The app's long-press menu for one quote, given its text as shown and its own Markdown with any
 * enclosing quote or list markup removed. Without one, quotes have no menu of their own.
 */
export const QuoteMenuContext = createContext<ComponentType<{
  text: string;
  markdown: string;
  children: ReactNode;
}> | null>(null);

/** The parts of a markdown-it token the quote source rule reads and writes. */
type ParsedToken = { type: string; map: [number, number] | null; meta: unknown };

const QUOTE_MARKER = /^[ \t]*>[ \t]?/;
const LIST_MARKER = /^[ \t]*(?:(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$))?/;

/**
 * Each quote's Markdown as written, kept on its opening token, which the renderer hands to the
 * quote rule as `sourceMeta`. A nested quote drops the markers of the quotes and list items
 * around it, so it copies as a quote of its own.
 */
export function markQuoteSources(parser: ReturnType<typeof createMarkdownIt>) {
  parser.core.ruler.push("quote_sources", (state: { src: string; tokens: ParsedToken[] }) => {
    const lines = state.src.split("\n");
    const containers: ("quote" | "list")[] = [];
    for (const token of state.tokens) {
      if (token.type === "blockquote_close" || token.type === "list_item_close") {
        containers.pop();
        continue;
      }
      if (token.type === "list_item_open") {
        containers.push("list");
        continue;
      }
      if (token.type !== "blockquote_open") continue;
      if (token.map) {
        const own = lines.slice(token.map[0], token.map[1]).map((line, index) =>
          containers.reduce(
            (rest, container) =>
              container === "quote"
                ? rest.replace(QUOTE_MARKER, "")
                : // Only a list item's first line carries its marker; the rest are indented.
                  rest.replace(index === 0 ? LIST_MARKER : /^[ \t]*/, ""),
            line,
          ),
        );
        const markdown = own.join("\n").trimEnd();
        if (markdown) token.meta = { quoteMarkdown: markdown };
      }
      containers.push("quote");
    }
  });
}

// What sits between the blocks each container holds, as the bubble lays them out.
const BLOCK_SEPARATORS: Record<string, string> = {
  blockquote: "\n\n",
  bullet_list: "\n",
  ordered_list: "\n",
  list_item: "\n",
  table: "\n",
  thead: "\n",
  tbody: "\n",
  tr: "\t",
};

/** A quote's text as the bubble shows it: its line breaks kept, its Markdown markup gone. */
export function quotePlainText(node: ASTNode): string {
  if (node.type === "text" || node.type === "code_inline") return node.content;
  if (node.type === "softbreak" || node.type === "hardbreak") return "\n";
  if (node.type === "fence" || node.type === "code_block") return node.content.replace(/\n$/, "");
  if (node.type === "image") return node.attributes.alt ?? "";
  const parts = node.children.map(quotePlainText);
  const separator = BLOCK_SEPARATORS[node.type];
  return separator === undefined ? parts.join("") : parts.filter(Boolean).join(separator);
}

function quoteMarkdown(node: ASTNode): string | undefined {
  const meta = node.sourceMeta as { quoteMarkdown?: unknown } | null | undefined;
  return typeof meta?.quoteMarkdown === "string" ? meta.quoteMarkdown : undefined;
}

// The menu's native host sizes its content without a width, so a wrapper holding the quote's
// margins measures the space first, and the quote is laid out at that width inside the menu.
function QuoteFrame({
  node,
  markdown,
  style,
  children,
}: {
  node: ASTNode;
  markdown: string | undefined;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const Menu = useContext(QuoteMenuContext);
  const [width, setWidth] = useState(0);
  if (!Menu || !markdown) return <View style={style}>{children}</View>;
  const {
    margin,
    marginHorizontal,
    marginVertical,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    marginStart,
    marginEnd,
    ...frame
  } = StyleSheet.flatten(style) ?? {};
  const quote = <View style={[frame, width ? { width } : null]}>{children}</View>;
  return (
    <View
      style={{
        margin,
        marginHorizontal,
        marginVertical,
        marginTop,
        marginBottom,
        marginLeft,
        marginRight,
        marginStart,
        marginEnd,
      }}
      onLayout={(event) => setWidth(Math.floor(event.nativeEvent.layout.width))}
    >
      {width ? (
        // Only blank edges go: a first code line keeps its indentation.
        <Menu
          text={quotePlainText(node)
            .replace(/^\s*\n/, "")
            .trimEnd()}
          markdown={markdown}
        >
          {quote}
        </Menu>
      ) : (
        quote
      )}
    </View>
  );
}

export function blockquoteRule(
  node: ASTNode,
  children: ReactNode[],
  _parents: ASTNode[],
  styleMap: MarkdownStyleMap,
) {
  return (
    <QuoteFrame
      key={node.key}
      node={node}
      markdown={quoteMarkdown(node)}
      style={styleMap._VIEW_SAFE_blockquote}
    >
      {children}
    </QuoteFrame>
  );
}
