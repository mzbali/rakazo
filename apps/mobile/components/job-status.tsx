import { useLingui } from "@lingui/react/macro";
import type { CloudAgentPhase, CloudAgentTone } from "@rakazo/core";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { mobileTokens } from "../lib/appearance";

type MobileTokens = ReturnType<typeof mobileTokens>;

/** The colour for a job's tone: the monochrome app's status colours, sky while it works. */
export function jobToneColor(tokens: MobileTokens, tone: CloudAgentTone): string {
  switch (tone) {
    case "attention":
      return tokens.warning;
    case "active":
      return tokens.statusWorking;
    case "success":
      return tokens.success;
    case "danger":
      return tokens.destructive;
    default:
      return tokens.mutedForeground;
  }
}

export function useJobPhaseLabel() {
  const { t } = useLingui();
  return (phase: CloudAgentPhase): string => {
    switch (phase) {
      case "starting":
        return t`Starting`;
      case "working":
        return t`Working`;
      case "checking":
        return t`Checking`;
      case "done":
        return t`Done`;
      case "needsYou":
        return t`Needs you`;
      case "resumes":
        return t`Resumes`;
      case "couldntStart":
        return t`Couldn't start`;
      case "stopped":
        return t`Stopped`;
      default:
        return t`Expired`;
    }
  };
}

const DOT = 8;

/** A filled dot in the job's tone; it breathes while the job is at work. */
export function JobStatusDot({ tone, tokens }: { tone: CloudAgentTone; tokens: MobileTokens }) {
  const reducedMotion = useReducedMotion();
  const pulse = useSharedValue(1);
  const running = tone === "active";
  useEffect(() => {
    if (running && !reducedMotion) {
      pulse.value = withRepeat(
        withSequence(withTiming(0.35, { duration: 900 }), withTiming(1, { duration: 900 })),
        -1,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = 1;
    }
    return () => cancelAnimation(pulse);
  }, [running, reducedMotion, pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <View accessible={false} style={{ width: DOT, height: DOT }}>
      <Animated.View
        style={[
          {
            width: DOT,
            height: DOT,
            borderRadius: DOT / 2,
            backgroundColor: jobToneColor(tokens, tone),
          },
          style,
        ]}
      />
    </View>
  );
}
