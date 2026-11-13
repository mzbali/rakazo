import { useLingui } from "@lingui/react/macro";
import { useNativeLinkConfirm } from "@rakazo/chat-ui/native";
import type { MessageBlock } from "@rakazo/contracts";
import type { VisualFit } from "@rakazo/core";
import { pageCopyRequest, pageCopyResult, pageLinkRequest, visualFit } from "@rakazo/core";
import * as Clipboard from "expo-clipboard";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { currentApiBase } from "../../lib/api";
import { useMobileTokens, useResolvedAppearance } from "../../lib/native";
import { loadPageRuntime } from "../../lib/page-runtime";
import { usePageTapGate } from "../../lib/page-tap-gate";
import { pageDocumentWith, pageMessage, visualHeight } from "../../lib/pages";
import { NativeActionButton } from "../native-action-button";
import { SandboxedHtmlPreview } from "../sandboxed-html-preview";

type VisualBlock = Extract<MessageBlock, { kind: "visual" }>;

/** The tallest a visual works in the chat; taller ones show their top and open whole. */
const MAX_INLINE_HEIGHT = 560;
/** The space a visual holds before it reports its height. */
const PLACEHOLDER_HEIGHT = 140;

/** The page runtime from the user's server, loaded once per card; null until it loads. */
function usePageRuntime() {
  const [runtime, setRuntime] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void loadPageRuntime(currentApiBase())
      .then((text) => active && setRuntime(text))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);
  return { runtime, failed };
}

/**
 * A copy or a link the visual asked for, honoured only right after a tap on it, one per tap, as
 * on an opened page. Spread `touch` on the view around the WebView and pass messages to `act`.
 */
function useVisualActions() {
  const openLink = useNativeLinkConfirm();
  const gate = usePageTapGate();
  const act = (data: string, answer: (message: object) => void) => {
    if (!gate.allowed()) return;
    const message = pageMessage(data);
    const url = pageLinkRequest(message);
    const copy = pageCopyRequest(message);
    if (!url && !copy) return;
    gate.consume();
    if (url) openLink(url);
    else if (copy) {
      void Clipboard.setStringAsync(copy.text)
        .catch(() => false)
        .then((ok) => answer(pageCopyResult(copy.id, ok !== false)));
    }
  };
  return { touch: gate.touch, act };
}

/**
 * A visual the bot drew in the chat. One that fits works in place. Its Expand button
 * grows the same running view in the conversation.
 * A taller one draws its top without taking touches and opens on a tap.
 */
export function VisualCard({ block }: { block: VisualBlock }) {
  const { t } = useLingui();
  const tokens = useMobileTokens();
  const theme = useResolvedAppearance();
  const errorTitle = t`This page couldn't be shown.`;
  const { runtime } = usePageRuntime();
  const window = useWindowDimensions();
  const [height, setHeight] = useState<number | null>(null);
  const [fit, setFit] = useState<VisualFit>("drawing");
  const [open, setOpen] = useState(false);
  const actions = useVisualActions();
  const inline = useMemo(
    () =>
      runtime &&
      pageDocumentWith(runtime, block.code, theme, errorTitle, {
        inline: "card",
        surface: tokens.card,
      }),
    [runtime, block.code, theme, errorTitle, tokens.card],
  );

  const shown = open
    ? window.height * 0.8
    : Math.min(height ?? PLACEHOLDER_HEIGHT, MAX_INLINE_HEIGHT);
  const live = open || fit === "inline";
  const frame = (
    <View
      pointerEvents={live ? "auto" : "none"}
      importantForAccessibility={live ? "auto" : "no-hide-descendants"}
      accessibilityElementsHidden={!live}
      style={{ height: shown, overflow: "hidden" }}
      {...(live ? actions.touch : null)}
    >
      {inline ? (
        // Never taller than the card shows: the reported height is the content's, not the frame's.
        <View style={{ height: shown }}>
          <SandboxedHtmlPreview
            html={inline}
            background={tokens.card}
            // An inline visual that grew past the card scrolls in place.
            scrollEnabled={open || (live && height !== null && height > MAX_INLINE_HEIGHT)}
            onMessage={(data, answer) => {
              const next = visualHeight(data);
              if (next === null) {
                if (live) actions.act(data, answer);
                return;
              }
              setHeight(next);
              setFit((current) => visualFit(current, next, MAX_INLINE_HEIGHT));
            }}
          />
        </View>
      ) : null}
      {height === null ? (
        <View style={[styles.placeholder, { backgroundColor: tokens.card }]}>
          <Text numberOfLines={4} style={[styles.summary, { color: tokens.mutedForeground }]}>
            {block.text}
          </Text>
        </View>
      ) : null}
    </View>
  );
  return (
    <View
      testID="visual-card"
      style={[styles.card, { backgroundColor: tokens.card, borderColor: `${tokens.foreground}1F` }]}
    >
      {open ? (
        <View style={styles.expandedHeader}>
          <Text numberOfLines={1} style={[styles.sheetTitle, { color: tokens.foreground }]}>
            {block.title}
          </Text>
          <NativeActionButton
            accessibilityLabel={t`Close`}
            icon={{ ios: "xmark", android: "close", size: 20 }}
            prominence="secondary"
            onPress={() => setOpen(false)}
          />
        </View>
      ) : null}
      {frame}
      {open ? null : live ? (
        <View style={styles.expand}>
          <NativeActionButton
            accessibilityLabel={t`Expand ${block.title}`}
            icon={{
              ios: "arrow.up.left.and.arrow.down.right",
              android: "expand-outline",
              size: 15,
            }}
            prominence="secondary"
            size="compact"
            onPress={() => setOpen(true)}
          />
        </View>
      ) : (
        // Over the frame rather than around it, so the WebView never reloads when the fit settles.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t`Open ${block.title}`}
          accessibilityHint={block.text}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            StyleSheet.absoluteFill,
            pressed ? { backgroundColor: `${tokens.foreground}14` } : null,
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: "100%", borderRadius: 24, borderWidth: 1, overflow: "hidden" },
  placeholder: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: "flex-end",
    padding: 18,
  },
  summary: { fontSize: 15, lineHeight: 20 },
  expand: { position: "absolute", top: 10, right: 10 },
  expandedHeader: { flexDirection: "row", alignItems: "center", padding: 12 },
  sheetTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
});
