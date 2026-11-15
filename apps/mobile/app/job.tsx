import { useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/native";
import { cloudAgentPhase } from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Alert, Linking, ScrollView, Text, View } from "react-native";
import { JobProofImages } from "../components/job-proof";
import { JobRow } from "../components/job-row";
import { useJobPhaseLabel } from "../components/job-status";
import { JobWorkList } from "../components/job-work";
import { LoadFailure } from "../components/load-failure";
import { NativeActionButton } from "../components/native-action-button";
import { mobileTokens } from "../lib/appearance";
import { useCloudJob } from "../lib/cloud-job";
import { clearCloudJob } from "../lib/cloud-jobs-store";
import { jobChatTarget } from "../lib/job-chat-target";
import { jobLinks } from "../lib/job-links";
import { jobIsClearable } from "../lib/job-shelves";
import { native, useResolvedAppearance } from "../lib/native";
import { errorText } from "../lib/user-error";

/** One job opened from its card: what it was asked, what it reported, and where to go next. */
export default function JobSheet() {
  const { agentId = "" } = useLocalSearchParams<{ agentId?: string }>();
  return <JobDetails key={agentId} agentId={agentId} />;
}

function JobDetails({ agentId }: { agentId: string }) {
  const { t } = useLingui();
  const router = useRouter();
  const tokens = mobileTokens();
  const colorScheme = useResolvedAppearance();
  const phaseLabel = useJobPhaseLabel();
  const { detail, error, refresh } = useCloudJob(agentId);
  const job = detail?.job;
  if (!job)
    return (
      <View style={{ minHeight: 160, padding: 20, backgroundColor: native.groupedPage }}>
        {error ? (
          <LoadFailure
            message={errorText(error, t`Could not load job`)}
            onRetry={() => void refresh()}
          />
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  const { t3: href, pr: prHref } = jobLinks(job);
  const details = [job.projectName, job.branch].filter(Boolean);
  const label = {
    color: tokens.mutedForeground,
    ...typeScale.footnote,
    fontWeight: "600" as const,
  };
  return (
    <ScrollView
      style={{ backgroundColor: native.groupedPage }}
      contentContainerStyle={{ padding: 20, paddingTop: 24, gap: 20 }}
    >
      {job.proofImages?.length ? (
        <View style={{ marginHorizontal: -12 }}>
          <JobProofImages
            job={job}
            target={job.groupId ? { groupId: job.groupId } : { botId: job.botId }}
          />
        </View>
      ) : null}
      <JobRow job={job} model />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {href ? (
          <NativeActionButton
            label={t`Open in T3`}
            prominence="secondary"
            size="compact"
            onPress={() => {
              Linking.openURL(href).catch(() => undefined);
            }}
          />
        ) : null}
        {prHref ? (
          <NativeActionButton
            label={t`View PR`}
            prominence="secondary"
            size="compact"
            onPress={() => {
              Linking.openURL(prHref).catch(() => undefined);
            }}
          />
        ) : null}
        <NativeActionButton
          label={t`Open chat`}
          prominence="secondary"
          size="compact"
          onPress={() => {
            router.dismiss();
            router.push({ pathname: "/thread", params: jobChatTarget(job) });
          }}
        />
        {jobIsClearable(job) ? (
          <NativeActionButton
            label={t`Clear from list`}
            prominence="secondary"
            size="compact"
            onPress={() => {
              clearCloudJob(job.agentId)
                .then(() => router.dismiss())
                .catch((error: unknown) =>
                  Alert.alert(t`Could not clear the job`, errorText(error)),
                );
            }}
          />
        ) : null}
      </View>
      <JobWorkList job={job} />
      {details.length ? (
        <View style={{ gap: 6 }}>
          <Text style={label}>{t`Details`}</Text>
          {details.map((detail) => (
            <Text
              key={detail}
              selectable
              style={{ color: tokens.foreground, ...typeScale.secondary }}
            >
              {detail}
            </Text>
          ))}
        </View>
      ) : null}
      {job.note && !job.model ? (
        <Text style={{ color: tokens.mutedForeground, ...typeScale.footnote }}>{job.note}</Text>
      ) : null}
      {detail?.brief ? (
        <View style={{ gap: 6 }}>
          <Text style={label}>{t`Brief`}</Text>
          <Text selectable style={{ color: tokens.foreground, ...typeScale.secondary }}>
            {detail.brief}
          </Text>
        </View>
      ) : null}
      {job.attempts?.length ? (
        <View style={{ gap: 6 }}>
          <Text style={label}>{t`Earlier attempts`}</Text>
          {job.attempts.map((attempt) => (
            <Text
              key={attempt.agentId}
              style={{ color: tokens.mutedForeground, ...typeScale.footnote }}
            >
              {[phaseLabel(cloudAgentPhase(attempt)), attempt.failureReason]
                .filter(Boolean)
                .join(": ")}
            </Text>
          ))}
        </View>
      ) : null}
      {detail?.result ? (
        <View style={{ gap: 6 }}>
          <Text style={label}>{t`Thread's report`}</Text>
          <ChatMarkdown palette={tokens} colorScheme={colorScheme} streaming={false}>
            {detail.result}
          </ChatMarkdown>
        </View>
      ) : null}
    </ScrollView>
  );
}
