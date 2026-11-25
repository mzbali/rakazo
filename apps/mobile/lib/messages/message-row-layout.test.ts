import { describe, expect, it } from "vitest";
import type { MobileMessage } from "../api/mobile-types";
import { messageRowLayout } from "./message-row-layout";

const layout = (blocks: MobileMessage["blocks"], role: MobileMessage["role"] = "user") =>
  messageRowLayout(blocks, { inGroup: false, columnWidth: 390, role });

describe("messageRowLayout", () => {
  it("lets a routine row span the column so its line centers", () => {
    const row = layout([{ kind: "routine_event", change: "created", name: "Morning joke" }]);
    expect(row.width).toBe("100%");
    expect(row.menuFullWidth).toBe(true);
  });

  it("lets a bot's routine row span the column too", () => {
    const row = layout([{ kind: "routine_event", change: "created", name: "Morning joke" }], "bot");
    expect(row.menuFullWidth).toBe(true);
  });

  it("keeps an ordinary text bubble to its content", () => {
    expect(layout([{ kind: "text", text: "Hi" }]).menuFullWidth).toBe(false);
  });
});
