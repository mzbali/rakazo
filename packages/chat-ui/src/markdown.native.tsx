import { preparedCitationMarkdown, showSourcesRow } from "@rakazo/core/answer-sources";
import type { ColorTokens, ResolvedAppearance } from "@rakazo/ui-tokens";
import { darkTokens } from "@rakazo/ui-tokens";
import { createMarkdownIt } from "@ronradtke/react-native-markdown-display";
import { memo, useMemo } from "react";
import { View } from "react-native";
import type { ChatMarkdownProps } from "./markdown";
import { LinkFaviconsPausedContext } from "./markdown";
import { useMarkdownCopy } from "./markdown-copy";
import { useMarkdownLinkCopy } from "./markdown-link-prompt";
import { SourcesCount } from "./native/citations";
import { DiagramSurfaceContext } from "./native/code";
import { useNativeLinkConfirm } from "./native/links";
import type { MentionLink } from "./native/native-markdown";
import { NativeMarkdown } from "./native/native-markdown";
import { layout, markdownStyles } from "./native/styles";

const markdownParser = createMarkdownIt();
// Every code block needs a fence, four spaces or a tab; every bot row asks, so most skip the parse.
const MAY_HOLD_CODE = /```|~~~| {4}|\t/;

/** The code of each fenced or indented block in a message, as its copy button copies it. */
export function markdownCodeBlocks(markdown: string): string[] {
  if (!MAY_HOLD_CODE.test(markdown)) return [];
  const tokens: { type: string; content: string }[] = markdownParser.parse(markdown, {});
  return tokens
    .filter((token) => token.type === "fence" || token.type === "code_block")
    .map((token) => token.content.replace(/\n$/, ""))
    .filter((code) => /\S/.test(code));
}

export const ChatMarkdown = memo(function ChatMarkdown({
  children,
  streaming = false,
  mentionLink,
  onOpenPage,
  sources,
  sourcesRow = false,
  visuals = false,
  palette = darkTokens,
  colorScheme = "dark",
}: Omit<ChatMarkdownProps, "renderMention"> & {
  /** How a mention link draws and opens; without it a mention reads as its plain name. */
  mentionLink?: (id: string) => MentionLink | undefined;
  palette?: ColorTokens;
  colorScheme?: ResolvedAppearance;
}) {
  const openLink = useNativeLinkConfirm();
  const copy = useMarkdownCopy();
  const linkCopy = useMarkdownLinkCopy();
  const fenceStyles = useMemo(() => markdownStyles(palette), [palette]);
  const prepared = useMemo(
    () => preparedCitationMarkdown(children, sources, streaming),
    [children, sources, streaming],
  );
  const showRow = !streaming && sourcesRow && !!sources && showSourcesRow(sources.length);
  const diagramSurface = useMemo(
    () => ({ streaming, palette, colorScheme }),
    [streaming, palette, colorScheme],
  );
  return (
    <View style={layout.wrap}>
      <LinkFaviconsPausedContext.Provider value={streaming}>
        <DiagramSurfaceContext.Provider value={diagramSurface}>
          <NativeMarkdown
            markdown={prepared.markdown}
            streaming={streaming}
            visuals={visuals}
            citations={prepared.groups}
            palette={palette}
            colorScheme={colorScheme}
            fenceStyles={fenceStyles}
            mentionLink={mentionLink}
            onOpenPage={onOpenPage}
            onOpenLink={openLink}
          />
        </DiagramSurfaceContext.Provider>
        {showRow && sources ? (
          <SourcesCount
            items={sources}
            label={copy.sourcesCount(sources.length)}
            open={openLink}
            cancel={linkCopy.cancel}
            style={fenceStyles.sources_row}
            pill={fenceStyles.sources_pill}
            mark={fenceStyles.sources_mark}
            plate={fenceStyles.link_favicon_plate}
          />
        ) : null}
      </LinkFaviconsPausedContext.Provider>
    </View>
  );
});

export type { ChatMarkdownProps, LinkFavicons, MarkdownEmbed } from "./markdown";
export {
  allowAppLinks,
  LinkFaviconsContext,
  MarkdownEmbedContext,
  markdownEmbed,
  plainTextLinkParts,
  RemoteImagesContext,
  useLinkFavicon,
  withBlockMentions,
} from "./markdown";
export { allowedAppLink } from "./markdown.js";
export { defaultMarkdownCopy, MarkdownCopyProvider } from "./markdown-copy";
export { MarkdownLinkPromptProvider } from "./markdown-link-prompt";
export { MEDIA_ROW_NATIVE_PT } from "./media-row";
export { PageIcon } from "./native/chips";
export type { MermaidDiagramProps } from "./native/code";
export { CodeCopyButtonContext, MermaidDiagramContext } from "./native/code";
export { RemoteMarkdownImage } from "./native/images";
export { LinkifiedText } from "./native/linkified-text";
export { AppLinkPill, FaviconTile, useNativeLinkConfirm } from "./native/links";
export type { MentionLink } from "./native/native-markdown";
export { MarkdownLongPressContext } from "./native/sideways-scroll";
