import { useLingui } from "@lingui/react/macro";
import { allowedAppLink, ChatMarkdown } from "@rakazo/chat-ui/native";
import type { CloudAgentDetail } from "@rakazo/contracts";
import { cloudAgentHttpsUrl, cloudAgentState } from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { JobRow } from "../components/job-row";
import { NativeActionButton } from "../components/native-action-button";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useCloudJobs } from "../lib/cloud-jobs";
import { native, useResolvedAppearance } from "../lib/native";

/** One job opened from its card: what it was asked, what it reported, and where to go next. */
export default function JobSheet() {
  const { t } = useLingui();
  const router = useRouter();
  const tokens = mobileTokens();
  const colorScheme = useResolvedAppearance();
  const { agentId = "" } = useLocalSearchParams<{ agentId?: string }>();
  const { jobs } = useCloudJobs(15_000);
  const job = jobs?.find((candidate) => candidate.agentId === agentId);
  const [detail, setDetail] = useState<CloudAgentDetail | null>(null);
  const state = job ? cloudAgentState(job) : undefined;
  // The result arrives when the job ends, so the text is read again when its state changes.
  useEffect(() => {
    if (!agentId || !state) return;
    let live = true;
    rpc("cloudAgents/detail", { agentId })
      .then((next) => live && setDetail(next))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [agentId, state]);

  if (!job) return <View style={{ minHeight: 160, backgroundColor: native.groupedPage }} />;
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
            router.push({ pathname: "/thread", params: { botId: job.botId, name: job.botName } });
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
