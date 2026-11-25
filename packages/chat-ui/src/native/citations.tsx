import type { SourceItem } from "@rakazo/core/answer-sources";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
// Chosen when the iOS API is present. Android and a missing sheet use Alert in this same file.
// biome-ignore lint/correctness/useReactNativePlatformComponents: runtime check, not an iOS-only module
import { ActionSheetIOS, Alert, Platform, Pressable, Text, View } from "react-native";
import { FaviconTile } from "./links";
import { layout } from "./styles";

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
