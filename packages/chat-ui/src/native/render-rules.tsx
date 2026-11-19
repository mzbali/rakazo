import { citationGroupIndex } from "@rakazo/core/answer-sources";
import type {
  ASTNode,
  MarkdownStyleMap,
  RenderRules,
} from "@ronradtke/react-native-markdown-display";
import { renderRules as libraryRenderRules } from "@ronradtke/react-native-markdown-display";
import type { ReactNode } from "react";
import { Children, Fragment, useContext } from "react";
import type { StyleProp, TextStyle } from "react-native";
import { StyleSheet, Text, View } from "react-native";
import type { MarkdownEmbed } from "../markdown";
import {
  inlineMarkdownImageSrc,
  isProseFence,
  MarkdownEmbedContext,
  markdownEmbed,
  markdownMentionId,
  markdownPageId,
  remoteMarkdownImage,
  sanitizeMarkdownUrl,
} from "../markdown";
import { mathRenderRules, splitAtDisplayMath } from "../math/math.native";
import { isMermaidFence } from "../mermaid";
import { astText, cellPlainText, enclosingLink, soleRemoteImage } from "./ast";
import { MarkdownMention, MarkdownPageChip } from "./chips";
import { CitationPill } from "./citations";
import { CodeFence, CodeScrollView, MermaidFence, ProseFence } from "./code";
import { contraryDirection } from "./direction";
import { FitImage, LinkedRemoteImage, RemoteMarkdownImage } from "./images";
import { IconLink, isWebsiteLink, NativeLink, textStyleForParents } from "./links";
import { listItemRule } from "./lists";
import { isMediaRowNode, isMediaThumb, MediaThumb, openingImageNode } from "./media-row";
import { blockquoteRule } from "./quotes";
import { layout } from "./styles";
import { TableCell, TableRow, TableScrollView } from "./table";

// Keep links as Text so they stay inside textgroup; Pressable (a View) is laid out
// outside the text flow and collapses the bubble height, overlapping later messages.
function mediaHost(parents: readonly ASTNode[]): ASTNode | undefined {
  return parents.find((parent) => parent.type === "list_item" || parent.type === "paragraph");
}

function listRule(
  node: ASTNode,
  children: ReactNode[],
  styleMap: MarkdownStyleMap,
  kind: "bullet_list" | "ordered_list",
) {
  const allMedia =
    node.children.length > 0 && node.children.every((child) => isMediaRowNode(child));
  const style = styleMap[`_VIEW_SAFE_${kind}`];
  return (
    <View key={node.key} style={allMedia ? [style, { gap: 0 }] : style}>
      {children}
    </View>
  );
}

