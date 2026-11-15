import { useLingui } from "@lingui/react/macro";
import type { MessageBlock } from "@rakazo/contracts";
import { cloudAgentPullRequestNumber, cloudAgentPullRequestParts } from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import { Text, View } from "react-native";
import { mobileTokens } from "../lib/appearance";
import { checksChip } from "../lib/job-checks";
import { JobStatusDot, jobToneColor } from "./job-status";

type Job = Extract<MessageBlock, { kind: "cloud_agent" }>;

/** The card's one pull request line: the number, then how its checks stand and whether it is watched. */
export function JobPrLine({ job }: { job: Job }) {
  const { t } = useLingui();
  const tokens = mobileTokens();
  const number = cloudAgentPullRequestNumber(job.prUrl);
  if (number === undefined) return null;
  const words = {
    merged: t`merged`,
    closed: t`closed`,
    checksRunning: t`checks running`,
    checksPassing: t`checks passing`,
    checksFailing: t`checks failing`,
    watching: t`watching`,
  };
  const chip = job.prState ? undefined : checksChip(job.checks);
  const tone = chip?.tone ?? "muted";
  const parts = cloudAgentPullRequestParts(job);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <JobStatusDot tone={tone} tokens={tokens} />
      <Text style={{ color: jobToneColor(tokens, tone), ...typeScale.footnote }}>
        {t`PR #${number}`}
      </Text>
      {parts.map((part) => (
        <Text key={part} style={{ color: tokens.mutedForeground, ...typeScale.footnote }}>
          {words[part]}
        </Text>
      ))}
    </View>
  );
}
