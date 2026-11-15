import { useLingui } from "@lingui/react/macro";
import type { MessageBlock } from "@rakazo/contracts";
import { cloudAgentPhase } from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import type { ReactNode } from "react";
import { useState } from "react";
import { Alert, Platform, Pressable, Text, TextInput, View } from "react-native";
import { rpc } from "../../lib/api";
import { mobileTokens } from "../../lib/appearance";
import { refreshCloudJobs } from "../../lib/cloud-jobs-store";
import { hapticSuccess } from "../../lib/haptics";
import { showIOSActionSheet } from "../../lib/ios-action-sheet";
import { errorText } from "../../lib/user-error";
import { NativeActionButton } from "../native-action-button";
import { NativeSymbol } from "../native-symbol";

type Job = Extract<MessageBlock, { kind: "cloud_agent" }>;

/**
 * What the owner can do to a job from its card: answer its question with one tap, stop it from
 * the menu, and see that their answer or instruction went through.
 */
export function JobOwnerActions({ job, links }: { job: Job; links?: ReactNode }) {
  const { t } = useLingui();
  const tokens = mobileTokens();
  const phase = cloudAgentPhase(job);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const question = phase === "needsYou" ? job.question : undefined;
  const running = job.status === "running" && !job.launchFailed;
  const note = { color: tokens.mutedForeground, ...typeScale.footnote };

  async function answer(choice: string) {
    if (!question || busy) return;
    setBusy(true);
    try {
      await rpc("cloudAgents/answer", {
        agentId: job.agentId,
        requestId: question.requestId,
        answer: choice,
      });
      hapticSuccess();
      // Home and the chat's pill read the same list, so an answered job leaves Needs you at once.
      void refreshCloudJobs();
      setReplying(false);
      setText("");
    } catch (error) {
      Alert.alert(t`Could not send your answer`, errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function confirmStop() {
    Alert.alert(t`Stop this job?`, t`It stops working now. What it has done so far is kept.`, [
      { text: t`Keep working`, style: "cancel" },
      {
        text: t`Stop job`,
        style: "destructive",
        onPress: () => {
          setStopping(true);
          rpc("cloudAgents/stop", { agentId: job.agentId })
            .then(() => refreshCloudJobs())
            .catch((error: unknown) => {
              setStopping(false);
              Alert.alert(t`Could not stop the job`, errorText(error));
            });
        },
      },
    ]);
  }

  function openMenu() {
    if (Platform.OS !== "ios") return confirmStop();
    const stop = t`Stop job`;
    showIOSActionSheet(
      { options: [stop, t`Cancel`], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (index) => {
        if (index === 0) confirmStop();
      },
    );
  }

  const choices = question?.options ?? [];
  const canType = Boolean(question) && question?.allowCustomAnswer !== false;
  const showNotes = job.answered || job.steeredAt || stopping;
  if (!running && !showNotes && !links) return null;
  return (
    <View style={{ gap: 8, paddingHorizontal: 12, paddingBottom: 12 }}>
      {question && choices.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {choices.map((choice) => {
            const label = choice.recommended ? t`${choice.label} (recommended)` : choice.label;
            return (
              <NativeActionButton
                key={choice.label}
                label={label}
                prominence={choice.recommended ? "primary" : "secondary"}
                fill={false}
                size="compact"
                busy={busy}
                onPress={() => void answer(choice.label)}
              />
            );
          })}
          {canType && !replying ? (
            <NativeActionButton
              label={t`Reply`}
              prominence="secondary"
              fill={false}
              size="compact"
              onPress={() => setReplying(true)}
            />
          ) : null}
        </View>
      ) : null}
      {canType ? (
        replying ? (
          <View style={{ gap: 8 }}>
            <TextInput
              autoFocus
              value={text}
              onChangeText={setText}
              placeholder={t`Your answer`}
              placeholderTextColor={tokens.faintForeground}
              accessibilityLabel={t`Your answer`}
              returnKeyType="send"
              onSubmitEditing={() => text.trim() && void answer(text.trim())}
              style={{
                color: tokens.foreground,
                borderColor: tokens.border,
                borderWidth: 1,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                ...typeScale.secondary,
              }}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <NativeActionButton
                label={t`Send`}
                prominence="primary"
                fill={false}
                size="compact"
                busy={busy}
                disabled={!text.trim()}
                onPress={() => void answer(text.trim())}
              />
              <NativeActionButton
                label={t`Cancel`}
                prominence="quiet"
                size="compact"
                onPress={() => setReplying(false)}
              />
            </View>
          </View>
        ) : !choices.length ? (
          <View style={{ flexDirection: "row" }}>
            <NativeActionButton
              label={t`Reply`}
              prominence="primary"
              fill={false}
              size="compact"
              onPress={() => setReplying(true)}
            />
          </View>
        ) : null
      ) : null}
      {job.answered && !question ? <Text style={note}>{t`Answered: ${job.answered}`}</Text> : null}
      {job.steeredAt && running && !stopping ? (
        <Text style={note}>{t`Your instruction was delivered`}</Text>
      ) : null}
      {stopping && running ? <Text style={note}>{t`Stopping…`}</Text> : null}
      {links || (running && !stopping) ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{links}</View>
          {running && !stopping ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t`More options`}
              onPress={openMenu}
              style={({ pressed }) => ({
                minWidth: 44,
                minHeight: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? tokens.muted : "transparent",
              })}
            >
              <NativeSymbol
                ios="ellipsis"
                android="ellipsis-horizontal"
                size={16}
                color={tokens.mutedForeground}
              />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
