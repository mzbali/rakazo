import { HistoryReadInputSchema, HistorySearchInputSchema } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { memoryTools, withoutBlankFields } from "./run-tools-memory.js";

describe("history tool arguments", () => {
  it("treats blank and null optional fields as not given", () => {
    expect(
      HistorySearchInputSchema.parse(
        withoutBlankFields({ queries: ["Aurora"], botId: "", before: " ", query: null }),
      ),
    ).toEqual({ queries: ["Aurora"] });
    expect(
      HistoryReadInputSchema.parse(
        withoutBlankFields({
          messageId: "cmw3l7emsa1sfb5bml8d0doe0",
          linkedRunId: "",
          threadId: "",
        }),
      ),
    ).toEqual({ messageId: "cmw3l7emsa1sfb5bml8d0doe0" });
  });
});

describe("save_memory", () => {
  function save(content: string) {
    const semantic = { save: vi.fn(async () => ({ ok: true })) };
    const ctx = { bot: { id: "bot-1" }, context: {}, memory: { semantic, scope: "bot" } };
    const call = { args: { content }, finish: (result: unknown) => result };
    return { semantic, result: memoryTools.save_memory!(ctx as never, call as never) };
  }

  it("refuses a fact that is a corrected claim, which later runs would recall", async () => {
    const { semantic, result } = save("Continuations don't wake this bot.");
    await expect(result).resolves.toEqual({ error: expect.stringContaining("Nothing was saved") });
    expect(semantic.save).not.toHaveBeenCalled();
  });

  it("saves any other fact", async () => {
    const { semantic, result } = save("The owner prefers short replies.");
    await expect(result).resolves.toEqual({ ok: true });
    expect(semantic.save).toHaveBeenCalledOnce();
  });
});
