import { useLingui } from "@lingui/react/macro";
import { FaviconTile, MEDIA_ROW_NATIVE_PT, useNativeLinkConfirm } from "@rakazo/chat-ui/native";
import type { MessageBlock } from "@rakazo/contracts";
import { typeScale } from "@rakazo/ui-tokens";
import { useEffect, useState } from "react";
import type { LayoutChangeEvent, PressableProps } from "react-native";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { mobileTokens } from "../lib/appearance";
import type { MobileArtifactTarget } from "../lib/artifact-open";
import { imageArtifactPreview } from "../lib/artifact-open";
import type { ImageSize } from "../lib/inline-image";
import { fitImageSize } from "../lib/inline-image";

const MAX_INLINE_HEIGHT = 360;

type ImageSource = NonNullable<Extract<MessageBlock, { kind: "image" }>["source"]>;

/** Fill the column, keeping the picture's ratio, never enlarging it, and stopping at a readable height. */
function placedImageSize(natural: ImageSize, column: number, maxHeight: number): ImageSize {
  const width = Math.max(1, natural.width);
  const height = Math.max(1, natural.height);
  const scale = Math.min(1, column / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function ImageSourceLabel({ source }: { source: ImageSource }) {
  const open = useNativeLinkConfirm();
  const tokens = mobileTokens();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={source.site}
      hitSlop={8}
      onPress={() => open(source.url)}
      style={styles.source}
    >
      <FaviconTile
        href={source.url}
        plate={{ backgroundColor: tokens.faviconPlate, padding: 2 }}
        style={styles.sourceIcon}
      />
      <Text style={[styles.sourceSite, { color: tokens.mutedForeground }]} numberOfLines={1}>
        {source.site}
      </Text>
    </Pressable>
  );
}

/**
 * An image attachment rendered inside a chat bubble. The artifact is fetched through the
 * authenticated RPC (the server does not serve artifacts to a bare URL), cached on disk and
 * shown at its natural size, scaled down to fit the bubble. Tapping it opens the viewer.
 */
export function InlineImageAttachment({
  threadTarget,
  artifactId,
  name,
  mimeType,
  onOpen,
  pressableProps,
  labelColor,
  thumbnail = false,
  fill = false,
  source,
}: {
  threadTarget: MobileArtifactTarget;
  artifactId: string;
  name: string;
  mimeType: string;
  onOpen: () => void;
  pressableProps?: Omit<PressableProps, "onPress" | "children" | "style">;
  labelColor: string;
  /** A media row: a fixed square, cropped to fill, that still opens the viewer. */
  thumbnail?: boolean;
  /** An image in an answer: as wide as the text. A photo someone sent keeps its small size. */
  fill?: boolean;
  /** The page a saved web image came from. An upload has none, and shows no label. */
  source?: ImageSource;
}) {
  const { t } = useLingui();
  const tokens = mobileTokens();
  const { width: windowWidth } = useWindowDimensions();
  const [columnWidth, setColumnWidth] = useState(0);
  const onColumnLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next > 0 && next !== columnWidth) setColumnWidth(next);
  };
  const column = columnWidth > 0 ? columnWidth : Math.max(1, Math.round(windowWidth - 32));
  const maxWidth = Math.min(Math.round(windowWidth * 0.68), 400);
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; uri: string; size: ImageSize } | { status: "error" }
  >({ status: "loading" });
  const targetBotId = "botId" in threadTarget ? threadTarget.botId : undefined;
  const targetGroupId = "groupId" in threadTarget ? threadTarget.groupId : undefined;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const target: MobileArtifactTarget =
      targetBotId !== undefined ? { botId: targetBotId } : { groupId: targetGroupId! };
    imageArtifactPreview(target, artifactId, mimeType)
      .then((loaded) => {
        if (!cancelled) setState({ status: "ready", ...loaded });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [targetBotId, targetGroupId, artifactId, mimeType]);

  if (thumbnail) {
    return (
      <Pressable
        {...pressableProps}
        accessibilityRole="imagebutton"
        accessibilityLabel={t`Open image ${name}`}
        onPress={state.status === "loading" ? undefined : onOpen}
        style={[styles.thumb, { backgroundColor: tokens.muted }]}
      >
        {state.status === "ready" ? (
          <Image
            source={{ uri: state.uri }}
            style={styles.thumbImage}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : state.status === "loading" ? (
          <ActivityIndicator
            color={tokens.mutedForeground}
            accessibilityLabel={t`Loading image…`}
          />
        ) : (
          <Text style={[styles.thumbLabel, { color: labelColor }]} numberOfLines={3}>
            {name}
          </Text>
        )}
      </Pressable>
    );
  }

  const picture =
    state.status === "ready" ? (
      <Pressable
        {...pressableProps}
        accessibilityRole="imagebutton"
        accessibilityLabel={t`Open image ${name}`}
        onPress={onOpen}
      >
        <Image
          source={{ uri: state.uri }}
          style={[
            styles.image,
            fill
              ? placedImageSize(state.size, column, MAX_INLINE_HEIGHT)
              : fitImageSize(state.size, maxWidth, MAX_INLINE_HEIGHT),
            { backgroundColor: tokens.muted },
          ]}
          accessibilityIgnoresInvertColors
        />
      </Pressable>
    ) : (
      <Pressable {...pressableProps} onPress={state.status === "error" ? onOpen : undefined}>
        <View style={[styles.placeholder, { backgroundColor: tokens.muted }]}>
          <Text style={[styles.label, { color: labelColor }]}>🖼 {name}</Text>
          {state.status === "loading" ? (
            <ActivityIndicator
              color={tokens.mutedForeground}
              accessibilityLabel={t`Loading image…`}
            />
          ) : (
            <Text style={[styles.hint, { color: tokens.mutedForeground }]}>{t`Tap to open`}</Text>
          )}
        </View>
      </Pressable>
    );
  return (
    <View style={fill ? styles.column : undefined} onLayout={fill ? onColumnLayout : undefined}>
      {picture}
      {source && !thumbnail ? <ImageSourceLabel source={source} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { width: "100%", alignSelf: "stretch" },
  image: { borderRadius: 12, overflow: "hidden" },
  source: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: 6,
    maxWidth: "100%",
  },
  sourceIcon: { width: 16, height: 16, borderRadius: 4 },
  sourceSite: { ...typeScale.caption, flexShrink: 1 },
  thumb: {
    width: MEDIA_ROW_NATIVE_PT,
    height: MEDIA_ROW_NATIVE_PT,
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImage: { width: MEDIA_ROW_NATIVE_PT, height: MEDIA_ROW_NATIVE_PT },
  thumbLabel: { fontSize: 12, textAlign: "center", paddingHorizontal: 6 },
  placeholder: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: { fontSize: 15 },
  hint: { fontSize: 13, marginTop: 2 },
});
