import type { SourceItem } from "@rakazo/core/answer-sources";
import type { MarkdownStyleMap } from "@ronradtke/react-native-markdown-display";
import { useContext } from "react";
import type { StyleProp, TextStyle } from "react-native";
// Chosen when the iOS API is present. Android and a missing sheet use Alert in this same file.
// biome-ignore lint/correctness/useReactNativePlatformComponents: runtime check, not an iOS-only module
import { ActionSheetIOS, Alert, Platform, Text } from "react-native";
import { CitationGroupsContext } from "../markdown";
import { useMarkdownLinkCopy } from "../markdown-link-prompt";
import { ISOLATE, LinkFavicon, OpenLinkContext, POP_ISOLATE, WORD_JOINER } from "./links";

type CitationStyles = MarkdownStyleMap & {
  cite?: StyleProp<TextStyle>;
};

/** The existing confirm-before-open path, after the reader picks a page from the list. */
export function openSourceList(
  items: readonly SourceItem[],
  open: (url: string) => void,
  cancel: string,
) {
  const chosen = (index: number) => {
    const item = items[index];
    if (item) open(item.url);
  };
  if (Platform.OS === "ios" && typeof ActionSheetIOS?.showActionSheetWithOptions === "function") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...items.map((item) => item.title), cancel],
        cancelButtonIndex: items.length,
      },
      chosen,
    );
    return;
  }
  Alert.alert("", undefined, [
    ...items.map((item, index) => ({ text: item.title, onPress: () => chosen(index) })),
    { text: cancel, style: "cancel" },
  ]);
}

export function CitationPill({ index, styleMap }: { index: number; styleMap: MarkdownStyleMap }) {
  const groups = useContext(CitationGroupsContext);
  const open = useContext(OpenLinkContext);
  const linkCopy = useMarkdownLinkCopy();
  const group = groups[index];
  const first = group?.items[0];
  if (!group || !first) return null;
  const extra = group.items.length - 1;
  const label = extra > 0 ? `${first.site} +${extra}` : first.site;
  const cite = (styleMap as CitationStyles).cite;
  return (
    <Text
      accessibilityRole="button"
      accessibilityLabel={label}
      style={cite}
      onPress={() => openSourceList(group.items, open, linkCopy.cancel)}
    >
      <LinkFavicon href={first.url} plate={styleMap.link_favicon_plate} />
      {WORD_JOINER}
      {ISOLATE}
      {label}
      {POP_ISOLATE}
    </Text>
  );
}

/** The quiet row under an answer. One source is already a pill, so the caller hides this then. */
export function SourcesCount({
  items,
  label,
  open,
  cancel,
  style,
}: {
  items: readonly SourceItem[];
  label: string;
  open: (url: string) => void;
  cancel: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      accessibilityRole="button"
      accessibilityLabel={label}
      style={style}
      onPress={() => openSourceList(items, open, cancel)}
    >
      {label}
    </Text>
  );
}
