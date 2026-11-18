import { ph } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/native";
import { messageSources } from "@rakazo/core/answer-sources";
import { typeScale } from "@rakazo/ui-tokens";
import { useContext } from "react";
import { Pressable, Text, View } from "react-native";
import type { MobileMessage } from "../../lib/api/mobile-types";
import { blockText } from "../../lib/api/mobile-types";
import { mobileTokens } from "../../lib/appearance/appearance";
import {
  mentionedBots,
  textWithMentions,
  UserMentionsContext,
} from "../../lib/messages/message-mentions";
import type { UserBubble } from "../../lib/messages/user-bubble";
import { withUserBubble } from "../../lib/messages/user-bubble";
import { useResolvedAppearance } from "../../lib/native/native";
import { MessageCaption } from "../messages/message-caption";
import { NativeSymbol } from "../native/native-symbol";
import type { MessageActionProps } from "./message-bubble";

const OPEN_BOT_ACTION = "open-bot:";

/** Text the Space's own bot wrote, with nothing relayed from a chat app or another bot mixed in. */
function ownBotText(message: MobileMessage): boolean {
  return (
    message.role === "bot" &&
    message.blocks.every((block) => block.kind === "text" || block.kind === "progress")
  );
}

export function MessageTextCard({
  message,
  outgoing,
  speaker,
  speakerColor,
  actionProps,
  doubleTapSurface = false,
  userBubble,
}: {
  message: MobileMessage;
  outgoing: boolean;
  speaker?: string;
  speakerColor?: string;
  actionProps: MessageActionProps;
  doubleTapSurface?: boolean;
  userBubble?: UserBubble;
}) {
  const colorScheme = useResolvedAppearance();
  const tokens = withUserBubble(mobileTokens(), userBubble);
  const contentText = blockText(message);
  const { t } = useLingui();
  const sources = message.role === "bot" ? messageSources(message.blocks) : undefined;
  const userMentions = useContext(UserMentionsContext);
  if (!contentText) return null;
  // The surface is one accessibility element, so the bots a message names are offered as its
  // actions too; a tap on the name still opens the chat for everyone else.
  const bots =
    message.role === "user" && userMentions
      ? mentionedBots(textWithMentions(contentText, userMentions.targets))
      : [];
  const accessibilityActions = bots.length
    ? [
        ...(actionProps.accessibilityActions ?? []),
        ...bots.map((bot) => ({
          name: `${OPEN_BOT_ACTION}${bot.id}`,
          label: t`Open ${ph({ name: bot.name })}`,
        })),
      ]
    : actionProps.accessibilityActions;
  // The menu wrapper owns surface gestures; links and code controls remain responders.
  const Surface = doubleTapSurface ? View : Pressable;
  return (
    <Surface
      {...actionProps}
      accessible
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={(event) => {
        const actionName = event.nativeEvent.actionName;
        const bot = bots.find((candidate) => `${OPEN_BOT_ACTION}${candidate.id}` === actionName);
        if (bot) userMentions?.onOpenBot(bot.id, bot.name);
        else actionProps.onAccessibilityAction?.(event);
      }}
      onLongPress={doubleTapSurface ? undefined : actionProps.onLongPress}
      style={
        message.role === "bot"
          ? { width: "100%", flexShrink: 1, minWidth: 0 }
          : {
              flexShrink: 1,
              minWidth: 0,
              maxWidth: "100%",
              backgroundColor: outgoing ? tokens.chatUser : tokens.muted,
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: 20,
            }
      }
    >
      {speaker ? (
        <Text
          style={{
            color: speakerColor ?? tokens.mutedForeground,
            ...typeScale.footnote,
            marginBottom: 4,
          }}
        >
          {speaker}
        </Text>
      ) : null}
      <MessageCaption
        role={message.role}
        received={!outgoing}
        text={contentText}
        tokens={tokens}
        colorScheme={colorScheme}
        streaming={message.id.startsWith("progress:")}
        sources={sources}
        sourcesRow={Boolean(sources?.length)}
        visuals={ownBotText(message)}
      />
    </Surface>
  );
}

export function AgentEventLabel({
  label,
  detail,
  expanded,
  onToggle,
  actionProps,
}: {
  label: string;
  detail?: string;
  expanded: boolean;
  onToggle: () => void;
  actionProps: MessageActionProps;
}) {
  const colorScheme = useResolvedAppearance();
  const tokens = mobileTokens();
  const { t } = useLingui();
  return (
    <Pressable
      {...actionProps}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={expanded ? t`Hide ${label}` : t`Show ${label}`}
      style={{ width: "100%", paddingVertical: 4, alignItems: "center" }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <NativeSymbol
          ios="arrow.left.arrow.right"
          android="swap-horizontal"
          size={12}
          color={tokens.mutedForeground}
        />
        <Text style={{ color: tokens.mutedForeground, fontSize: 13.5, textAlign: "center" }}>
          {label}
        </Text>
      </View>
      {expanded && detail ? (
        <View
          style={{
            width: "100%",
            marginTop: 6,
            borderRadius: 14,
            backgroundColor: tokens.card,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        >
          <ChatMarkdown palette={tokens} colorScheme={colorScheme}>
            {detail}
          </ChatMarkdown>
        </View>
      ) : null}
    </Pressable>
  );
}
