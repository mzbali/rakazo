import { useLingui } from "@lingui/react/macro";
import { typeScale } from "@rakazo/ui-tokens";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { JobRow } from "../components/job-row";
import { mobileTokens } from "../lib/appearance";
import { useCloudJobs } from "../lib/cloud-jobs";
import { hapticSelection } from "../lib/haptics";
import { activeChatJobs } from "../lib/job-pill";
import { native } from "../lib/native";

/** The chat's jobs that are going or need the owner, opened from the pill above the composer. */
export default function ThreadJobsSheet() {
  const { botId, groupId } = useLocalSearchParams<{ botId?: string; groupId?: string }>();
  const { t } = useLingui();
  const router = useRouter();
  const tokens = mobileTokens();
  const { jobs } = useCloudJobs();
  const active = activeChatJobs(jobs, { botId, groupId });
  return (
    <ScrollView
      style={{ backgroundColor: native.groupedPage }}
      contentContainerStyle={{ padding: 20, paddingTop: 24, gap: 4 }}
    >
      {active.length === 0 ? (
        <Text
          style={{ color: tokens.mutedForeground, textAlign: "center", ...typeScale.secondary }}
        >
          {t`Nothing running`}
        </Text>
      ) : (
        active.map((job) => (
          <Pressable
            key={job.agentId}
            accessibilityRole="button"
            onPress={() => {
              hapticSelection();
              router.replace({ pathname: "/job", params: { agentId: job.agentId } });
            }}
            style={({ pressed }) => ({
              borderRadius: 10,
              paddingHorizontal: 8,
              paddingVertical: 12,
              backgroundColor: pressed ? tokens.muted : "transparent",
            })}
          >
            <View>
              <JobRow job={{ ...job, botName: undefined }} chevron model />
            </View>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}
