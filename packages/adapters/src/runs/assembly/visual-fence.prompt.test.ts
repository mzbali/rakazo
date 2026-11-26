import { DIAGRAM_ICON_NAMES, parseVisualFence, VISUAL_TAGS } from "@rakazo/core/visual-fence";
import { describe, expect, it } from "vitest";
import { userTurnInstructions } from "./run-instructions.prompt.js";
import { SHOW_VISUAL_BRIEF, SHOW_VISUAL_INSTRUCTION } from "./show-visual.prompt.js";
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

describe("the Visual answers pointer", () => {
  const pointer = 'read the "Visual answers" skill first';
  const text = (extra: Record<string, unknown>) =>
    userTurnInstructions({ ...parts, agentSkillsLine: "Agent skills", ...extra }).join("\n");

  it("goes only to app chats that can open the skill and draw a visual", () => {
    expect(text({ visualFences: true })).toContain(pointer);
    expect(text({ visualFences: false })).not.toContain(pointer);
    expect(text({ visualFences: true, agentSkillsLine: undefined })).not.toContain(pointer);
    expect(
      text({ visualFences: true, disabledBuiltinTools: new Set(["skill_read"]) }),
    ).not.toContain(pointer);
    expect(
      text({ visualFences: true, disabledBuiltinTools: new Set(["show_visual"]) }),
    ).not.toContain(pointer);
  });
});

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

  it("stay short, keep callouts rare, and send pictures to show_visual", () => {
    expect(VISUAL_FENCE_INSTRUCTION.length).toBeLessThan(4300);
    expect(VISUAL_FENCE_INSTRUCTION).toContain("show_visual, not a fence");
    expect(VISUAL_FENCE_INSTRUCTION).toContain("simple chart of figures");
    expect(VISUAL_FENCE_INSTRUCTION).not.toContain("short comparison");
    expect(VISUAL_FENCE_INSTRUCTION).toContain("at most one");
    const example = /```ui\n([\s\S]*?)\n```/.exec(VISUAL_FENCE_INSTRUCTION)?.[1] ?? "";
    expect(example).not.toContain("Callout");
    const withFences = userTurnInstructions({ ...parts, visualFences: true }).join("\n");
    const fenceAt = withFences.indexOf(VISUAL_FENCE_INSTRUCTION);
    const pictureAt = withFences.indexOf(SHOW_VISUAL_INSTRUCTION);
    expect(fenceAt).toBeGreaterThan(-1);
    expect(pictureAt).toBeGreaterThan(fenceAt);
    expect(withFences).toContain(
      "Use render_plot only for a chart the chat components cannot draw, or a PNG when the user asks for an image file.",
    );
    expect(withFences).not.toContain("For charts and data visualization, use the render_plot tool");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("call show_visual before you reply");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("understand something");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("how it works");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("data you found");
    expect(SHOW_VISUAL_INSTRUCTION).toContain(
      "Once the data is in hand, draw it with show_visual; a series over time is a LineChart with marker and annotations.",
    );
    expect(SHOW_VISUAL_INSTRUCTION).toContain(
      "Use render_plot only for a chart it cannot draw or an image file the user asks for.",
    );
    expect(SHOW_VISUAL_INSTRUCTION).toContain("bill to split");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("compare or decide");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("whether to buy or return");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("prefilled calculator");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("LineChart marker");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("not a table");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("web search does not replace");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("number the sections");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("Practice");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("one plain sentence");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("time in a place");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("no picture");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("<Venn nested");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("Stages groups=");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("Checklist interactive collapsible");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("two and four focused visuals");
    expect(SHOW_VISUAL_INSTRUCTION).not.toContain('{"help": true}');
    expect(SHOW_VISUAL_INSTRUCTION).toContain(
      '<Image src="rakazo-image:1" alt="Photo" caption="Name" />',
    );
    expect(SHOW_VISUAL_INSTRUCTION).toContain(
      "news or data you found, call show_visual before you reply",
    );
    expect(SHOW_VISUAL_INSTRUCTION).toContain(
      "web_fetch returns a page's image when it has one; pass every such image in images.",
    );
    expect(VISUAL_FENCE_INSTRUCTION).toContain(
      "News or current events, a picture, nested sets, how something works, or a control the reader moves is show_visual, not a fence.",
    );
    expect(SHOW_VISUAL_INSTRUCTION).toContain("<NewsRows items=");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("<Upcoming items=");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("Use Grid with 1 or 2 columns");
    expect(SHOW_VISUAL_INSTRUCTION).toContain("Omit fixed sizes");
    expect(SHOW_VISUAL_INSTRUCTION).not.toContain("<Picture");
    expect(SHOW_VISUAL_INSTRUCTION).not.toContain("give a picture src");
    expect(withFences).not.toContain("only for what a ui fence cannot draw");
  });

  it("tells a channel that cannot draw what its reader actually gets", () => {
    expect(SHOW_VISUAL_BRIEF).not.toContain("It works in the chat");
    expect(SHOW_VISUAL_BRIEF).toContain("only its title and summary");
    expect(SHOW_VISUAL_BRIEF).toContain("do not tell the reader to open it");
  });

  it("names show_visual in the fence only when that tool is offered", () => {
    const offered = userTurnInstructions({ ...parts, visualFences: true }).join("\n");
    expect(offered).toContain("show_visual, not a fence");
    const off = userTurnInstructions({
      ...parts,
      visualFences: true,
      disabledBuiltinTools: new Set(["show_visual"]),
    }).join("\n");
    expect(off).toContain("fenced block");
    expect(off).not.toContain("show_visual");
  });
});
