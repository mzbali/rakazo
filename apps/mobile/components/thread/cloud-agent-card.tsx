import { useLingui } from "@lingui/react/macro";
import type { MessageBlock } from "@rakazo/contracts";
import { cloudAgentJobTone, cloudAgentPhase } from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Linking, Pressable, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { mobileTokens } from "../../lib/appearance";
import type { MobileArtifactTarget } from "../../lib/artifact-open";
import { hapticSelection } from "../../lib/haptics";
import { phaseCounts } from "../../lib/job-format";
import { jobLinks } from "../../lib/job-links";
import type { UserBubble } from "../../lib/user-bubble";
import { withUserBubble } from "../../lib/user-bubble";
import { JobChecksChip, JobProofImages } from "../job-proof";
import { JobRow } from "../job-row";
import { JobStatusDot, jobToneColor, useJobPhaseLabel } from "../job-status";
import { NativeActionButton } from "../native-action-button";
import { NativeSymbol } from "../native-symbol";
import { JobOwnerActions } from "./job-owner-actions";
import type { MessageActionProps } from "./message-bubble";

type Job = Extract<MessageBlock, { kind: "cloud_agent" }>;

const BAR = 2;

/** A slim bar that sweeps along the card's foot while a job runs, still under reduced motion. */
function LiveBar({ color }: { color: string }) {
  const reducedMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const sweep = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion || width === 0) return;
    sweep.value = 0;
    sweep.value = withRepeat(withTiming(1, { duration: 1600 }), -1);
    return () => cancelAnimation(sweep);
  }, [reducedMotion, width, sweep]);
  const segment = width * 0.3;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: reducedMotion ? 0 : -segment + sweep.value * (width + segment) }],
  }));
  return (
    <View
      accessible={false}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: BAR,
        overflow: "hidden",
      }}
    >
      <Animated.View
        style={[
          { width: segment || "30%", height: BAR, backgroundColor: color, opacity: 0.7 },
          style,
        ]}
      />
    </View>
  );
}

/**
 * Cloud-agent jobs in a chat, as T3 draws its subagents: a bordered block of rows, each a status
 * dot, title, coloured state and elapsed time. Opening a row shows the job; several from one
 * message fold behind a header that counts them by state.
 */
export function CloudAgentCards({
  jobs,
  lead,
  actionProps,
  userBubble,
  threadTarget,
}: {
  jobs: Job[];
  /** The bot's lead-in text, drawn at the top of the card. */
  lead?: ReactNode;
  actionProps: MessageActionProps;
  userBubble?: UserBubble;
  /** Whose files the screenshots are; without it the card shows none. */
  threadTarget?: MobileArtifactTarget;
}) {
  const tokens = withUserBubble(mobileTokens(), userBubble);
  const { t } = useLingui();
  const router = useRouter();
  const windowWidth = useWindowDimensions().width;
  const phaseLabel = useJobPhaseLabel();
  const [open, setOpen] = useState(false);
  const grouped = jobs.length > 1;
  const phases = jobs.map(cloudAgentPhase);
  const tones = jobs.map(cloudAgentJobTone);
  const running = tones.includes("active");
  const headline = tones.includes("attention")
    ? "attention"
    : running
      ? "active"
      : tones.includes("danger")
        ? "danger"
        : "success";
  const counts = [...phaseCounts(phases)]
    .map(([phase, count]) => `${count} ${phaseLabel(phase)}`)
    .join(" · ");
  const count = jobs.length;
  const heading = t`${count} jobs`;
  return (
    <View
      {...actionProps}
      testID="cloud-agent-card"
      style={{
        width: Math.min(windowWidth - 40, 560),
        borderRadius: 14,
        borderWidth: 1,
        borderColor: tokens.border,
        backgroundColor: tokens.card,
        padding: 4,
        overflow: "hidden",
      }}
    >
      {lead ? <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>{lead}</View> : null}
      {grouped ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${heading}, ${counts}`}
          accessibilityState={{ expanded: open }}
          onPress={() => {
            hapticSelection();
            setOpen((value) => !value);
          }}
          style={({ pressed }) => ({
            minHeight: 56,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            borderRadius: 10,
            paddingHorizontal: 12,
            backgroundColor: pressed ? tokens.muted : "transparent",
          })}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {jobs.slice(0, 3).map((job, index) => (
              <View
                key={job.agentId}
                style={{
                  marginLeft: index === 0 ? 0 : -7,
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: tokens.border,
                  backgroundColor: tokens.card,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <JobStatusDot tone={tones[index]!} tokens={tokens} />
              </View>
            ))}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text
              numberOfLines={1}
              style={{ color: tokens.foreground, ...typeScale.secondary, fontWeight: "500" }}
            >
              {heading}
            </Text>
            <Text
              numberOfLines={1}
              style={{ color: jobToneColor(tokens, headline), ...typeScale.footnote }}
            >
              {counts}
            </Text>
          </View>
          <NativeSymbol
            ios={open ? "chevron.up" : "chevron.down"}
            android={open ? "chevron-up" : "chevron-down"}
            size={11}
            color={tokens.faintForeground}
          />
        </Pressable>
      ) : null}
      {!grouped || open
        ? jobs.map((job) => {
            const links = jobLinks(job);
            return (
              <View key={job.agentId}>
                {threadTarget ? <JobProofImages job={job} target={threadTarget} /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${job.title}: ${phaseLabel(cloudAgentPhase(job))}`}
                  onPress={() => {
                    hapticSelection();
                    router.push({ pathname: "/job", params: { agentId: job.agentId } });
                  }}
                  style={({ pressed }) => ({
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                    backgroundColor: pressed ? tokens.muted : "transparent",
                  })}
                >
                  <JobRow job={job} chevron />
                </Pressable>
                <JobOwnerActions
                  job={job}
                  links={
                    links.t3 || links.pr ? (
                      <>
                        {links.t3 ? (
                          <NativeActionButton
                            label={t`Open in T3`}
                            prominence="secondary"
                            size="compact"
                            onPress={() => {
                              Linking.openURL(links.t3!).catch(() => undefined);
                            }}
                          />
                        ) : null}
                        {links.pr ? (
                          <NativeActionButton
                            label={t`View PR`}
                            prominence="secondary"
                            size="compact"
                            onPress={() => {
                              Linking.openURL(links.pr!).catch(() => undefined);
                            }}
                          />
                        ) : null}
                        {links.pr ? <JobChecksChip checks={job.checks} /> : null}
                      </>
                    ) : undefined
                  }
                />
              </View>
            );
          })
        : null}
      {running ? <LiveBar color={tokens.statusWorking} /> : null}
    </View>
  );
}
