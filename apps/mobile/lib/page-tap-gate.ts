import { useMemo, useRef } from "react";
import type { GestureResponderEvent } from "react-native";
import { pageActionAllowed, pageTapStart } from "./pages";

/**
 * Lets sandboxed page code act for the person (copy, open a link, offer a reply) only right
 * after they tapped it, one action per tap. The app sees every touch on the WebView too (React
 * Native's root handler, on iOS and Android), and the page can't fake one. Spread `touch` on the
 * view around the WebView; check `allowed()` before acting and `consume()` once it acts.
 */
export function usePageTapGate() {
  const tapStart = useRef<ReturnType<typeof pageTapStart>>(null);
  const tappedAt = useRef<number | null>(null);
  return useMemo(
    () => ({
      touch: {
        onTouchStart: ({ nativeEvent }: GestureResponderEvent) => {
          // A second finger makes it a pinch.
          const { pageX, pageY, touches } = nativeEvent;
          tapStart.current = touches.length === 1 ? { pageX, pageY } : null;
        },
        onTouchMove: ({ nativeEvent }: GestureResponderEvent) => {
          tapStart.current = pageTapStart(tapStart.current, nativeEvent);
        },
        onTouchEnd: ({ nativeEvent }: GestureResponderEvent) => {
          if (pageTapStart(tapStart.current, nativeEvent)) tappedAt.current = Date.now();
        },
        onTouchCancel: () => {
          tapStart.current = null;
        },
      },
      allowed: () => pageActionAllowed(tappedAt.current, Date.now()),
      /** The tap is spent: anything else the page asks for waits for the next tap. */
      consume: () => {
        tappedAt.current = null;
      },
    }),
    [],
  );
}
