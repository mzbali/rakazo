import { useLingui } from "@lingui/react/macro";
import type { CloudAgentState, CloudAgentTone } from "@rakazo/core";
import { cloudAgentTone } from "@rakazo/core";
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

/** The colour for a job's tone: the monochrome app's status colours, ink while it works. */
export function jobToneColor(tokens: MobileTokens, tone: CloudAgentTone): string {
  switch (tone) {
    case "attention":
      return tokens.warning;
    case "active":
      return tokens.primary;
    case "success":
      return tokens.success;
    case "danger":
      return tokens.destructive;
    default:
      return tokens.mutedForeground;
  }
}

export function useJobStateLabel() {
  const { t } = useLingui();
  return (state: CloudAgentState): string => {
    switch (state) {
      case "needsInput":
        return t`needs input`;
      case "unreachable":
        return t`unreachable`;
      case "queued":
        return t`queued`;
      case "running":
        return t`running`;
      case "finished":
        return t`finished`;
      case "cancelled":
        return t`cancelled`;
      case "expired":
        return t`expired`;
      default:
        return t`failed`;
    }
  };
}

const DOT = 8;

/** A filled dot in the job's tone; it breathes while the job is running. */
export function JobStatusDot({ state, tokens }: { state: CloudAgentState; tokens: MobileTokens }) {
  const reducedMotion = useReducedMotion();
  const pulse = useSharedValue(1);
  const running = state === "running";
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
            backgroundColor: jobToneColor(tokens, cloudAgentTone(state)),
          },
          style,
        ]}
      />
    </View>
  );
}
