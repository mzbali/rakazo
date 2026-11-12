import { describe, expect, it } from "vitest";
import { LIVE_FRAMES, trackLiveFrame } from "./live-previews";

function track(count: number) {
  return Array.from({ length: count }, () => {
    const frame = { live: false, tracked: null as unknown as ReturnType<typeof trackLiveFrame> };
    frame.tracked = trackLiveFrame((live) => {
      frame.live = live;
    });
    return frame;
  });
}
const running = (list: { live: boolean }[]) => list.filter((frame) => frame.live).length;

describe("the chat's live frame budget", () => {
  it("never runs more frames than the budget, even when all of them are near view", () => {
    const list = track(LIVE_FRAMES + 6);
    for (const frame of list) frame.tracked.near(true);
    expect(running(list)).toBe(LIVE_FRAMES);
    // The ones that waited start as soon as frames leave view.
    for (const frame of list.slice(0, 6)) frame.tracked.near(false);
    expect(running(list)).toBe(LIVE_FRAMES);
    expect(list.slice(LIVE_FRAMES).every((frame) => frame.live)).toBe(true);
    expect(list.slice(0, 6).every((frame) => !frame.live)).toBe(true);
    for (const frame of list) frame.tracked.remove();
  });

  it("keeps a frame running after it leaves view until another needs its place", () => {
    const [first, ...rest] = track(LIVE_FRAMES + 1);
    first!.tracked.near(true);
    first!.tracked.near(false);
    expect(first!.live).toBe(true);
    for (const frame of rest.slice(0, LIVE_FRAMES - 1)) frame.tracked.near(true);
    expect(first!.live).toBe(true);
    rest.at(-1)!.tracked.near(true);
    expect(first!.live).toBe(false);
    expect(rest.at(-1)!.live).toBe(true);
    for (const frame of [first!, ...rest]) frame.tracked.remove();
  });

  it("gives a removed frame's place to one waiting near view", () => {
    const list = track(LIVE_FRAMES + 1);
    for (const frame of list) frame.tracked.near(true);
    expect(list.at(-1)!.live).toBe(false);
    list[0]!.tracked.remove();
    expect(list.at(-1)!.live).toBe(true);
    for (const frame of list.slice(1)) frame.tracked.remove();
  });
});
