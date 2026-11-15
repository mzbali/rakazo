import { useLingui } from "@lingui/react/macro";
import { cloudAgentElapsed, cloudAgentTicking } from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import { Pressable, Text, View } from "react-native";
import { mobileTokens } from "../../lib/appearance";
import { hapticSelection } from "../../lib/haptics";
import { useNow } from "../../lib/job-format";
import type { JobPill } from "../../lib/job-pill";
import { JobStatusDot, jobToneColor } from "../job-status";

/**
 * A quiet pill above the composer while the chat has T3 jobs going: how many are working and for
 * how long, or "Needs you" in the attention colour while one waits on the owner. Tapping opens it.
 */
export function ThreadJobsPill({ pill, onPress }: { pill: JobPill; onPress: () => void }) {
  const { t } = useLingui();
  const tokens = mobileTokens();
  const { job } = pill;
  const started = job.startedAt ? Date.parse(job.startedAt) : undefined;
  const now = useNow(cloudAgentTicking(job), started);
  const needsYou = pill.kind === "needsYou";
  const elapsed = needsYou ? undefined : cloudAgentElapsed(job, now);
  const text = needsYou
    ? t`Needs you`
    : pill.count === 1
      ? t`1 job working`
      : t`${pill.count} jobs working`;
  return (
    <View pointerEvents="box-none" style={{ alignItems: "flex-start", paddingBottom: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={elapsed ? `${text}, ${elapsed}` : text}
        onPress={() => {
          hapticSelection();
          onPress();
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 999,
          backgroundColor: tokens.card,
          borderWidth: 1,
          borderColor: tokens.border,
        }}
      >
        <JobStatusDot tone={needsYou ? "attention" : "active"} tokens={tokens} />
        <Text
          style={{
            color: needsYou ? jobToneColor(tokens, "attention") : tokens.mutedForeground,
            fontWeight: needsYou ? "600" : "500",
            ...typeScale.footnote,
          }}
        >
          {text}
        </Text>
        {elapsed ? (
          <Text
            style={{
              color: tokens.faintForeground,
              fontVariant: ["tabular-nums"],
              ...typeScale.footnote,
            }}
          >
            {elapsed}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}
