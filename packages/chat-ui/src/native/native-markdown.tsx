import type { CitationGroup } from "@rakazo/core/answer-sources";
import { CITATION_URL_PREFIX, citationGroupIndex } from "@rakazo/core/answer-sources";
import type { ColorTokens, ResolvedAppearance } from "@rakazo/ui-tokens";
import { fontWeight, MAX_FONT_SCALE, typeScale } from "@rakazo/ui-tokens";
import type { ReactElement } from "react";
import { useCallback, useContext, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type {
  LinkPillContent,
  MarkdownCodeBlock,
  MarkdownImageBlock,
  MarkdownImageOccurrence,
  MarkdownLinkOccurrence,
  MarkdownStyle,
} from "react-native-enriched-markdown";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import {
  inlineMarkdownImageSrc,
  isProseFence,
  linkFaviconOrigin,
  MarkdownEmbedContext,
  markdownEmbed,
  markdownMentionId,
  markdownPageId,
  RemoteImagesContext,
  remoteImageRenders,
  remoteMarkdownImage,
  sanitizeMarkdownUrl,
  useLinkFavicons,
} from "../markdown";
import { useMarkdownCopy } from "../markdown-copy";
import { useMarkdownLinkCopy } from "../markdown-link-prompt";
import { FormulaView } from "../math/math.native";
import { isMermaidFence } from "../mermaid";
import { VISUAL_FENCE_LANGUAGE } from "../visual/visual-draw";
import { visualFence } from "../visual/visual-fence.native";
import { openSourceList } from "./citations";
import { CodeFence, MermaidDiagramContext, MermaidFence, ProseFence } from "./code";
import { RemoteMarkdownImage } from "./images";
import { useLinkLabel } from "./links";
import type { MarkdownSegment } from "./markdown-scan";
import { markdownSegments, withAppAutolinks } from "./markdown-scan";
import type { FenceStyles } from "./styles";

export { withAppAutolinks };

const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });
const BLOCK_GAP = 8;
const WEBSITE_LINK = "^[Hh][Tt][Tt][Pp][Ss]?://";
const WEB_ADDRESS = /^https?:\/\//i;
const MENTION_LINK = "^rakazo-mention:";
const PAGE_LINK = "^page:";
const CITE_LINK = `^${CITATION_URL_PREFIX}`;
// Addresses the app will not open (any scheme but these) read as plain text, as they do on web.
const UNOPENABLE_LINK =
  "^(?![Hh][Tt][Tt][Pp][Ss]?:|[Mm][Aa][Ii][Ll][Tt][Oo]:|[Tt][Ee][Ll]:|rakazo-mention:|page:)";

/** How a mention link draws and opens: its bot's color, or nothing for a bot that is gone. */
export type MentionLink = { color: string; open: () => void };

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LINK_PILL = { paddingHorizontal: 0, paddingVertical: 0, borderWidth: 0, borderRadius: 4 };

