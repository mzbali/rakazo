import { describe, expect, it } from "vitest";
import { parseShard, planShards } from "./e2e-shards.js";

describe("planShards", () => {
  it("evens out recorded durations instead of file counts", () => {
    const durations = { "a.spec.ts": 90, "b.spec.ts": 50, "c.spec.ts": 40, "d.spec.ts": 10 };
    const plan = planShards(Object.keys(durations), durations, 2);
    expect(plan).toEqual([
      ["a.spec.ts", "d.spec.ts"],
      ["b.spec.ts", "c.spec.ts"],
    ]);
  });

  it("places every file exactly once and gives the same plan whatever the input order", () => {
    const files = ["x.spec.ts", "y.spec.ts", "z.spec.ts", "w.spec.ts", "v.spec.ts"];
    const durations = { "x.spec.ts": 5, "y.spec.ts": 5, "z.spec.ts": 3 };
    const plan = planShards(files, durations, 3);
    expect(plan.flat().sort()).toEqual([...files].sort());
    expect(planShards([...files].reverse(), durations, 3)).toEqual(plan);
  });

  it("weighs a file without a recorded time as the median", () => {
    const durations = { "a.spec.ts": 10, "b.spec.ts": 20, "c.spec.ts": 30 };
    const plan = planShards(["a.spec.ts", "b.spec.ts", "c.spec.ts", "new.spec.ts"], durations, 2);
    expect(plan).toEqual([
      ["a.spec.ts", "c.spec.ts"],
      ["b.spec.ts", "new.spec.ts"],
    ]);
  });
});

describe("parseShard", () => {
  it("reads current and total", () => {
    expect(parseShard("3/6")).toEqual({ current: 3, total: 6 });
  });

  it.each(["0/6", "7/6", "6", "a/b"])("rejects %s", (value) => {
    expect(() => parseShard(value)).toThrow();
  });
});
