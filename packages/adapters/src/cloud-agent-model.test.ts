import { describe, expect, it } from "vitest";
import { cloudAgentModelDisplay } from "./cloud-agent-model.js";

describe("cloudAgentModelDisplay", () => {
  it("reads the model, its effort and its mark from a pick note", () => {
    expect(cloudAgentModelDisplay("Picked claude-sonnet-5-5 on main (simple).")).toEqual({
      name: "Sonnet 5.5",
      mark: "claude",
    });
    expect(cloudAgentModelDisplay("Picked claude-opus-5-5 on a (hard; effort medium).")).toEqual({
      name: "Opus 5.5",
      effort: "Medium",
      mark: "claude",
    });
    expect(
      cloudAgentModelDisplay("Picked gpt-6-luna on box (hard; gpt-6-sol out of quota)."),
    ).toEqual({ name: "GPT-6 Luna", mark: "openai" });
    expect(cloudAgentModelDisplay("Picked claude-opus-4-1-20250805 on a (normal).")?.name).toBe(
      "Opus 4.1",
    );
  });
  it("still reads the pick when T3 confirmed the same model", () => {
    expect(
      cloudAgentModelDisplay(
        "Picked claude-opus-5-5 on a (hard; effort high). Started claude-opus-5-5 on b.",
      ),
    ).toEqual({ name: "Opus 5.5", effort: "High", mark: "claude" });
  });
  it("shows no model when T3 started a different one, so the note stays visible", () => {
    expect(
      cloudAgentModelDisplay(
        "Picked claude-sonnet-5-5 on a (hard; effort high). Requested claude-sonnet-5-5 on a, T3 started claude-opus-5-5 on b.",
      ),
    ).toBeUndefined();
  });
  it("gives an unknown maker no mark, and a note without a pick nothing", () => {
    expect(cloudAgentModelDisplay("Picked mystery-model on a (ui).")).toEqual({
      name: "Mystery Model",
    });
    expect(cloudAgentModelDisplay("No simple route is available; the default was used.")).toBe(
      undefined,
    );
    expect(cloudAgentModelDisplay(null)).toBeUndefined();
  });
});
