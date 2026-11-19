import { DIAGRAM_ICON_NAMES, parseVisualFence, VISUAL_TAGS } from "@rakazo/core/visual-fence";
import { describe, expect, it } from "vitest";
import { userTurnInstructions } from "./run-instructions.prompt.js";
import { VISUAL_FENCE_INSTRUCTION, visualFencesAllowed } from "./visual-fence.prompt.js";

const parts = {
  botInstructions: "",
  groupContext: undefined,
  messagingContext: undefined,
  redactedMemoryContext: undefined,
  redactedScratchpadContext: undefined,
  hasHistoricalContext: false,
  computerInstruction: "",
  pageBrowserAllowed: false,
  workspaceInstruction: "",
  agentEnvironmentInstruction: undefined,
  botDirectory: undefined,
  pluginLine: undefined,
  agentSkillsLine: undefined,
  taughtSkillsLine: undefined,
  replyGuidance: "",
};

describe("the ui fence instructions", () => {
  it("go to runs whose reply shows in the app, and not to chat-app channels", () => {
    expect(userTurnInstructions({ ...parts, visualFences: true })).toContain(
      VISUAL_FENCE_INSTRUCTION,
    );
    expect(userTurnInstructions({ ...parts, visualFences: false })).not.toContain(
      VISUAL_FENCE_INSTRUCTION,
    );
    expect(userTurnInstructions(parts)).not.toContain(VISUAL_FENCE_INSTRUCTION);
  });

  it("are absent on a live voice call, a chat-app channel, a background helper and ticket work, present otherwise", () => {
    const send = (trigger: string, voiceCall: boolean, helper = false) =>
      userTurnInstructions({
        ...parts,
        visualFences: visualFencesAllowed({ trigger, voiceCall, helper }),
      });
    expect(send("user", false)).toContain(VISUAL_FENCE_INSTRUCTION);
    expect(send("routine", false)).toContain(VISUAL_FENCE_INSTRUCTION);
    expect(send("user", true)).not.toContain(VISUAL_FENCE_INSTRUCTION);
    expect(send("messaging", false)).not.toContain(VISUAL_FENCE_INSTRUCTION);
    expect(send("user", false, true)).not.toContain(VISUAL_FENCE_INSTRUCTION);
    expect(send("tickets", false)).not.toContain(VISUAL_FENCE_INSTRUCTION);
    expect(send("helper_result", false)).toContain(VISUAL_FENCE_INSTRUCTION);
  });

  it("teach an example the parser draws whole", () => {
    const example = /```ui\n([\s\S]*?)\n```/.exec(VISUAL_FENCE_INSTRUCTION)?.[1] ?? "";
    const { root, tail } = parseVisualFence(example);
    expect(root?.state).toBe("complete");
    expect(root?.children.map((child) => child.state)).toEqual(["complete", "complete"]);
    expect(tail).toBe(false);
  });

  it("name every tag and diagram icon once, and keep links out of tags", () => {
    for (const tag of VISUAL_TAGS) expect(VISUAL_FENCE_INSTRUCTION).toContain(`<${tag}`);
    for (const icon of DIAGRAM_ICON_NAMES) expect(VISUAL_FENCE_INSTRUCTION).toContain(icon);
    expect(VISUAL_FENCE_INSTRUCTION).toContain("no markdown and no links");
  });

  it("stay short", () => {
    expect(VISUAL_FENCE_INSTRUCTION.length).toBeLessThan(4300);
  });
});
