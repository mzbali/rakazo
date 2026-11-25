import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
  ChatMarkdown,
  defaultMarkdownCopy,
  LinkifiedText,
  MarkdownCopyProvider,
} from "@rakazo/chat-ui/native";
import { splitMentionText } from "@rakazo/core";
import type { SourceItem } from "@rakazo/core/answer-sources";
import type { ColorTokens, ResolvedAppearance } from "@rakazo/ui-tokens";
import { useContext, useMemo } from "react";
import type { MobileMessage } from "../../lib/api/mobile-types";
import {
  MessageMentionsContext,
  OpenPageContext,
  UserMentionsContext,
} from "../../lib/messages/message-mentions";
import { UserMention } from "./user-mention";

export function MessageCaption({
  role,
  received,
  text,
  tokens,
  colorScheme,
  streaming,
  sources,
  sourcesRow = false,
  visuals = false,
}: {
  role: MobileMessage["role"];
  /** Another person's message sits on the received surface. */
  received?: boolean;
  text: string;
  tokens: ColorTokens;
  colorScheme: ResolvedAppearance;
  streaming: boolean;
  sources?: readonly SourceItem[];
  sourcesRow?: boolean;
  /** Draw ```ui fences as visuals: set only for text the Space's own bot wrote. */
  visuals?: boolean;
}) {
  const { t } = useLingui();
  const markdownCopy = useMemo(
    () => ({
      ...defaultMarkdownCopy,
      sourcesCount: (count: number) => t`${plural(count, { one: "# source", other: "# sources" })}`,
      visualUnavailable: t`Couldn't draw this visual`,
    }),
    [t],
  );
  const mentionLink = useContext(MessageMentionsContext);
  const userMentions = useContext(UserMentionsContext);
  const openPage = useContext(OpenPageContext);
  // User messages keep literal Markdown; only explicit URLs, email addresses and page links link.
  // Links stay the bubble's text colour (underlined): link blue is too faint on chatUser.
  return role === "user" ? (
    <LinkifiedText
      color={received ? tokens.foreground : tokens.chatUserForeground}
      linkColor={received ? tokens.foreground : tokens.chatUserForeground}
      palette={tokens}
      renderText={
        userMentions
          ? (run) =>
              splitMentionText(run, userMentions.targets).map((part, index) =>
                part.target ? (
                  <UserMention
                    key={index}
                    target={part.target}
                    label={part.text.slice(1)}
                    color={tokens.chatUserForeground}
                    onOpenBot={userMentions.onOpenBot}
                  />
                ) : (
                  part.text
                ),
              )
          : undefined
      }
      onOpenPage={openPage}
    >
      {text}
    </LinkifiedText>
  ) : (
    <MarkdownCopyProvider copy={markdownCopy}>
      <ChatMarkdown
        palette={tokens}
        colorScheme={colorScheme}
        streaming={streaming}
        mentionLink={mentionLink}
        onOpenPage={openPage}
        sources={sources}
        sourcesRow={sourcesRow}
        visuals={visuals}
      >
        {text}
      </ChatMarkdown>
    </MarkdownCopyProvider>
  );
}
