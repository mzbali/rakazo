import { useLingui } from "@lingui/react/macro";
import { cloudAgentElapsed, cloudAgentTicking } from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import { Pressable, Text, View } from "react-native";
import { mobileTokens } from "../../lib/appearance";
import { hapticSelection } from "../../lib/haptics";
import { useNow } from "../../lib/job-format";
import type { JobPill } from "../../lib/job-pill";
import { GlassSurface } from "../glass-surface";
import { JobStatusDot, jobToneColor } from "../job-status";
import { NativeSymbol } from "../native-symbol";

/**
 * A glass pill, centred above the composer, while the chat has T3 jobs going: how many are working and for
 * how long, or "Needs you" in the attention colour while one waits on the owner. Tapping lists them.
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
    <View pointerEvents="box-none" style={{ alignItems: "center", paddingBottom: 8 }}>
      <Pressable
        testID="thread-jobs-pill"
        accessibilityRole="button"
        accessibilityLabel={elapsed ? `${text}, ${elapsed}` : text}
        onPress={() => {
          hapticSelection();
          onPress();
        }}
      >
        <GlassSurface
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingStart: 14,
            paddingEnd: 10,
            paddingVertical: 8,
            borderRadius: 999,
          }}
          fallbackStyle={{
            backgroundColor: tokens.card,
            borderWidth: 1,
            borderColor: tokens.glassStroke,
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
          <NativeSymbol
            ios="chevron.right"
            android="chevron-forward"
            size={11}
            color={tokens.faintForeground}
          />
        </GlassSurface>
      </Pressable>
    </View>
  );
}
