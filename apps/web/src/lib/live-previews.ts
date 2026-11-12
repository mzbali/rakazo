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
 * Sandboxed frames in the chat (page previews and visuals) share one budget, so a long chat runs
 * a bounded number. A frame keeps running after it leaves view, so scrolling back shows it drawn,
 * until a frame near view needs its place.
 */
export const LIVE_FRAMES = 24;

type Frame = { near: boolean; live: boolean; setLive: (live: boolean) => void };

/** Insertion order is age: a frame moves to the end each time it comes near view. */
const frames = new Map<object, Frame>();

function liveCount() {
  let count = 0;
  for (const frame of frames.values()) if (frame.live) count++;
  return count;
}

function setLive(frame: Frame, live: boolean) {
  if (frame.live === live) return;
  frame.live = live;
  frame.setLive(live);
}

/** Starts frames near view, oldest first, ending frames out of view to make room; never past the budget. */
function rebalance() {
  for (const frame of frames.values()) {
    if (!frame.near || frame.live) continue;
    if (liveCount() >= LIVE_FRAMES) {
      const idle = [...frames.values()].find((other) => other.live && !other.near);
      if (!idle) return;
      setLive(idle, false);
    }
    setLive(frame, true);
  }
}

/** Tracks one frame; `near` reports whether it is near view, `remove` forgets it. */
export function trackLiveFrame(onChange: (live: boolean) => void) {
  const key = {};
  const frame: Frame = { near: false, live: false, setLive: onChange };
  frames.set(key, frame);
  return {
    near(near: boolean) {
      frame.near = near;
      if (near) {
        frames.delete(key);
        frames.set(key, frame);
      }
      rebalance();
    },
    remove() {
      frames.delete(key);
      rebalance();
    },
  };
}

/** Whether the element's frame may run: near view and within the chat's shared budget. */
export function useLiveNearView(box: RefObject<HTMLElement | null>): boolean {
  const [live, setLive] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const tracked = trackLiveFrame(setLive);
    const near = new IntersectionObserver(
      ([entry]) => {
        if (entry) tracked.near(entry.isIntersecting);
      },
      { root: scrollParent(element), rootMargin: "400px 0px" },
    );
    near.observe(element);
    return () => {
      near.disconnect();
      tracked.remove();
    };
  }, [box]);
  return live;
}
