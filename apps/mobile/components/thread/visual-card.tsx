import { useLingui } from "@lingui/react/macro";
import { useNativeLinkConfirm } from "@rakazo/chat-ui/native";
import type { MessageBlock } from "@rakazo/contracts";
import { pageCopyRequest, pageCopyResult, pageLinkRequest } from "@rakazo/core";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { currentApiBase } from "../../lib/api";
import { useMobileTokens, useResolvedAppearance } from "../../lib/native";
import { HEADER_CONTROL_SIZE } from "../../lib/native-controls";
import {
  pageActionAllowed,
  pageDocument,
  pageMessage,
  pageTapStart,
  visualHeight,
} from "../../lib/pages";
import { NativeActionButton } from "../native-action-button";
import { SandboxedHtmlPreview } from "../sandboxed-html-preview";

type VisualBlock = Extract<MessageBlock, { kind: "visual" }>;

/** The tallest a visual draws in the chat; taller ones fade out and open whole. */
const MAX_INLINE_HEIGHT = 560;
/** The space a visual holds before it reports its height. */
const PLACEHOLDER_HEIGHT = 140;
/**
 * A visual the bot drew in the chat. In the chat it only draws: the WebView takes no touches,
 * so its code cannot act there. Tapping opens it in a sheet, where its controls work and a copy
 * or a link needs a tap on it first, as on an opened page.
 */
export function VisualCard({ block }: { block: VisualBlock }) {
  const { t } = useLingui();
  const tokens = useMobileTokens();
  const theme = useResolvedAppearance();
  const [inline, setInline] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const errorTitle = t`This page couldn't be shown.`;

  useEffect(() => {
    let active = true;
    const build = (surface: string) =>
      pageDocument(currentApiBase(), block.code, theme, errorTitle, { inline: true, surface });
    void Promise.all([build(tokens.card), build(tokens.background)])
      .then(([card, full]) => {
        if (!active) return;
        setInline(card);
        setSheet(full);
        setFailed(false);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [block.code, theme, errorTitle, tokens.card, tokens.background]);

  const shown = Math.min(height ?? PLACEHOLDER_HEIGHT, MAX_INLINE_HEIGHT);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t`Open ${block.title}`}
        accessibilityHint={block.text}
        testID="visual-card"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: tokens.card,
            borderColor: `${tokens.foreground}1F`,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <View
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={{ height: shown, overflow: "hidden" }}
        >
          {inline && !failed ? (
            <View style={{ height: height ?? shown }}>
              <SandboxedHtmlPreview
                html={inline}
                background={tokens.card}
                scrollEnabled={false}
                onMessage={(data) => {
                  const next = visualHeight(data);
                  if (next !== null) setHeight(next);
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
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        {open && sheet ? (
          <VisualSheet title={block.title} document={sheet} onClose={() => setOpen(false)} />
        ) : null}
      </Modal>
    </>
  );
}

/** The visual whole, interactive, as an opened page is: one tap, one copy or link. */
function VisualSheet({
  title,
  document,
  onClose,
}: {
  title: string;
  document: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const tokens = useMobileTokens();
  const openLink = useNativeLinkConfirm();
  const tapStart = useRef<ReturnType<typeof pageTapStart>>(null);
  const tappedAt = useRef<number | null>(null);
  return (
    <View style={[styles.sheet, { backgroundColor: tokens.background }]}>
      <View
        style={[styles.sheet, { paddingTop: HEADER_CONTROL_SIZE + 12 }]}
        onTouchStart={({ nativeEvent }) => {
          const { pageX, pageY, touches } = nativeEvent;
          tapStart.current = touches.length === 1 ? { pageX, pageY } : null;
        }}
        onTouchMove={({ nativeEvent }) => {
          tapStart.current = pageTapStart(tapStart.current, nativeEvent);
        }}
        onTouchEnd={({ nativeEvent }) => {
          if (pageTapStart(tapStart.current, nativeEvent)) tappedAt.current = Date.now();
        }}
        onTouchCancel={() => {
          tapStart.current = null;
        }}
      >
        <SandboxedHtmlPreview
          html={document}
          background={tokens.background}
          onMessage={(data, answer) => {
            if (!pageActionAllowed(tappedAt.current, Date.now())) return;
            const message = pageMessage(data);
            const url = pageLinkRequest(message);
            const copy = pageCopyRequest(message);
            if (!url && !copy) return;
            tappedAt.current = null;
            if (url) openLink(url);
            else if (copy) {
              void Clipboard.setStringAsync(copy.text)
                .catch(() => false)
                .then((ok) => answer(pageCopyResult(copy.id, ok !== false)));
            }
          }}
        />
      </View>
      <View pointerEvents="box-none" style={styles.controls}>
        <NativeActionButton
          accessibilityLabel={t`Close`}
          icon={{ ios: "xmark", android: "close", size: 20 }}
          prominence="secondary"
          onPress={onClose}
        />
        <Text
          numberOfLines={1}
          accessibilityRole="header"
          style={[styles.sheetTitle, { color: tokens.foreground }]}
        >
          {title}
        </Text>
      </View>
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
  sheet: { flex: 1 },
  // A page sheet starts below the status bar, so the close button sits at its top.
  controls: {
    position: "absolute",
    top: 6,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sheetTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
    marginRight: HEADER_CONTROL_SIZE,
  },
});