export const renderRules: RenderRules = {
  ...mathRenderRules,
  list_item: listItemRule,
  bullet_list: (node, children, _parent, styleMap) =>
    listRule(node, children, styleMap, "bullet_list"),
  ordered_list: (node, children, _parent, styleMap) =>
    listRule(node, children, styleMap, "ordered_list"),
  blockquote: blockquoteRule,
  fence: (node, _children, _parents, styleMap, _onCopyCode, colorScheme) => {
    const info = typeof node.sourceInfo === "string" ? node.sourceInfo : "";
    const source = node.content.replace(/\n$/, "");
    const language = info.trim().split(/\s+/)[0] ?? "";
    const codeBlock = isProseFence(language) ? (
      <ProseFence key={node.key} code={source} language={language} styleMap={styleMap} />
    ) : (
      <CodeFence
        key={node.key}
        code={source}
        language={language}
        colorScheme={colorScheme === "dark" ? "dark" : "light"}
        styleMap={styleMap}
      />
    );
    if (!isMermaidFence(info)) return codeBlock;
    return <MermaidFence key={node.key} source={source} fallback={codeBlock} />;
  },
  // The frame moves from the text to a view around it, so the copy control sits inside it.
  code_block: (node, children, parents, styleMap, ...extra) => {
    const { borderWidth, borderColor, borderRadius, backgroundColor, ...text } =
      StyleSheet.flatten(styleMap.code_block) ?? {};
    return (
      <View
        key={node.key}
        style={[{ borderWidth, borderColor, borderRadius, backgroundColor }, layout.codeFrame]}
      >
        <CodeScrollView code={node.content.replace(/\n$/, "")}>
          {/* The library's own rule, made here so it draws with the app's Text, which the app
              replaces after this file loads. */}
          {libraryRenderRules(Text).code_block?.(
            node,
            children,
            parents,
            { ...styleMap, code_block: text },
            ...extra,
          )}
        </CodeScrollView>
      </View>
    );
  },
  textgroup: (node, children, parents, styleMap) => {
    // A display formula is a block, so the text around it becomes runs of its own.
    const split = splitAtDisplayMath(node, children, (parts, key) => (
      <Text key={key} style={styleMap.textgroup}>
        {parts}
      </Text>
    ));
    if (split) return <Fragment key={node.key}>{split}</Fragment>;
    // The space between a row's image and its title would indent the title past the text below.
    // The image sits either in this group or just before it in a list item.
    const thumbed = Children.toArray(children).some(isMediaThumb);
    const host = parents[0];
    const before = host?.children[host.children.indexOf(node) - 1];
    const inRow = thumbed || (host !== undefined && isMediaRowNode(host));
    const kept = inRow
      ? children.filter((_, index) => {
          const previous = index === 0 ? before : node.children[index - 1];
          const child = node.children[index];
          return !(previous?.type === "image" && child?.type === "text" && !child.content.trim());
        })
      : children;
    // A thumbnail is a view. Leaving it inside Text would drop it out of the line.
    if (thumbed) {
      return <Fragment key={node.key}>{kept}</Fragment>;
    }
    return (
      <Text
        key={node.key}
        style={[styleMap.textgroup, contraryDirection(cellPlainText(node)) && layout.farSideBlock]}
      >
        {kept}
      </Text>
    );
  },
  paragraph: (node, children, _parents, styleMap) => {
    const flat = Children.toArray(children);
    const thumb = flat.find(isMediaThumb);
    // The first paragraph of a list item is unwrapped, so the list item lays that row out.
    // A thumb that reaches a paragraph is a standalone row, or a later paragraph of its own.
    if (!thumb) {
      return (
        <View key={node.key} style={styleMap._VIEW_SAFE_paragraph}>
          {children}
        </View>
      );
    }
    return (
      <View key={node.key} style={styleMap.media_row}>
        {thumb}
        <View style={styleMap.media_copy}>{flat.filter((child) => child !== thumb)}</View>
      </View>
    );
  },
  text: (node, _children, parents, styleMap, inherited) => {
    const content = textBesideCitation(node, parents);
    if (!content) return null;
    return (
      <Text key={node.key} style={textStyleForParents(inherited, parents, styleMap)}>
        {content}
      </Text>
    );
  },
  table: (node, children, _parent, styleMap) => (
    <TableScrollView key={node.key} table={node} style={styleMap._VIEW_SAFE_table}>
      {children}
    </TableScrollView>
  ),
  tr: (node, children, _parent, styleMap) => (
    <TableRow key={node.key} baseStyle={styleMap._VIEW_SAFE_tr}>
      {children}
    </TableRow>
  ),
  th: (node, children, _parent, styleMap) => (
    <TableCell key={node.key} columnIndex={node.index} baseStyle={styleMap._VIEW_SAFE_th}>
      {children}
    </TableCell>
  ),
  td: (node, children, _parent, styleMap) => (
    <TableCell key={node.key} columnIndex={node.index} baseStyle={styleMap._VIEW_SAFE_td}>
      {children}
    </TableCell>
  ),
  link: (node, children, parents, styleMap) =>
    renderMarkdownLink(node, children, parents, styleMap, false),
  blocklink: (node, children, parents, styleMap) =>
    renderMarkdownLink(node, children, parents, styleMap, true),
  // Replaces the library rule, which loads any http(s) image and prefixes https:// to the rest.
  image: (node, _children, parents, styleMap) => {
    const src = node.attributes.src ?? "";
    const alt = node.attributes.alt;
    const embed = markdownEmbed(src, alt);
    if (embed) {
      const linkParent = enclosingLink(parents);
      const linkOpens = Boolean(
        linkParent && sanitizeMarkdownUrl(linkParent.attributes.href ?? ""),
      );
      const labelStyle = linkOpens ? styleMap.link : styleMap.plain_text;
      const host = mediaHost(parents);
      const thumbnail =
        embed.kind === "image" && host !== undefined && openingImageNode(host) === node;
      const image = (
        <MarkdownEmbedImage
          embed={thumbnail ? { ...embed, frame: "thumbnail" } : embed}
          alt={alt}
          labelStyle={labelStyle}
        />
      );
      if (!thumbnail) return <Fragment key={node.key}>{image}</Fragment>;
      return (
        <MediaThumb key={node.key} style={styleMap.media_thumb}>
          {image}
        </MediaThumb>
      );
    }
    if (inlineMarkdownImageSrc(src)) {
      return (
        <FitImage
          key={node.key}
          // Embedded data has nothing to load; the spinner would stay over the image.
          indicator={false}
          style={styleMap._VIEW_SAFE_image}
          source={{ uri: src }}
          accessible={Boolean(alt)}
          accessibilityLabel={alt}
        />
      );
    }
    const linkParent = enclosingLink(parents);
    const linkOpens = Boolean(linkParent && sanitizeMarkdownUrl(linkParent.attributes.href ?? ""));
    const labelStyle = linkOpens ? styleMap.link : styleMap.plain_text;
    const remote = remoteMarkdownImage(src);
    if (remote) {
      return (
        <RemoteMarkdownImage
          key={node.key}
          image={remote}
          alt={alt}
          title={node.attributes.title}
          insideLink={Boolean(linkParent)}
          rejectedLink={Boolean(linkParent) && !linkOpens}
          labelStyle={labelStyle}
          styleMap={styleMap}
        />
      );
    }
    return (
      <Text key={node.key} style={labelStyle}>
        {alt || src}
      </Text>
    );
  },
};