function nativeMarkdownStyle(
  palette: ColorTokens,
  mentionColors: ReadonlyMap<string, string>,
  appLinks: readonly string[],
  pagesOpen: boolean,
): MarkdownStyle {
  const block = { marginTop: 0, marginBottom: BLOCK_GAP };
  const text = { ...block, color: palette.foreground, fontSize: typeScale.body.fontSize };
  const minorHeading = {
    ...block,
    color: palette.foreground,
    fontSize: typeScale.secondary.fontSize,
    fontWeight: String(fontWeight.semibold),
  };
  // The first pattern that matches an address decides its style, so each bot's own color comes
  // before the plain mention style.
  const linkVariants: MarkdownStyle["linkVariants"] = {};
  for (const [href, color] of mentionColors) {
    linkVariants[`^${escapeRegExp(href)}$`] = { color, underline: false };
  }
  // An app link the host allows draws as a pill with its app's icon, like a website.
  for (const href of appLinks) {
    linkVariants[`^${escapeRegExp(href)}$`] = {
      color: palette.foreground,
      underline: true,
      pill: LINK_PILL,
    };
  }
  // A citation is a pill too, with its site's icon and name.
  linkVariants[CITE_LINK] = { color: palette.foreground, underline: false, pill: LINK_PILL };
  Object.assign(linkVariants, {
    [UNOPENABLE_LINK]: { color: palette.foreground, underline: false },
    [WEBSITE_LINK]: {
      color: palette.foreground,
      underline: true,
      pill: LINK_PILL,
    },
    [MENTION_LINK]: { color: palette.foreground, underline: false },
    [PAGE_LINK]: { color: palette.foreground, underline: pagesOpen },
  });
  return {
    paragraph: { ...text, lineHeight: typeScale.body.lineHeight },
    h1: {
      ...block,
      color: palette.foreground,
      fontSize: typeScale.title.fontSize,
      fontWeight: "700",
    },
    h2: {
      ...block,
      color: palette.foreground,
      fontSize: typeScale.headline.fontSize,
      fontWeight: String(fontWeight.semibold),
    },
    h3: { ...text, fontWeight: String(fontWeight.semibold) },
    h4: minorHeading,
    h5: minorHeading,
    h6: minorHeading,
    strong: { color: palette.foreground },
    strikethrough: { color: palette.foreground },
    link: { color: palette.link, underline: true },
    linkVariants,
    // Inline code is set in the monospaced font alone, without a chip around it.
    code: {
      color: palette.foreground,
      fontFamily: MONO_FONT,
      backgroundColor: "transparent",
      borderColor: "transparent",
    },
    codeBlock: {
      ...block,
      color: palette.foreground,
      backgroundColor: palette.secondary,
      borderRadius: 10,
      borderWidth: 0,
      padding: 10,
      fontFamily: MONO_FONT,
      fontSize: typeScale.caption.fontSize,
    },
    blockquote: {
      ...text,
      color: palette.mutedForeground,
      borderColor: palette.faintForeground,
      borderWidth: 3,
      backgroundColor: "transparent",
    },
    list: { ...text, bulletColor: palette.faintForeground, markerColor: palette.faintForeground },
    // Rows divided by a hairline, with no frame or banding, in the body type.
    table: {
      ...block,
      fontSize: typeScale.body.fontSize,
      color: palette.foreground,
      headerTextColor: palette.foreground,
      headerBackgroundColor: "transparent",
      rowEvenBackgroundColor: "transparent",
      rowOddBackgroundColor: "transparent",
      borderColor: palette.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 0,
    },
    taskList: { checkedColor: palette.foreground, borderColor: palette.faintForeground },
    thematicBreak: { color: palette.border },
  };
}

/** Bot Markdown drawn as native text, with the app's own views for what native text cannot draw. */
export function NativeMarkdown({
  markdown,
  streaming,
  visuals,
  citations,
  palette,
  colorScheme,
  fenceStyles,
  mentionLink,
  onOpenPage,
  onOpenLink,
}: {
  markdown: string;
  streaming: boolean;
  /** Draw ```ui fences as visuals: set only for text the Space's own bot wrote. */
  visuals: boolean;
  citations: readonly CitationGroup[];
  palette: ColorTokens;
  colorScheme: ResolvedAppearance;
  fenceStyles: FenceStyles;
  mentionLink?: (id: string) => MentionLink | undefined;
  onOpenPage?: (pageId: string) => void;
  onOpenLink: (url: string) => void;
}) {
  const resolveEmbed = useContext(MarkdownEmbedContext);
  const segments = useMemo(
    () => markdownSegments(markdown, resolveEmbed !== null),
    [markdown, resolveEmbed],
  );
  const run = (text: string) => (
    <MarkdownRun
      text={text}
      streaming={streaming}
      visuals={visuals}
      citations={citations}
      palette={palette}
      colorScheme={colorScheme}
      fenceStyles={fenceStyles}
      mentionLink={mentionLink}
      onOpenPage={onOpenPage}
      onOpenLink={onOpenLink}
    />
  );
  const [only] = segments;
  if (segments.length === 1 && only?.kind === "markdown") return run(only.text);
  return (
    <>
      {segments.map((segment, index) => (
        <SegmentView
          // Segments have no identity but their place, which holds while a reply streams.
          key={index}
          segment={segment}
          palette={palette}
          fenceStyles={fenceStyles}
          run={run}
        />
      ))}
    </>
  );
}

