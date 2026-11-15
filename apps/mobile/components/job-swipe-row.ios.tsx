import { Button, Host, List, RNHostView, SwipeActions } from "@expo/ui/swift-ui";
import {
  labelStyle,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listStyle,
  scrollContentBackground,
  scrollDisabled,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { PlatformColor, useWindowDimensions, View } from "react-native";
import { native, useResolvedAppearance } from "../lib/native";
import type { JobSwipeRowProps } from "./job-swipe-row";

// Measured row heights, so recycled and reopened rows start at their size instead of 0.
const rowHeights = new Map<string, number>();
let lastRowHeight = 0;

/**
 * A finished job inside a one-row SwiftUI list, which gives it the system swipe with full swipe
 * and haptics, like the inbox rows. The FlatList around it keeps scrolling and shelves.
 */
export function JobSwipeRow({ rowKey, clearable, onClear, children }: JobSwipeRowProps) {
  const { t } = useLingui();
  const scheme = useResolvedAppearance();
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width);
  const [height, setHeight] = useState(() => rowHeights.get(rowKey) ?? lastRowHeight);
  if (!clearable) return children;
  return (
    <View
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next > 0 && next !== width) setWidth(next);
      }}
    >
      <Host style={{ height }} colorScheme={scheme} ignoreSafeArea="all">
        <List
          modifiers={[listStyle("plain"), scrollDisabled(true), scrollContentBackground("hidden")]}
        >
          <SwipeActions
            modifiers={[
              listRowInsets({ top: 0, leading: 0, bottom: 0, trailing: 0 }),
              listRowSeparator("hidden"),
              listRowBackground(native.page),
            ]}
          >
            <RNHostView matchContents>
              <View
                style={{ width }}
                onLayout={(event) => {
                  const next = Math.ceil(event.nativeEvent.layout.height);
                  if (next <= 0 || next === height) return;
                  rowHeights.set(rowKey, next);
                  lastRowHeight = next;
                  setHeight(next);
                }}
              >
                {children}
              </View>
            </RNHostView>
            <SwipeActions.Actions edge="trailing">
              <Button
                label={t`Clear`}
                systemImage="checkmark"
                modifiers={[labelStyle("iconOnly"), tint(PlatformColor("systemGray"))]}
                onPress={onClear}
              />
            </SwipeActions.Actions>
          </SwipeActions>
        </List>
      </Host>
    </View>
  );
}
