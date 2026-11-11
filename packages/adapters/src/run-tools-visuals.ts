import type { MessageBlock } from "@rakazo/contracts";
import {
  PageTitleSchema,
  pageSourceBytes,
  VISUAL_CODE_MAX_BYTES,
  VISUAL_SUMMARY_MAX_LENGTH,
} from "@rakazo/contracts";
import { containsSecret } from "@rakazo/core";
import { checkPageSource, VISUAL_GUIDE } from "@rakazo/page-kit/validate";
import type { RunContext } from "./run-context.js";
import { publishMessage } from "./run-messages.js";
import type { ToolCall, ToolHandlers } from "./run-tool-gate.js";

/** The summary is one paragraph of plain text: every run of whitespace folds into a space. */
function summaryText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const summary = value.replace(/\s+/g, " ").trim();
  return summary && summary.length <= VISUAL_SUMMARY_MAX_LENGTH ? summary : null;
}

/**
 * Draws page-kit JSX in the chat as its own message, above the reply, without saving a page.
 * The source goes through the page check, and the compiled code must stay small because it
 * travels inside the message.
 */
async function showVisual(ctx: RunContext, call: ToolCall) {
  const { args } = call;
  if (args.help === true) return { guide: VISUAL_GUIDE };
  const title = PageTitleSchema.safeParse(args.title);
  if (!title.success) return { error: "title must be 1 to 200 characters." };
  const summary = summaryText(args.summary);
  if (!summary) {
    return {
      error: `summary must be plain text of 1 to ${VISUAL_SUMMARY_MAX_LENGTH} characters.`,
    };
  }
  if (typeof args.source !== "string" || !args.source.trim())
    return { error: "source must be the visual as JSX." };
  const source = args.source;
  const check = checkPageSource(source);
  if (!check.ok)
    return { error: "The visual has problems; nothing was shown.", problems: check.errors };
  const { code } = check;
  const bytes = pageSourceBytes(code);
  if (bytes > VISUAL_CODE_MAX_BYTES) {
    return {
      error: `The visual is ${bytes} bytes compiled; the limit is ${VISUAL_CODE_MAX_BYTES}. Show less, or build a page with save_page.`,
    };
  }
  // The message stays in the chat and its history, so it never holds a value this run keeps secret.
  if (containsSecret([title.data, summary, source, code], ctx.secrets)) {
    return {
      error: "The visual contains a secret value; nothing was shown. Remove it and try again.",
    };
  }
  const block: MessageBlock = { kind: "visual", title: title.data, text: summary, code };
  await publishMessage(ctx.deps, ctx.run, "bot", [block]);
  return {
    shown: true,
    note: "The visual is in the chat above your reply. Do not repeat what it shows or paste its source.",
    ...(check.warnings?.length ? { warnings: check.warnings } : {}),
  };
}

export const visualTools: ToolHandlers = {
  async show_visual(ctx, call) {
    return call.finish(await showVisual(ctx, call));
  },
};
