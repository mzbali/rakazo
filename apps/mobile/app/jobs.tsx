import { useLingui } from "@lingui/react/macro";
import type { CloudAgentJob } from "@rakazo/contracts";
import { cloudAgentState, cloudAgentTone } from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import { useRouter } from "expo-router";
import { memo, useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { JobStatusDot, jobToneColor, useJobStateLabel } from "../components/job-status";
import { LoadFailure } from "../components/load-failure";
import { formatActivityRelativeTime } from "../lib/activity";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useForegroundPoll } from "../lib/foreground-poll";
import { hapticSelection } from "../lib/haptics";
import { native, useThemedStyles } from "../lib/native";
import { useSideInsets } from "../lib/side-insets";
import { errorText } from "../lib/user-error";

const REFRESH_MS = 15_000;

const JobRow = memo(function JobRow({
  job,
  onOpen,
}: {
  job: CloudAgentJob;
  onOpen: (job: CloudAgentJob) => void;
}) {
  const tokens = mobileTokens();
  const stateLabel = useJobStateLabel();
  const state = cloudAgentState(job);
  const started = job.startedAt ? formatActivityRelativeTime(job.startedAt) : "";
  return (
    <Pressable
      onPress={() => {
        hapticSelection();
        onOpen(job);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${job.title}: ${stateLabel(state)}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: pressed ? native.fillPressed : "transparent",
      })}
    >
      <View style={{ height: typeScale.cardTitle.lineHeight, justifyContent: "center" }}>
        <JobStatusDot state={state} tokens={tokens} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={{ color: native.label, ...typeScale.cardTitle }}>
          {job.title}
        </Text>
        <Text numberOfLines={1} style={{ color: tokens.mutedForeground, ...typeScale.caption }}>
          <Text style={{ color: jobToneColor(tokens, cloudAgentTone(state)), fontWeight: "600" }}>
            {stateLabel(state)}
          </Text>
          {job.botName ? ` · ${job.botName}` : ""}
          {started ? ` · ${started}` : ""}
        </Text>
      </View>
    </Pressable>
  );
});

/** Every cloud-agent job the user has, newest first; a row opens the chat that holds it. */
export default function JobsScreen() {
  const { t } = useLingui();
  const router = useRouter();
  const sideInsets = useSideInsets();
  const styles = useThemedStyles(createStyles);
  const [jobs, setJobs] = useState<CloudAgentJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setJobs(await rpc("cloudAgents/list", undefined));
      setError(null);
    } catch (cause) {
      setError(errorText(cause, t`Could not load jobs`));
    }
  }, [t]);
  // Jobs change while the screen is open; the poll stops with the screen or the app.
  useForegroundPoll(load, REFRESH_MS, true);
  useEffect(() => {
    if (jobs) setRefreshing(false);
  }, [jobs]);

  const open = useCallback(
    (job: CloudAgentJob) =>
      router.push({ pathname: "/thread", params: { botId: job.botId, name: job.botName } }),
    [router],
  );

  if (!jobs) {
    return (
      <View style={[styles.empty, sideInsets]}>
        {error ? (
          <LoadFailure message={error} onRetry={() => void load()} />
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }
  if (jobs.length === 0) {
    return (
      <View style={[styles.empty, sideInsets]}>
        <Text style={styles.message}>{t`No jobs yet`}</Text>
      </View>
    );
  }
  return (
    <FlatList
      style={[styles.screen, sideInsets]}
      contentInsetAdjustmentBehavior="automatic"
      data={jobs}
      keyExtractor={(job) => job.agentId}
      renderItem={({ item }) => <JobRow job={item} onOpen={open} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      initialNumToRender={14}
      windowSize={7}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
    />
  );
}

function createStyles() {
  const tokens = mobileTokens();
  return {
    screen: { flex: 1, backgroundColor: native.page },
    empty: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: 24,
      backgroundColor: native.page,
    },
    message: { color: tokens.mutedForeground, ...typeScale.body },
    separator: { height: 0.5, marginLeft: 36, backgroundColor: tokens.border },
  };
}