function SegmentView({
  segment,
  palette,
  fenceStyles,
  run,
}: {
  segment: MarkdownSegment;
  palette: ColorTokens;
  fenceStyles: FenceStyles;
  run: (text: string) => ReactElement;
}) {
  const resolveEmbed = useContext(MarkdownEmbedContext);
  if (segment.kind === "markdown") return run(segment.text);
  if (segment.kind === "math") {
    const fontSize = typeScale.body.fontSize;
    return (
      <View style={{ marginBottom: BLOCK_GAP }}>
        <FormulaView
          tex={segment.tex}
          display={segment.display}
          color={palette.foreground}
          fontSize={fontSize}
          source={
            <Text style={{ color: palette.foreground, fontFamily: MONO_FONT, fontSize }}>
              {segment.tex}
            </Text>
          }
        />
      </View>
    );
  }
  const thumbnail = resolveEmbed?.({ ...segment.embed, frame: "thumbnail" });
  // An embed the app cannot draw keeps its title as text, ahead of the item's own words.
  if (!thumbnail) return run(segment.alt ? `${segment.alt}\n\n${segment.copy}` : segment.copy);
  return (
    <View style={[fenceStyles.media_row, segment.divided ? fenceStyles.media_divider : null]}>
      <View style={fenceStyles.media_thumb}>{thumbnail}</View>
      <View style={fenceStyles.media_copy}>{run(segment.copy)}</View>
    </View>
  );
}

/** An inline or block embed an `image:` or `visual:` address names, drawn by the host app. */
function MarkdownEmbedBlock({
  embed,
  alt,
  fenceStyles,
}: {
  embed: NonNullable<ReturnType<typeof markdownEmbed>>;
  alt: string;
  fenceStyles: FenceStyles;
}) {
  const resolve = useContext(MarkdownEmbedContext);
  const resolved = resolve?.(embed);
  // A card without its own width collapses; the embed takes the full width as a block.
  if (resolved) return <View style={{ width: "100%" }}>{resolved}</View>;
  return alt ? <Text style={fenceStyles.plain_text}>{alt}</Text> : <View />;
}

