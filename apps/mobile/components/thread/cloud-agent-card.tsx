import { useLingui } from "@lingui/react/macro";
import { allowedAppLink } from "@rakazo/chat-ui/native";
import type { MessageBlock } from "@rakazo/contracts";
import { cloudAgentHttpsUrl, cloudAgentState, cloudAgentTone } from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { formatActivityRelativeTime } from "../../lib/activity";
import { mobileTokens } from "../../lib/appearance";
import type { UserBubble } from "../../lib/user-bubble";
import { withUserBubble } from "../../lib/user-bubble";
import { JobStatusDot, jobToneColor, useJobStateLabel } from "../job-status";
import { NativeActionButton } from "../native-action-button";
import type { MessageActionProps } from "./message-bubble";

/**
 * A cloud-agent job in the chat: a status dot and title, one line of state, the pick note
 * folded to a line until tapped, and the one action that matters (the pull request, or the job).
 */
export function CloudAgentCard({
  job,
  actionProps,
  userBubble,
}: {
  job: Extract<MessageBlock, { kind: "cloud_agent" }>;
  actionProps: MessageActionProps;
  userBubble?: UserBubble;
}) {
  const tokens = withUserBubble(mobileTokens(), userBubble);
  const { t } = useLingui();
  const stateLabel = useJobStateLabel();
  const [noteOpen, setNoteOpen] = useState(false);
  const state = cloudAgentState(job);
  const title = job.title || t`Cloud agent`;
  const prHref = cloudAgentHttpsUrl(job.prUrl);
  const href = prHref ?? cloudAgentHttpsUrl(job.url) ?? allowedAppLink(job.url);
  const since = job.unreachableSince
    ? new Date(job.unreachableSince).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const detail = state === "unreachable" ? t`Resumes when it's back · since ${since}` : job.branch;
  const started = job.startedAt ? formatActivityRelativeTime(job.startedAt) : "";
  return (
    <Pressable
      {...actionProps}
      testID="cloud-agent-card"
      accessibilityLabel={`${title}: ${stateLabel(state)}`}
      style={{
        width: "90%",
        minWidth: 300,
        borderRadius: 18,
        backgroundColor: tokens.card,
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <JobStatusDot state={state} tokens={tokens} />
        <Text
          numberOfLines={2}
          style={{ flexShrink: 1, color: tokens.cardForeground, ...typeScale.cardTitle }}
        >
          {title}
        </Text>
      </View>
      <Text style={{ color: tokens.mutedForeground, ...typeScale.caption }}>
        <Text
          style={{
            color: jobToneColor(tokens, cloudAgentTone(state)),
            fontWeight: "600",
          }}
        >
          {stateLabel(state)}
        </Text>
        {started ? ` · ${started}` : ""}
      </Text>
      {detail ? (
        <Text numberOfLines={1} style={{ color: tokens.mutedForeground, ...typeScale.secondary }}>
          {detail}
        </Text>
      ) : null}
      {job.note ? (
        <Pressable
          onPress={() => setNoteOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: noteOpen }}
          hitSlop={8}
        >
          <Text
            numberOfLines={noteOpen ? undefined : 1}
            style={{ color: tokens.mutedForeground, ...typeScale.footnote }}
          >
            {job.note}
          </Text>
        </Pressable>
      ) : null}
      {href ? (
        <NativeActionButton
          label={prHref ? t`Pull request` : t`Open`}
          prominence="secondary"
          size="compact"
          style={{ alignSelf: "flex-start", marginTop: 4 }}
          onPress={() => {
            Linking.openURL(href).catch(() => undefined);
          }}
        />
      ) : null}
    </Pressable>
  );
}
