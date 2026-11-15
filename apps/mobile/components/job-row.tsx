import { useLingui } from "@lingui/react/macro";
import type { CloudAgentJob } from "@rakazo/contracts";
import { cloudAgentModelLabel, cloudAgentState, cloudAgentTone } from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import { memo } from "react";
import { Text, View } from "react-native";
import { formatActivityRelativeTime } from "../lib/activity";
import { mobileTokens } from "../lib/appearance";
import { formatElapsed, useNow } from "../lib/job-format";
import { JobStatusDot, jobToneColor, useJobStateLabel } from "./job-status";
import { NativeSymbol } from "./native-symbol";

/** The job's own fields; the jobs list adds the bot and chat on top. */
export type JobRowJob = Omit<CloudAgentJob, "botId" | "botName" | "threadId"> &
  Partial<Pick<CloudAgentJob, "botName">>;

/**
 * One job as a T3-style row: status dot, title, the state in its colour, elapsed time on the
 * right; below it the model, project and branch with small icons, then what waits on the owner.
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
  const stateLabel = useJobStateLabel();
  const state = cloudAgentState(job);
  const tone = jobToneColor(tokens, cloudAgentTone(state));
  const started = job.startedAt ? Date.parse(job.startedAt) : undefined;
  const live = state === "running" || state === "queued" || state === "needsInput";
  const now = useNow(live && started !== undefined, started);
  const time =
    started === undefined
      ? ""
      : live
        ? formatElapsed(now - started)
        : formatActivityRelativeTime(job.startedAt!);
  const model = cloudAgentModelLabel(job.note);
  const muted = { color: tokens.mutedForeground, ...typeScale.footnote };
  const ownerQuestion = job.ownerQuestion;
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ height: 20, justifyContent: "center" }}>
        <JobStatusDot state={state} tokens={tokens} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ minHeight: 20, flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <Text
            numberOfLines={2}
            style={{
              flex: 1,
              color: tokens.foreground,
              ...typeScale.secondary,
              fontWeight: "500",
            }}
          >
            {job.title || t`Cloud agent`}
          </Text>
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
          <Text style={{ flexShrink: 0, color: tone, ...typeScale.footnote, fontWeight: "500" }}>
            {job.launchFailed
              ? t`Couldn't start`
              : job.review === "checking" && state !== "needsInput"
                ? t`Checking`
                : stateLabel(state)}
          </Text>

          {model ? (
            <>
              <Text style={muted}>·</Text>
              <NativeSymbol
                ios="cpu"
                android="hardware-chip-outline"
                size={11}
                color={tokens.mutedForeground}
              />
              <Text numberOfLines={1} style={{ ...muted, flexShrink: 0 }}>
                {model}
              </Text>
            </>
          ) : null}
          {job.projectName ? (
            <>
              <Text style={muted}>·</Text>
              <NativeSymbol
                ios="folder"
                android="folder-outline"
                size={11}
                color={tokens.mutedForeground}
              />
              <Text numberOfLines={1} style={{ ...muted, flexShrink: 1 }}>
                {job.projectName}
              </Text>
            </>
          ) : null}
          {job.branch ? (
            <>
              <Text style={muted}>·</Text>
              <NativeSymbol
                ios="arrow.triangle.branch"
                android="git-branch-outline"
                size={11}
                color={tokens.mutedForeground}
              />
              <Text numberOfLines={1} style={{ ...muted, flexShrink: 2 }}>
                {job.branch}
              </Text>
            </>
          ) : null}
        </View>
        {job.botName ? (
          <Text numberOfLines={1} style={muted}>
            {job.botName}
          </Text>
        ) : null}
        {state === "failed" && job.failureReason ? (
          <Text numberOfLines={3} style={{ color: tokens.destructive, ...typeScale.footnote }}>
            {job.failureReason}
          </Text>
        ) : null}
        {state === "needsInput" && job.ownerQuestion ? (
          <Text numberOfLines={3} style={{ color: tokens.warning, ...typeScale.footnote }}>
            {t`Needs you: ${ownerQuestion}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
});
