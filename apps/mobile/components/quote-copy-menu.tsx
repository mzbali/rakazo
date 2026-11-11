import { MenuView } from "@expo/ui/community/menu";
import { useLingui } from "@lingui/react/macro";
import * as Clipboard from "expo-clipboard";
import type { ReactNode } from "react";
import { useResolvedAppearance } from "../lib/native";

/**
 * Long-pressing a quote opens a menu for just that quote, lifted above the rest of the message:
 * its text as shown, or its Markdown. Taps still reach the quote's links and the message.
 */
export function QuoteCopyMenu({
  text,
  markdown,
  children,
}: {
  text: string;
  markdown: string;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const colorScheme = useResolvedAppearance();
  const copy = (id: string) => {
    const value = id === "markdown" ? markdown : text;
    if (value) void Clipboard.setStringAsync(value).catch(() => undefined);
  };
  return (
    <MenuView
      actions={[
        { id: "text", title: t`Copy`, image: "doc.on.doc" },
        { id: "markdown", title: t`Copy as Markdown`, image: "doc.text" },
      ]}
      colorScheme={colorScheme}
      onPressAction={(event) => copy(event.nativeEvent.event)}
      shouldOpenOnLongPress
    >
      {children}
    </MenuView>
  );
}
