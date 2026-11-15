import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { MessageBlock } from "@rakazo/contracts";
import { cloudAgentWorkParts } from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import { Linking, Pressable, Text, View } from "react-native";
import { mobileTokens } from "../lib/appearance";

type Job = Extract<MessageBlock, { kind: "cloud_agent" }>;
type Work = NonNullable<Job["work"]>[number];
type JobWork = Pick<Job, "work" | "pullRequests">;

/** The card's second line: what the job's thread has going, counted by kind. */
export function JobWorkLine({ job }: { job: JobWork }) {
  const { t } = useLingui();
  const tokens = mobileTokens();
  const parts = cloudAgentWorkParts(job);
  if (!parts.length) return null;
  const words = (kind: (typeof parts)[number]["kind"], count: number) => {
    switch (kind) {
      case "subagent":
        return t`${plural(count, { one: "# subagent", other: "# subagents" })}`;
      case "command":
        return t`${plural(count, { one: "# command", other: "# commands" })}`;
      case "monitor":
        return t`${plural(count, { one: "# monitor", other: "# monitors" })}`;
      case "background_task":
        return t`${plural(count, { one: "# background task", other: "# background tasks" })}`;
      default:
        return t`${plural(count, { one: "watching PR", other: "watching # PRs" })}`;
    }
  };
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 12 }}>
      {parts.map((part) => (
        <Text key={part.kind} style={{ color: tokens.mutedForeground, ...typeScale.footnote }}>
          {words(part.kind, part.count)}
        </Text>
      ))}
    </View>
  );
}

/** The job sheet's list: each piece of work with its label, a child thread opening in T3, and each pull request. */
export function JobWorkList({ job }: { job: JobWork }) {
  const { t } = useLingui();
  const tokens = mobileTokens();
  const kinds = {
    subagent: t`Subagent`,
    command: t`Command`,
    monitor: t`Monitor`,
    background_task: t`Background task`,
  };
  const states = { open: t`open`, merged: t`merged`, closed: t`closed` };
  const work = job.work ?? [];
  const pullRequests = job.pullRequests ?? [];
  if (!work.length && !pullRequests.length) return null;
  const row = (key: string, title: string, note: string, url?: string) => {
    const content = (
      <View style={{ gap: 2 }}>
        <Text style={{ color: tokens.foreground, ...typeScale.secondary }} numberOfLines={2}>
          {title}
        </Text>
        <Text style={{ color: tokens.mutedForeground, ...typeScale.footnote }}>{note}</Text>
      </View>
    );
    return url ? (
      <Pressable
        key={key}
        accessibilityRole="link"
        accessibilityLabel={title}
        onPress={() => {
          Linking.openURL(url).catch(() => undefined);
        }}
      >
        {content}
      </Pressable>
    ) : (
      <View key={key}>{content}</View>
    );
  };
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: tokens.mutedForeground, ...typeScale.footnote }}>{t`Working on`}</Text>
      {work.map((item: Work, index) =>
        row(`work-${index}`, item.label || kinds[item.kind], kinds[item.kind], item.url),
      )}
      {pullRequests.map((pr) =>
        row(
          pr.url,
          t`PR #${pr.number}`,
          pr.watching && pr.state === "open" ? t`watching` : states[pr.state],
          pr.url,
        ),
      )}
    </View>
  );
}
