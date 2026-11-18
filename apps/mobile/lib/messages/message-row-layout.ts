import { isApprovalAskBlock, isSecretAskBlock } from "@rakazo/core";
import type { MobileMessage } from "../api/mobile-types";
import { isCenteredAgentEvent, THREAD_COLUMN_GUTTER } from "./message-presentation";

const COLUMN_PADDING = THREAD_COLUMN_GUTTER * 2;

/** Sizes a message's column. Bot answers fill it; user bubbles keep a chat width. */
export function messageRowLayout(
  blocks: MobileMessage["blocks"],
  {
    activityBotId,
    inGroup,
    columnWidth,
    role,
  }: {
    activityBotId?: string;
    inGroup: boolean;
    columnWidth: number;
    role: MobileMessage["role"];
  },
) {
  const wideAsk = blocks.some(isSecretAskBlock);
  const full = wideAsk || isCenteredAgentEvent(blocks);
  const fillsBubble = blocks.some(
    (block) =>
      block.kind === "app_connect" ||
      block.kind === "mcp_approval" ||
      block.kind === "app" ||
      block.kind === "page" ||
      block.kind === "visual" ||
      block.kind === "cloud_agent" ||
      (block.kind === "ask" &&
        block.status !== "answered" &&
        Boolean(block.actions?.length) &&
        !isApprovalAskBlock(block) &&
        !block.instructionUpdate &&
        !block.settingsUpdate),
  );
  const gutter = activityBotId ? (inGroup ? 28 : 36) : 0;
  const content = columnWidth - COLUMN_PADDING - gutter;
  // A bot answer is one column beside its avatar. User bubbles stay capped.
  if (role !== "user") {
    // The menu measures its trigger unconstrained, so prose needs the width set there for
    // diagrams and other content without a width of their own.
    const prose = blocks.some((block) => block.kind === "text");
    return {
      width: full || !activityBotId ? "100%" : undefined,
      maxWidth: full || !activityBotId ? "100%" : undefined,
      menuFullWidth: wideAsk || fillsBubble || prose,
      menuMaxWidth: isCenteredAgentEvent(blocks) ? columnWidth - COLUMN_PADDING : content,
    } as const;
  }
  return {
    width: full ? "100%" : fillsBubble && !activityBotId ? "90%" : undefined,
    maxWidth: full ? "100%" : activityBotId ? undefined : "90%",
    menuFullWidth: wideAsk || fillsBubble,
    menuMaxWidth: wideAsk
      ? content
      : isCenteredAgentEvent(blocks)
        ? columnWidth - COLUMN_PADDING
        : activityBotId
          ? content
          : (columnWidth - COLUMN_PADDING) * 0.9,
  } as const;
}
