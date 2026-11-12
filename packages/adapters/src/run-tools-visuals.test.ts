import { MessageBlock, VISUAL_CODE_MAX_BYTES } from "@rakazo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const publishMessage = vi.fn();
vi.mock("./run-messages.js", async (importActual) => ({
  ...(await importActual<typeof import("./run-messages.js")>()),
  publishMessage: (...args: unknown[]) => publishMessage(...args),
}));

const { visualTools } = await import("./run-tools-visuals.js");
const { redactBlocks } = await import("./run-messages.js");

const FLOW = [
  "const Flow = () => (",
  '  <Diagram direction="horizontal" nodes={[{ id: "a", label: "Your message" }, { id: "b", label: "Bot reply" }]} edges={[{ from: "a", to: "b" }]} />',
  ");",
  "export default Flow;",
].join("\n");

const context = (secrets: string[] = []) =>
  ({
    deps: {},
    run: { id: "run-1", spaceId: "space-1", threadId: "t-1", botId: "bot-1", trigger: "user" },
    secrets,
  }) as never;

const call = (args: Record<string, unknown>) =>
  ({ args, finish: (result: unknown) => result }) as never;

const show = (args: Record<string, unknown>, secrets?: string[]) =>
  visualTools.show_visual!(context(secrets), call(args)) as Promise<Record<string, unknown>>;

describe("show_visual", () => {
  beforeEach(() => {
    publishMessage.mockReset();
    publishMessage.mockResolvedValue({ id: "message-1" });
  });

  it("posts the checked, compiled visual with its summary as its own message", async () => {
    const result = await show({
      title: "Message\nflow",
      summary: "  Your message goes to the bot,\nwhich replies. ",
      source: FLOW,
    });
    expect(result).toMatchObject({ shown: true });
    expect(publishMessage).toHaveBeenCalledTimes(1);
    const [, , role, blocks] = publishMessage.mock.calls[0]!;
    expect(role).toBe("bot");
    expect(blocks).toEqual([
      {
        kind: "visual",
        title: "Message flow",
        text: "Your message goes to the bot, which replies.",
        code: expect.stringContaining("Your message"),
      },
    ]);
    // What clients receive parses as a message block.
    expect(MessageBlock.safeParse(blocks[0]).success).toBe(true);
  });

  it("says nothing was shown when the run's messages are not published", async () => {
    publishMessage.mockResolvedValueOnce(null);
    const result = await show({ title: "Flow", summary: "A to B.", source: FLOW });
    expect(result.shown).toBeUndefined();
    expect(result.error).toMatch(/nothing was shown/);
  });

  it("returns the guide for help without posting anything", async () => {
    const result = await show({ help: true });
    expect(result.guide).toMatch(/^# Visuals/);
    expect(result.guide).toContain("Diagram {nodes");
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("refuses a missing title or summary and a source the page check rejects", async () => {
    expect((await show({ summary: "x", source: FLOW })).error).toMatch(/title/);
    expect((await show({ title: "Flow", source: FLOW })).error).toMatch(/summary/);
    expect((await show({ title: "Flow", summary: "x".repeat(501), source: FLOW })).error).toMatch(
      /summary/,
    );
    const rejected = await show({
      title: "Flow",
      summary: "x",
      source: "export default () => <script>alert(1)</script>;",
    });
    expect(rejected.error).toMatch(/problems/);
    expect(rejected.problems).toEqual(expect.arrayContaining([expect.stringMatching(/script/)]));
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("refuses compiled code over the visual limit and points to a page", async () => {
    const rows = Array.from({ length: 3000 }, (_, index) => `["row ${index}", ${index}]`).join(",");
    const source = `const Big = () => <Table columns={["Name", "Value"]} rows={[${rows}]} />;\nexport default Big;`;
    const result = await show({ title: "Big", summary: "Many rows.", source });
    expect(result.error).toContain(`limit is ${VISUAL_CODE_MAX_BYTES}`);
    expect(result.error).toContain("save_page");
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("never shows a secret, wherever it appears", async () => {
    const secret = "sk-test-0123456789abcdef";
    for (const args of [
      { title: `Key ${secret}`, summary: "x", source: FLOW },
      { title: "Flow", summary: `The key is ${secret}.`, source: FLOW },
      { title: "Flow", summary: "x", source: FLOW.replace("Bot reply", secret) },
    ]) {
      expect((await show(args, [secret])).error).toMatch(/secret/);
    }
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("redacts a visual's title and summary when its message is published", () => {
    const [block] = redactBlocks(
      [{ kind: "visual", title: "token abc123", text: "uses abc123", code: "x" }],
      ["abc123"],
    );
    expect(block).toMatchObject({ kind: "visual", code: "x" });
    expect(JSON.stringify(block)).not.toContain("abc123");
  });
});
