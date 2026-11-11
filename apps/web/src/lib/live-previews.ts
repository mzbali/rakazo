import type { RefObject } from "react";
import { useEffect, useState } from "react";

/** The nearest ancestor that scrolls, so "near view" is measured along the chat, not the window. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(at).overflowY)) return at;
  }
  return null;
}

/**
 * Sandboxed frames in the chat (page previews and visuals) kept running after they leave view,
 * so scrolling back shows them drawn. They share one budget, so a long chat runs a bounded number.
 */
const LIVE_FRAMES = 24;
const liveFrames = new Map<object, { near: boolean; drop: () => void }>();

/**
 * Whether the element's frame may run: it starts once the element scrolls near view and keeps
 * running until newer frames push it out of the shared live set.
 */
export function useLiveNearView(box: RefObject<HTMLElement | null>): boolean {
  const [live, setLive] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const key = {};
    const drop = () => {
      liveFrames.delete(key);
      setLive(false);
    };
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (!entry.isIntersecting) {
          const frame = liveFrames.get(key);
          if (frame) frame.near = false;
          return;
        }
        liveFrames.delete(key);
        liveFrames.set(key, { near: true, drop });
        setLive(true);
        let over = liveFrames.size - LIVE_FRAMES;
        for (const [other, frame] of liveFrames) {
          if (over <= 0) break;
          if (other === key || frame.near) continue;
          frame.drop();
          over--;
        }
      },
      { root: scrollParent(element), rootMargin: "400px 0px" },
    );
    near.observe(element);
    return () => {
      near.disconnect();
      liveFrames.delete(key);
    };
  }, [box]);
  return live;
}
