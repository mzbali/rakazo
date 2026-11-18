import { useLingui } from "@lingui/react/macro";
import type { CloudAgentJob } from "@rakazo/contracts";
import { cloudAgentPhase } from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import { useRouter } from "expo-router";
import { memo, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { JobRow } from "../components/job-row";
import { useJobPhaseLabel } from "../components/job-status";
import { JobSwipeRow } from "../components/job-swipe-row";
import { LoadFailure } from "../components/ui/load-failure";
import { errorText } from "../lib/api/user-error";
import { mobileTokens } from "../lib/appearance/appearance";
import { useCloudJobs } from "../lib/cloud-jobs";
import { clearCloudJob, refreshCloudJobs } from "../lib/cloud-jobs-store";
import type { JobListItem, JobShelf } from "../lib/job-shelves";
import { jobIsClearable, jobListItems } from "../lib/job-shelves";
import { useSideInsets } from "../lib/layout/side-insets";
import { hapticSelection } from "../lib/native/haptics";
import { native, useThemedStyles } from "../lib/native/native";

const JobListRow = memo(function JobListRow({
  job,
  onOpen,
  onClear,
}: {
  job: CloudAgentJob;
  onOpen: (job: CloudAgentJob) => void;
  onClear: (job: CloudAgentJob) => void;
}) {
  const tokens = mobileTokens();
  const phaseLabel = useJobPhaseLabel();
  return (
    <JobSwipeRow rowKey={job.agentId} clearable={jobIsClearable(job)} onClear={() => onClear(job)}>
      <Pressable
        onPress={() => {
          hapticSelection();
          onOpen(job);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${job.title}: ${phaseLabel(cloudAgentPhase(job))}`}
        style={({ pressed }) => ({
          marginHorizontal: 8,
          borderRadius: 10,
          paddingHorizontal: 8,
          paddingVertical: 12,
          backgroundColor: pressed ? tokens.muted : native.page,
        })}
      >
        <JobRow job={job} chevron />
      </Pressable>
    </JobSwipeRow>
  );
});

const ShelfHeader = memo(function ShelfHeader({
  shelf,
  count,
}: {
  shelf: JobShelf;
  count: number;
}) {
  const { t } = useLingui();
  const tokens = mobileTokens();
  const label = {
    needsYou: t`Needs you`,
    working: t`Working`,
    today: t`Today`,
    earlier: t`Earlier`,
  }[shelf];
  return (
    <View
      accessibilityRole="header"
      style={{
        flexDirection: "row",
        gap: 6,
        paddingHorizontal: 16,
        paddingTop: 20,
        paddingBottom: 4,
      }}
    >
      <Text
        style={{
          color: shelf === "needsYou" ? tokens.warning : tokens.mutedForeground,
          fontWeight: "600",
          ...typeScale.footnote,
        }}
      >
        {label}
      </Text>
      <Text style={{ color: tokens.faintForeground, ...typeScale.footnote }}>{count}</Text>
    </View>
  );
});

/** The owner's jobs on shelves: what needs them, what runs, then what ended today and earlier. */
export default function JobsScreen() {
  const { t } = useLingui();
  const router = useRouter();
  const sideInsets = useSideInsets();
  const styles = useThemedStyles(createStyles);
  const { jobs, error } = useCloudJobs();
  const [refreshing, setRefreshing] = useState(false);
  const items = useMemo(() => (jobs ? jobListItems(jobs) : []), [jobs]);

  const open = useCallback(
    (job: CloudAgentJob) => router.push({ pathname: "/job", params: { agentId: job.agentId } }),
    [router],
  );
  const clear = useCallback(
    (job: CloudAgentJob) =>
      clearCloudJob(job.agentId).catch((error: unknown) =>
        Alert.alert(t`Could not clear the job`, errorText(error)),
      ),
    [t],
  );
  const renderItem = useCallback(
    ({ item }: { item: JobListItem }) =>
      item.kind === "header" ? (
        <ShelfHeader shelf={item.shelf} count={item.count} />
      ) : (
        <JobListRow job={item.job} onOpen={open} onClear={clear} />
      ),
    [open, clear],
  );

  if (!jobs) {
    return (
      <View style={[styles.empty, sideInsets]}>
        {error ? (
          <LoadFailure
            message={errorText(error, t`Could not load jobs`)}
            onRetry={() => void refreshCloudJobs()}
          />
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
      data={items}
      keyExtractor={(item) => (item.kind === "header" ? item.shelf : item.job.agentId)}
      renderItem={renderItem}
      initialNumToRender={14}
      windowSize={7}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void refreshCloudJobs().finally(() => setRefreshing(false));
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
  };
}
