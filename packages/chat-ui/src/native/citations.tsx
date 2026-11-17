import type { SourceItem } from "@rakazo/core/answer-sources";
import type { MarkdownStyleMap } from "@ronradtke/react-native-markdown-display";
import { useContext } from "react";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
// Chosen when the iOS API is present. Android and a missing sheet use Alert in this same file.
// biome-ignore lint/correctness/useReactNativePlatformComponents: runtime check, not an iOS-only module
import { ActionSheetIOS, Alert, Platform, Pressable, Text, View } from "react-native";
import { CitationGroupsContext } from "../markdown";
import { useMarkdownLinkCopy } from "../markdown-link-prompt";
import { FaviconTile, ISOLATE, OpenLinkContext, POP_ISOLATE } from "./links";
import { layout } from "./styles";

type CitationStyles = MarkdownStyleMap & {
  cite?: StyleProp<ViewStyle>;
  cite_label?: StyleProp<TextStyle>;
  cite_punct?: StyleProp<TextStyle>;
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

export function CitationPill({
  index,
  styleMap,
  trailing,
}: {
  index: number;
  styleMap: MarkdownStyleMap;
  /** Punctuation that belongs against the pill. It sits in this view, so the gap after an inline view cannot open between them. */
  trailing?: string;
}) {
  const groups = useContext(CitationGroupsContext);
  const open = useContext(OpenLinkContext);
  const linkCopy = useMarkdownLinkCopy();
  const group = groups[index];
  const first = group?.items[0];
  if (!group || !first) return null;
  const extra = group.items.length - 1;
  const label = extra > 0 ? `${first.site} +${extra}` : first.site;
  const styles = styleMap as CitationStyles;
  // Text can't round a background, so the capsule is one inline view. The mark that follows it
  // is in the same view: a separate text run would leave a gap after the attachment.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={layout.citeRow}
      onPress={() => openSourceList(group.items, open, linkCopy.cancel)}
    >
      <View style={[layout.citePill, styles.cite]}>
        <FaviconTile href={first.url} plate={styleMap.link_favicon_plate} style={layout.citeTile} />
        <Text style={styles.cite_label} numberOfLines={1}>
          {ISOLATE}
          {label}
          {POP_ISOLATE}
        </Text>
      </View>
      {trailing ? <Text style={styles.cite_punct}>{trailing}</Text> : null}
    </Pressable>
  );
}

/** The quiet row under an answer. One source is already a pill, so the caller hides this then. */
const SOURCE_MARKS = 3;

/** The quiet pill under an answer. One source is already a pill, so the caller hides this then. */
export function SourcesCount({
  items,
  label,
  open,
  cancel,
  style,
  pill,
  mark,
  plate,
}: {
  items: readonly SourceItem[];
  label: string;
  open: (url: string) => void;
  cancel: string;
  style?: StyleProp<TextStyle>;
  pill?: StyleProp<ViewStyle>;
  mark?: StyleProp<ViewStyle>;
  plate?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={pill}
      onPress={() => openSourceList(items, open, cancel)}
    >
      <View
        style={layout.sourcesMarks}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {items.slice(0, SOURCE_MARKS).map((item, index) => (
          <View
            key={item.url}
            accessibilityLabel="source-favicon"
            accessibilityElementsHidden
            style={[mark, index > 0 ? layout.sourcesMarkOverlap : null]}
          >
            <FaviconTile href={item.url} plate={plate} style={layout.sourcesTile} />
          </View>
        ))}
      </View>
      <Text style={style}>{label}</Text>
    </Pressable>
  );
}
