import { toolRequiresApproval } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import { builtinAgentTools } from "../tools/builtin.tool-definition.js";
import { storedCloudAgentLaunchSchema, validCloudAgentArgs } from "./cloud-agent-tools.js";
import { CLOUD_AGENT_TOOL_NAMES, selectCloudAgentTools } from "./cloud-agent-tools-select.js";

describe("cloud agent tool boundary", () => {
  it("hides every cloud tool when no provider is authorized", () => {
    expect(
      selectCloudAgentTools(builtinAgentTools, false).some((tool) =>
        CLOUD_AGENT_TOOL_NAMES.has(tool.name),
      ),
    ).toBe(false);
    expect(selectCloudAgentTools(builtinAgentTools, true)).toBe(builtinAgentTools);
  });
  it("keeps only status and cancellation for existing agents without launch access", () => {
    expect(
      selectCloudAgentTools(builtinAgentTools, false, true)
        .filter((tool) => CLOUD_AGENT_TOOL_NAMES.has(tool.name))
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(["cloud_agent_cancel", "cloud_agent_status"]);
  });
  it("classifies every mutation as consequential", () => {
    for (const name of ["cloud_agent_launch", "cloud_agent_reply", "cloud_agent_cancel"])
      expect(toolRequiresApproval(name, false)).toBe(true);
    expect(toolRequiresApproval("cloud_agent_status", false)).toBe(false);
  });
  it("rejects raw environment variables and malformed arguments before effect persistence", () => {
    for (const args of [
      { prompt: "Task", title: "Task", environment: { TOKEN: "fake-secret" } },
      { prompt: "", title: "Task" },
      // The brief is not a name: a title is required, short and a few words.
      { prompt: "Task" },
      { prompt: "Task", title: "   " },
      {
        prompt: "Task",
        title: "mzbali: 'i have prowlerr connected to rutracket that i search music",
      },
      { prompt: "Task", title: "one two three four five six seven eight nine" },
      { prompt: "Task", title: "Task", openPr: "false" },
      { prompt: "Task", title: "Task", images: [{ url: "http://example.test/image.png" }] },
      {
        prompt: "Task",
        title: "Task",
        images: [{ url: "https://user:password@example.test/image.png" }],
      },
      { prompt: "Task", title: "Task", modelSelection: { instanceId: "codex" } },
      {
        prompt: "Task",
        title: "Task",
        modelSelection: { model: "m", options: [{ id: "x", value: {} }] },
      },
      { prompt: "Task", title: "Task", workspaceStrategy: { type: "existing_worktree" } },
      { prompt: "Task", title: "Task", runtimeMode: "anything" },
    ]) {
      expect(validCloudAgentArgs("cloud_agent_launch", args)).toBe(false);
    }
    expect(
      validCloudAgentArgs("cloud_agent_launch", { prompt: "Task", title: "Task", openPr: false }),
    ).toBe(true);
    expect(
      validCloudAgentArgs("cloud_agent_launch", {
        prompt: "Task",
        title: "Task",
        modelSelection: {
          model: "m",
          instanceId: "codex",
          options: [{ id: "effort", value: "high" }],
        },
        projectId: "project",
        workspaceStrategy: { type: "worktree", baseRef: "origin/main", startFromOrigin: true },
        runtimeMode: "full-access",
        interactionMode: "plan",
      }),
    ).toBe(true);
    expect(validCloudAgentArgs("cloud_agent_reply", { id: "agent", prompt: "Tests" })).toBe(true);
    expect(validCloudAgentArgs("cloud_agent_cancel", { id: "" })).toBe(false);
  });
  it("parses a launch an earlier release stored, whatever its title", () => {
    const title =
      "Check the quarterly export pipeline for every customer in the staging environment";
    expect(validCloudAgentArgs("cloud_agent_launch", { prompt: "Go", title })).toBe(false);
    expect(storedCloudAgentLaunchSchema.safeParse({ prompt: "Go", title }).success).toBe(true);
    expect(storedCloudAgentLaunchSchema.safeParse({ prompt: "Go" }).success).toBe(true);
  });
});