function MarkdownRun({
  text: written,
  streaming,
  visuals,
  citations,
  palette,
  colorScheme,
  fenceStyles,
  mentionLink,
  onOpenPage,
  onOpenLink,
}: {
  text: string;
  streaming: boolean;
  visuals: boolean;
  citations: readonly CitationGroup[];
  palette: ColorTokens;
  colorScheme: ResolvedAppearance;
  fenceStyles: FenceStyles;
  mentionLink?: (id: string) => MentionLink | undefined;
  onOpenPage?: (pageId: string) => void;
  onOpenLink: (url: string) => void;
}) {
  const text = useMemo(() => withAppAutolinks(written), [written]);
  const [links, setLinks] = useState<readonly MarkdownLinkOccurrence[]>([]);
  const copy = useMarkdownCopy();
  const linkCopy = useMarkdownLinkCopy();
  const websiteLinks = useMemo(
    () => links.filter((link) => linkFaviconOrigin(link.url) !== undefined),
    [links],
  );
  const appLinks = useMemo(
    () => [
      ...new Set(websiteLinks.map((link) => link.url).filter((url) => !WEB_ADDRESS.test(url))),
    ],
    [websiteLinks],
  );
  // Each citation in this run, with the group of sources its pill stands for.
  const cited = useMemo(
    () =>
      links.flatMap((link) => {
        const index = citationGroupIndex(link.url);
        const group = index === undefined ? undefined : citations[index];
        return group?.items[0] ? [{ url: link.url, group }] : [];
      }),
    [links, citations],
  );
  const linkLabel = useLinkLabel();
  const websiteHrefs = useMemo(
    () => [
      ...websiteLinks.map((link) => link.url),
      ...cited.map(({ group }) => group.items[0]?.url ?? ""),
    ],
    [websiteLinks, cited],
  );
  const favicons = useLinkFavicons(websiteHrefs);
  // The bubble hands a new lookup each render; the colors it gives decide the style.
  const mentionColorList = JSON.stringify(
    links.flatMap((link) => {
      const id = markdownMentionId(link.url);
      const color = id ? mentionLink?.(id)?.color : undefined;
      return color ? [[link.url, color]] : [];
    }),
  );
  const mentionColors = useMemo(
    () => new Map<string, string>(JSON.parse(mentionColorList)),
    [mentionColorList],
  );
  const style = useMemo(
    () => nativeMarkdownStyle(palette, mentionColors, appLinks, Boolean(onOpenPage)),
    [palette, mentionColors, appLinks, onOpenPage],
  );
  const pillContent = useMemo(() => {
    const content: Record<string, LinkPillContent> = {};
    // Content is keyed by address, so a short label is used only when no link to that address
    // has words of its own.
    const authored = new Set(
      websiteLinks
        .filter((link) => linkLabel(link.label, link.url) === link.label)
        .map((link) => link.url),
    );
    for (const link of websiteLinks) {
      const icon = favicons.get(link.url);
      content[link.url] = {
        ...(authored.has(link.url) ? {} : { label: linkLabel(link.label, link.url) }),
        ...(icon ? { iconUri: icon } : {}),
      };
    }
    for (const { url, group } of cited) {
      const first = group.items[0];
      if (!first) continue;
      const extra = group.items.length - 1;
      const icon = favicons.get(first.url);
      content[url] = {
        label: extra > 0 ? `${first.site} +${extra}` : first.site,
        ...(icon ? { iconUri: icon } : {}),
      };
    }
    return content;
  }, [websiteLinks, cited, favicons, linkLabel]);

  const loadRemote = useContext(RemoteImagesContext);
  const Diagram = useContext(MermaidDiagramContext);
  const unavailable = copy.visualUnavailable;
  const renderers = useMemo(
    () => ({
      // Code stays native; only a visual, a diagram the app can draw and a plain-text fence, which
      // wraps in the body font, are drawn by the app.
      code: ({ code, language }: MarkdownCodeBlock): ReactElement | undefined => {
        if (visuals && language === VISUAL_FENCE_LANGUAGE) {
          return visualFence(code, { streaming, palette, colorScheme, unavailable });
        }
        if (isProseFence(language)) {
          return <ProseFence code={code} language={language} styles={fenceStyles} />;
        }
        if (!Diagram || streaming || !isMermaidFence(language) || !code.trim()) return undefined;
        return (
          <MermaidFence
            source={code}
            fallback={
              <CodeFence
                code={code}
                language={language}
                colorScheme={colorScheme}
                styles={fenceStyles}
              />
            }
          />
        );
      },
      image: ({ url, altText, title }: MarkdownImageBlock): ReactElement | undefined => {
        const embed = markdownEmbed(url, altText);
        if (embed)
          return <MarkdownEmbedBlock embed={embed} alt={altText} fenceStyles={fenceStyles} />;
        if (inlineMarkdownImageSrc(url)) return undefined;
        const remote = remoteMarkdownImage(url);
        if (!remote) return undefined;
        return (
          <RemoteMarkdownImage
            image={remote}
            alt={altText || undefined}
            title={title || undefined}
            styles={fenceStyles}
          />
        );
      },
    }),
    [Diagram, streaming, visuals, palette, colorScheme, fenceStyles, unavailable],
  );
  // Images inside text, lists, tables and links load only when the reader allowed remote
  // images; until then they keep their placeholder and the address is never requested.
  const resolveImageSource = useCallback(
    (image: MarkdownImageOccurrence) => {
      if (inlineMarkdownImageSrc(image.url)) return undefined;
      const remote = remoteMarkdownImage(image.url);
      if (remote && remoteImageRenders(remote.href, loadRemote, false)) return { uri: remote.href };
      return Promise.reject(new Error("Remote image not allowed"));
    },
    [loadRemote],
  );

  const onLinkPress = useCallback(
    ({ url }: { url: string }) => {
      const group = citations[citationGroupIndex(url) ?? -1];
      if (group) {
        openSourceList(group.items, onOpenLink, linkCopy.cancel);
        return;
      }
      const mentionId = markdownMentionId(url);
      if (mentionId) {
        mentionLink?.(mentionId)?.open();
        return;
      }
      const pageId = markdownPageId(url);
      if (pageId) {
        onOpenPage?.(pageId);
        return;
      }
      if (sanitizeMarkdownUrl(url)) onOpenLink(url);
    },
    [citations, mentionLink, onOpenPage, onOpenLink, linkCopy.cancel],
  );

  return (
    <EnrichedMarkdownText
      // A new resolver only applies to a fresh view, so allowing remote images remounts it.
      key={loadRemote ? "remote" : "local"}
      flavor="github"
      markdown={text}
      markdownStyle={style}
      // A single `$` is text; formulas are drawn by the app, as segments between runs.
      md4cFlags={{ latexMath: false }}
      linkPillContent={pillContent}
      onLinksChange={setLinks}
      onLinkPress={onLinkPress}
      renderers={renderers}
      resolveImageSource={resolveImageSource}
      streamingAnimation={streaming}
      dir="auto"
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      selectable={false}
      enableLinkPreview={false}
      enableCodeBlockWrapToggle={false}
    />
  );
}
