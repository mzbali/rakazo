import { useLingui } from "@lingui/react/macro";
import { useNavigation, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useLayoutEffect } from "react";
import type { CreateAction } from "./create-chooser";
import { createMenuItems } from "./create-chooser";
import { useUiLocale } from "./i18n";

/** Liquid Glass home header: account on the left; jobs (once there are any), activity, search and create on the right. */
export function useHomeHeader({
  nativeHeader,
  ready,
  hasSession,
  initials,
  activityMode,
  toggleActivityMode,
  runCreateAction,
  headerTitle,
  jobs,
}: {
  nativeHeader: boolean;
  ready: boolean;
  hasSession: boolean;
  initials: string;
  activityMode: boolean;
  toggleActivityMode: () => void;
  runCreateAction: (action: CreateAction) => void;
  headerTitle?: () => ReactNode;
  /** Set once the user has any jobs; `needsYou` is the badge. */
  jobs?: { needsYou: number };
}) {
  const navigation = useNavigation();
  const router = useRouter();
  const { t, i18n } = useLingui();
  const locale = useUiLocale();
  useLayoutEffect(() => {
    if (!nativeHeader) return;
    const signedIn = ready && hasSession;
    navigation.setOptions({
      headerShown: signedIn,
      headerTransparent: true,
      headerStyle: { backgroundColor: "transparent" },
      title: "",
      headerTitle,
      unstable_headerLeftItems: () => [
        {
          type: "button" as const,
          label: t`Account`,
          icon: { type: "sfSymbol" as const, name: "person.crop.circle" },
          accessibilityLabel: t`Account`,
          onPress: () => router.push("/account"),
        },
      ],
      unstable_headerRightItems: () => [
        ...(jobs
          ? [
              {
                type: "button" as const,
                label: t`Jobs`,
                accessibilityLabel: t`Jobs`,
                icon: { type: "sfSymbol" as const, name: "checklist" },
                ...(jobs.needsYou > 0 ? { badge: { value: jobs.needsYou } } : {}),
                onPress: () => router.push("/jobs"),
              },
            ]
          : []),
        {
          type: "button" as const,
          label: t`Activity`,
          accessibilityLabel: t`Activity`,
          icon: { type: "sfSymbol" as const, name: activityMode ? "bell.fill" : "bell" },
          selected: activityMode,
          onPress: toggleActivityMode,
        },
        {
          type: "button" as const,
          label: t`Search`,
          accessibilityLabel: t`Search`,
          identifier: "home-search-button",
          icon: { type: "sfSymbol" as const, name: "magnifyingglass" },
          onPress: () => router.push("/search"),
        },
        {
          type: "menu" as const,
          label: t`Create`,
          accessibilityLabel: t`Create`,
          icon: { type: "sfSymbol" as const, name: "plus" },
          menu: {
            items: createMenuItems.map(({ id, label, sfSymbol }) => ({
              type: "action" as const,
              label: i18n._(label),
              icon: { type: "sfSymbol" as const, name: sfSymbol },
              onPress: () => runCreateAction(id),
            })),
          },
        },
      ],
    });
  }, [
    nativeHeader,
    navigation,
    ready,
    hasSession,
    initials,
    activityMode,
    toggleActivityMode,
    runCreateAction,
    headerTitle,
    jobs?.needsYou,
    router,
    t,
    locale,
  ]);
}
