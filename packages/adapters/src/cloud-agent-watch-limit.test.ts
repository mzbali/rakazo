import { describe, expect, it } from "vitest";
import { WATCH_LIMIT_MS, watchOutlasted } from "./cloud-agent-watch.js";

const since = new Date("2026-11-14T10:00:00Z");
const at = (ms: number) => new Date(since.getTime() + ms);

describe("a job that only watches its pull request", () => {
  it("keeps waiting until the limit, then is handed back", () => {
    const watching = { status: "running", watchIdle: true } as const;
    expect(watchOutlasted(watching, { watchingSince: since }, at(WATCH_LIMIT_MS - 1))).toBe(false);
    expect(watchOutlasted(watching, { watchingSince: since }, at(WATCH_LIMIT_MS))).toBe(true);
  });

  it("is never handed back without a watch, or once it has ended", () => {
    const late = at(WATCH_LIMIT_MS * 2);
    expect(
      watchOutlasted({ status: "running", watchIdle: false }, { watchingSince: since }, late),
    ).toBe(false);
    expect(
      watchOutlasted({ status: "running", watchIdle: true }, { watchingSince: null }, late),
    ).toBe(false);
    expect(
      watchOutlasted({ status: "finished", watchIdle: true }, { watchingSince: since }, late),
    ).toBe(false);
  });
});
