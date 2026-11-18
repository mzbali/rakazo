import type { ColorTokens } from "@rakazo/ui-tokens";
import type { ASTNode, MarkdownStyleMap } from "@ronradtke/react-native-markdown-display";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext } from "react";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import { Alert, Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import {
  bareAppLinkName,
  LinkFaviconsContext,
  linkFaviconOrigin,
  linkLabel,
  markdownLinkNeedsPrompt,
  markdownLinkSite,
  sanitizeMarkdownUrl,
  useLinkFavicon,
} from "../markdown";
import {
  useMarkdownLinkAppOrigin,
  useMarkdownLinkCopy,
  useMarkdownLinkTrust,
} from "../markdown-link-prompt";
import { astHasImage, enclosingLink } from "./ast";
import { layout } from "./styles";

// Keeps the site icon on the line of the label's first word.
export const WORD_JOINER = "\u2060";
// First-strong isolate and its pop: a label's own direction characters cannot reorder the text
// around the link.
export const ISOLATE = "\u2068";
export const POP_ISOLATE = "\u2069";

async function openSafeLink(url: string) {
  const safeUrl = sanitizeMarkdownUrl(url);
  if (!safeUrl) return;
  // Android compares schemes case-sensitively when asked whether one can open; apps register
  // theirs in lower case.
  const target = safeUrl.replace(/^[^:]+/, (scheme) => scheme.toLowerCase());
  try {
    if (await Linking.canOpenURL(target)) await Linking.openURL(target);
  } catch {
    // The app went away between the check and the launch; the tap simply does nothing.
  }
}

export const OpenLinkContext = createContext<(url: string) => void>(() => undefined);

/** Opens a link the way a chat link opens: through the prompt unless it is in-app or trusted. */
export function useNativeLinkConfirm() {
  const appOrigin = useMarkdownLinkAppOrigin();
  const copy = useMarkdownLinkCopy();
  const { sites, trust } = useMarkdownLinkTrust();
  return useCallback(
    (raw: string) => {
      const url = sanitizeMarkdownUrl(raw);
      if (!url) return;
      if (!markdownLinkNeedsPrompt(url, appOrigin, sites)) {
        void openSafeLink(url);
        return;
      }
      const site = trust ? markdownLinkSite(url) : undefined;
      // Keep the actual host visible even when userinfo or the path is very long.
      Alert.alert(
        copy.title,
        `${new URL(url).host}\n\n${url}`,
        [
          { text: copy.cancel, style: "cancel" },
          ...(trust && site
            ? [
                {
                  text: copy.alwaysOpen(site),
                  onPress: () => {
                    void openSafeLink(url);
                    trust(url);
                  },
                },
              ]
            : []),
          {
            text: copy.open,
            onPress: () => {
              void openSafeLink(url);
            },
          },
        ],
        { cancelable: true },
      );
    },
    [appOrigin, copy, sites, trust],
  );
}

export function NativeLink({
  block = false,
  href,
  ...props
}: {
  block?: boolean;
  href: string;
  children?: ReactNode;
  style?: StyleProp<TextStyle> | StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const open = useContext(OpenLinkContext);
  const onPress = (event: { defaultPrevented?: boolean }) => {
    if (!event.defaultPrevented) open(href);
  };
  return block ? (
    <Pressable
      {...props}
      style={props.style as StyleProp<ViewStyle>}
      accessibilityRole="link"
      onPress={onPress}
    />
  ) : (
    <Text
      {...props}
      style={props.style as StyleProp<TextStyle>}
      accessibilityRole="link"
      onPress={onPress}
    />
  );
}

export function linkHost(href: string): string {
  try {
    return new URL(href).host || href;
  } catch {
    return href;
  }
}

/**
 * An inline link drawn with its site icon: a website, or an app place the host gave an icon.
 * Other links keep the plain link style.
 */
export function isWebsiteLink(node: ASTNode): boolean {
  const href = sanitizeMarkdownUrl(node.attributes.href ?? "");
  return node.type === "link" && Boolean(href && linkFaviconOrigin(href)) && !astHasImage(node);
}

/** The site's icon on its plate, or the globe when it has none. */
export function FaviconTile({
  href,
  plate,
  style,
}: {
  href: string;
  plate: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  const { icon, unusable } = useLinkFavicon(href);
  const globe = useContext(LinkFaviconsContext)?.globe;
  return (
    <View style={[layout.linkTile, style, icon ? plate : undefined]}>
      {icon ? (
        <Image
          source={{ uri: icon }}
          style={layout.linkIcon}
          resizeMode="contain"
          onLoad={(event) => {
            // A 1×1 image is a tracking pixel, not an icon.
            const { width, height } = event.nativeEvent.source;
            if (width <= 1 || height <= 1) unusable();
          }}
          onError={unusable}
        />
      ) : (
        globe
      )}
    </View>
  );
}

/**
 * The words a link with a site icon shows: the author's label, a bare address shortened, or for
 * a bare app link "Open in {app}", so its address never shows, or wraps, as text.
 */
export function useLinkLabel() {
  const { openIn } = useMarkdownLinkCopy();
  return useCallback(
    (text: string, href: string) => {
      const app = bareAppLinkName(text, href);
      return app ? openIn(app) : linkLabel(text, href);
    },
    [openIn],
  );
}

/** A link drawn with its site icon before its label; `text` is the label as written. */
export function IconLink({
  href,
  text,
  children,
  style,
  labelStyle,
  plate,
}: {
  href: string;
  text: string | undefined;
  children?: ReactNode;
  style: StyleProp<TextStyle>;
  labelStyle: StyleProp<TextStyle>;
  plate: StyleProp<ViewStyle>;
}) {
  const label = useLinkLabel();
  const shown = text === undefined ? undefined : label(text, href);
  return (
    <NativeLink href={href} accessibilityLabel={shown} style={style}>
      <LinkFavicon href={href} plate={plate} />
      {WORD_JOINER}
      {ISOLATE}
      {shown === undefined ? children : <Text style={labelStyle}>{shown}</Text>}
      {POP_ISOLATE}
    </NativeLink>
  );
}

/**
 * "Open in {app}" with the app's icon, for a card's link to a place in an app. It opens the way
 * a chat link does. Nothing shows for a link the host does not allow.
 */
export function AppLinkPill({
  href,
  tokens,
}: {
  href: string;
  tokens: Pick<ColorTokens, "foreground" | "input" | "faviconPlate">;
}) {
  const open = useNativeLinkConfirm();
  if (!bareAppLinkName(href, href)) return null;
  return (
    <OpenLinkContext.Provider value={open}>
      <IconLink
        href={href}
        text={href}
        style={{ color: tokens.foreground, fontWeight: "500" }}
        labelStyle={{
          color: tokens.foreground,
          fontWeight: "500",
          textDecorationLine: "underline",
          textDecorationColor: tokens.input,
        }}
        plate={{ backgroundColor: tokens.faviconPlate, padding: 2 }}
      />
    </OpenLinkContext.Provider>
  );
}

export function LinkFavicon({ href, plate }: { href: string; plate: StyleProp<ViewStyle> }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={layout.linkMarker}
    >
      <FaviconTile href={href} plate={plate} />
    </View>
  );
}

export function textStyleForParents(
  inherited: unknown,
  parents: readonly ASTNode[],
  styleMap: MarkdownStyleMap,
) {
  if (!inherited || typeof inherited !== "object" || Array.isArray(inherited)) return undefined;
  const style = { ...(inherited as Record<string, unknown>) };
  const linkParent = enclosingLink(parents);
  if (linkParent && isWebsiteLink(linkParent)) {
    // The label style sets medium weight, but bold inside a label stays bold.
    const label = StyleSheet.flatten(styleMap.website_link_label) ?? {};
    return { ...style, ...label, fontWeight: style.fontWeight ?? label.fontWeight };
  }
  if (!linkParent || sanitizeMarkdownUrl(linkParent.attributes.href ?? "")) return style;
  const linkStyle = StyleSheet.flatten(styleMap.link) ?? {};
  const bodyStyle = StyleSheet.flatten(styleMap.body) ?? {};
  if (style.textDecorationLine === linkStyle.textDecorationLine) delete style.textDecorationLine;
  if (style.color === linkStyle.color) style.color = bodyStyle.color;
  return style;
}