function MarkdownEmbedImage({
  embed,
  alt,
  labelStyle,
}: {
  embed: MarkdownEmbed;
  alt?: string;
  labelStyle: StyleProp<TextStyle>;
}) {
  const resolve = useContext(MarkdownEmbedContext);
  const resolved = resolve?.(embed);
  // A paragraph lays its children out as a wrapping row, where a card without its own width
  // collapses; the embed takes the paragraph's full width as its own block.
  if (resolved) return <View style={{ width: "100%" }}>{resolved}</View>;
  return <Text style={labelStyle}>{alt || ""}</Text>;
}

/** A full stop, comma or similar mark sitting right after a pill. */
const HUGGED_PUNCTUATION = /^[ \t]*([.?!。！？…,;:)]+)/u;

function sibling(node: ASTNode, parents: readonly ASTNode[], offset: number): ASTNode | undefined {
  const host = parents[0];
  if (!host) return undefined;
  return host.children[host.children.indexOf(node) + offset];
}

function citationTrailing(node: ASTNode, parents: readonly ASTNode[]): string {
  const next = sibling(node, parents, 1);
  if (next?.type !== "text") return "";
  return HUGGED_PUNCTUATION.exec(next.content)?.[1] ?? "";
}

/** Drop the mark the pill drew, so it is not also a text run after the inline view. */
function textBesideCitation(node: ASTNode, parents: readonly ASTNode[]): string {
  const previous = sibling(node, parents, -1);
  if (previous?.type !== "link" && previous?.type !== "blocklink") return node.content;
  if (citationGroupIndex(previous.attributes.href) === undefined) return node.content;
  return node.content.replace(HUGGED_PUNCTUATION, "");
}

function renderMarkdownLink(
  node: ASTNode,
  children: ReactNode[],
  parents: readonly ASTNode[],
  styleMap: MarkdownStyleMap,
  block: boolean,
) {
  const cited = citationGroupIndex(node.attributes.href);
  if (cited !== undefined) {
    return (
      <CitationPill
        key={node.key}
        index={cited}
        styleMap={styleMap}
        trailing={citationTrailing(node, parents)}
      />
    );
  }
  const pageId = markdownPageId(node.attributes.href);
  if (pageId) {
    return (
      <MarkdownPageChip key={node.key} pageId={pageId} titleStyle={styleMap.page_chip_title}>
        {children}
      </MarkdownPageChip>
    );
  }
  const mentionId = markdownMentionId(node.attributes.href);
  if (mentionId) {
    return (
      <MarkdownMention key={node.key} id={mentionId} name={astText(node) ?? ""}>
        {children}
      </MarkdownMention>
    );
  }
  const href = sanitizeMarkdownUrl(node.attributes.href ?? "");
  if (!href) return <Text key={node.key}>{children}</Text>;
  const image = soleRemoteImage(node);
  if (image) {
    return (
      <LinkedRemoteImage
        key={node.key}
        href={href}
        image={image.remote}
        alt={image.alt}
        title={image.title}
        styleMap={styleMap}
      />
    );
  }
  if (!block && isWebsiteLink(node)) {
    return (
      <IconLink
        key={node.key}
        href={href}
        text={astText(node)}
        style={styleMap.website_link}
        labelStyle={styleMap.website_link_label}
        plate={styleMap.link_favicon_plate}
      >
        {children}
      </IconLink>
    );
  }
  if (!block) {
    return (
      <NativeLink href={href} key={node.key} style={styleMap.link}>
        {children}
      </NativeLink>
    );
  }
  return (
    <NativeLink block href={href} key={node.key} style={styleMap.blocklink}>
      <View style={styleMap.image}>{children}</View>
    </NativeLink>
  );
}
