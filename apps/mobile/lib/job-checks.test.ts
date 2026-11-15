import { describe, expect, it } from "vitest";
import { checksChip } from "./job-checks";

describe("checksChip", () => {
  it("maps each known result to a tone", () => {
    expect(checksChip("passing")).toEqual({ checks: "passing", tone: "success" });
    expect(checksChip("failing")).toEqual({ checks: "failing", tone: "danger" });
    expect(checksChip("running")).toEqual({ checks: "running", tone: "active" });
  });

  it("shows no chip when the result is unknown", () => {
    expect(checksChip(undefined)).toBeUndefined();
  });
});
