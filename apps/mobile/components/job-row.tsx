import { useLingui } from "@lingui/react/macro";
import type { CloudAgentJob } from "@rakazo/contracts";
import {
  cloudAgentElapsed,
  cloudAgentJobTone,
  cloudAgentPhase,
  cloudAgentPullRequestNumber,
  cloudAgentTicking,
} from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import { memo } from "react";
import { Text, View } from "react-native";
import { mobileTokens } from "../lib/appearance";
import { useNow } from "../lib/job-format";
import { JobStatusDot, jobToneColor, useJobPhaseLabel } from "./job-status";
import { NativeSymbol } from "./native-symbol";

/** The job's own fields; the jobs list adds the bot and chat on top. */
export type JobRowJob = Omit<CloudAgentJob, "botId" | "botName" | "threadId"> &
  Partial<Pick<CloudAgentJob, "botName">>;

/**
 * One job as a T3-style row: status dot, title, the phase in its colour, elapsed time on the
 * right; below it what the job is saying or reported, and the pull request it opened. The model,
 * project and branch are details, in the sheet.
 */
export const JobRow = memo(function JobRow({
  job,
  chevron = false,
}: {
  job: JobRowJob;
  chevron?: boolean;
}) {
  const { t } = useLingui();
  const tokens = mobileTokens();
  const phaseLabel = useJobPhaseLabel();
  const phase = cloudAgentPhase(job);
  const tone = cloudAgentJobTone(job);
  const started = job.startedAt ? Date.parse(job.startedAt) : undefined;
  const now = useNow(cloudAgentTicking(job), started);
  const time = cloudAgentElapsed(job, now);
  const muted = { color: tokens.mutedForeground, ...typeScale.footnote };
  const prNumber = cloudAgentPullRequestNumber(job.prUrl);
  const live = phase === "starting" || phase === "working" || phase === "checking";
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ height: 20, justifyContent: "center" }}>
        <JobStatusDot tone={tone} tokens={tokens} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ minHeight: 20, flexDirection: "row", alignItems: "baseline", gap: 6 }}>
          <Text
            numberOfLines={1}
            style={{
              flexShrink: 1,
              color: tokens.foreground,
              ...typeScale.secondary,
              fontWeight: "500",
            }}
          >
            {job.title || t`Cloud agent`}
          </Text>
          <Text accessibilityElementsHidden style={muted}>
            ·
          </Text>
          <Text
            numberOfLines={1}
            style={{
              flexShrink: 0,
              color: jobToneColor(tokens, tone),
              ...typeScale.footnote,
              fontWeight: "500",
            }}
          >
            {phaseLabel(phase)}
          </Text>
          <View style={{ flex: 1 }} />
          {time ? (
            <Text
              style={{
                ...muted,
                lineHeight: typeScale.secondary.lineHeight,
                fontVariant: ["tabular-nums"],
              }}
            >
              {time}
            </Text>
          ) : null}
          {chevron ? (
            <View style={{ height: typeScale.secondary.lineHeight, justifyContent: "center" }}>
              <NativeSymbol
                ios="chevron.right"
                android="chevron-forward"
                size={12}
                color={tokens.faintForeground}
              />
            </View>
          ) : null}
        </View>
        {prNumber !== undefined ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
            <NativeSymbol
              ios="arrow.triangle.pull"
              android="git-pull-request-outline"
              size={11}
              color={tokens.mutedForeground}
            />
            <Text numberOfLines={1} style={muted}>
              {t`PR #${prNumber}`}
            </Text>
          </View>
        ) : null}
        {job.botName ? (
          <Text numberOfLines={1} style={muted}>
            {job.botName}
          </Text>
        ) : null}
        {live && job.progress ? (
          <Text numberOfLines={3} style={muted}>
            {job.progress}
          </Text>
        ) : null}
        {phase === "done" && job.resultExcerpt ? (
          <Text numberOfLines={1} style={muted}>
            {job.resultExcerpt}
          </Text>
        ) : null}
        {job.status === "failed" && job.failureReason ? (
          <Text numberOfLines={3} style={{ color: tokens.destructive, ...typeScale.footnote }}>
            {job.failureReason}
          </Text>
        ) : null}
        {phase === "needsYou" && (job.ownerQuestion ?? job.question?.text) ? (
          <Text numberOfLines={3} style={{ color: tokens.warning, ...typeScale.footnote }}>
            {job.ownerQuestion ?? job.question?.text}
          </Text>
        ) : null}
      </View>
    </View>
  );
});
