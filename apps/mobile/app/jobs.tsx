import { useLingui } from "@lingui/react/macro";
import type { CloudAgentJob } from "@rakazo/contracts";
import type { CloudAgentShelf } from "@rakazo/core";
import { cloudAgentState } from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import { useRouter } from "expo-router";
import { memo, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { JobRow } from "../components/job-row";
import { useJobStateLabel } from "../components/job-status";
import { LoadFailure } from "../components/load-failure";
import { mobileTokens } from "../lib/appearance";
import { useCloudJobs } from "../lib/cloud-jobs";
import { refreshCloudJobs } from "../lib/cloud-jobs-store";
import { hapticSelection } from "../lib/haptics";
import { jobChatTarget } from "../lib/job-chat-target";
import type { JobListItem } from "../lib/job-shelves";
import { jobListItems } from "../lib/job-shelves";
import { native, useThemedStyles } from "../lib/native";
import { useSideInsets } from "../lib/side-insets";
import { errorText } from "../lib/user-error";

const REFRESH_MS = 15_000;

const JobListRow = memo(function JobListRow({
  job,
  onOpen,
}: {
  job: CloudAgentJob;
  onOpen: (job: CloudAgentJob) => void;
}) {
  const tokens = mobileTokens();
  const stateLabel = useJobStateLabel();
  return (
    <Pressable
      onPress={() => {
        hapticSelection();
        onOpen(job);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${job.title}: ${stateLabel(cloudAgentState(job))}`}
      style={({ pressed }) => ({
        marginHorizontal: 8,
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 12,
        backgroundColor: pressed ? tokens.muted : "transparent",
      })}
    >
      <JobRow job={job} chevron />
    </Pressable>
  );
});

const ShelfHeader = memo(function ShelfHeader({
  shelf,
  count,
}: {
  shelf: CloudAgentShelf;
  count: number;
}) {
  const { t } = useLingui();
  const tokens = mobileTokens();
  const label = shelf === "needsYou" ? t`Needs you` : shelf === "working" ? t`Working` : t`Done`;
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

/** Every cloud-agent job the user has, on shelves: what needs them, what runs, what is done. */
export default function JobsScreen() {
  const { t } = useLingui();
  const router = useRouter();
  const sideInsets = useSideInsets();
  const styles = useThemedStyles(createStyles);
  const { jobs, error } = useCloudJobs(REFRESH_MS);
  const [refreshing, setRefreshing] = useState(false);
  const [doneExpanded, setDoneExpanded] = useState(false);
  const items = useMemo(() => (jobs ? jobListItems(jobs, doneExpanded) : []), [jobs, doneExpanded]);

  const open = useCallback(
    (job: CloudAgentJob) => router.push({ pathname: "/thread", params: jobChatTarget(job) }),
    [router],
  );
  const renderItem = useCallback(
    ({ item }: { item: JobListItem }) => {
      if (item.kind === "header") return <ShelfHeader shelf={item.shelf} count={item.count} />;
      if (item.kind === "job") return <JobListRow job={item.job} onOpen={open} />;
      const { count } = item;
      return (
        <Pressable
          onPress={() => {
            hapticSelection();
            setDoneExpanded(true);
          }}
          accessibilityRole="button"
          style={styles.more}
        >
          <Text style={styles.moreLabel}>{t`Show ${count} more`}</Text>
        </Pressable>
      );
    },
    [open, styles, t],
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
      keyExtractor={(item) =>
        item.kind === "header" ? item.shelf : item.kind === "job" ? item.job.agentId : "more"
      }
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
    more: { paddingHorizontal: 16, paddingVertical: 12, paddingLeft: 36 },
    moreLabel: { color: tokens.link, ...typeScale.secondary },
  };
}
