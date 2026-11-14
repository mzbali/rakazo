import { useLingui } from "@lingui/react/macro";
import { allowedAppLink, ChatMarkdown } from "@rakazo/chat-ui/native";
import { cloudAgentHttpsUrl } from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Linking, ScrollView, Text, View } from "react-native";
import { JobRow } from "../components/job-row";
import { LoadFailure } from "../components/load-failure";
import { NativeActionButton } from "../components/native-action-button";
import { mobileTokens } from "../lib/appearance";
import { useCloudJob } from "../lib/cloud-job";
import { jobChatTarget } from "../lib/job-chat-target";
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
  const prHref = cloudAgentHttpsUrl(job.prUrl);
  const href = prHref ?? cloudAgentHttpsUrl(job.url) ?? allowedAppLink(job.url);
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
      <JobRow job={job} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {href ? (
          <NativeActionButton
            label={prHref ? t`Pull request` : t`Open`}
            prominence="secondary"
            size="compact"
            onPress={() => {
              Linking.openURL(href).catch(() => undefined);
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
      </View>
      {job.note ? (
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
      {detail?.result ? (
        <View style={{ gap: 6 }}>
          <Text style={label}>{t`Result`}</Text>
          <ChatMarkdown palette={tokens} colorScheme={colorScheme} streaming={false}>
            {detail.result}
          </ChatMarkdown>
        </View>
      ) : null}
    </ScrollView>
  );
}
