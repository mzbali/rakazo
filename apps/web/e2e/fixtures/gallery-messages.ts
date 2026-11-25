import type { MessageBlock, ThreadMessage } from "@rakazo/contracts";
import type { GroupAvatarMember } from "@rakazo/ui-web";
import { BOT } from "./thread-fixture";

let seq = 0;
export function message(
  role: ThreadMessage["role"],
  blocks: MessageBlock[],
  extra: Partial<ThreadMessage> = {},
): ThreadMessage {
  seq += 1;
  return {
    id: `message-${seq}`,
    threadId: "thread-1",
    seq,
    role,
    blocks,
    ...(role === "bot" ? { botId: BOT.botId } : {}),
    createdAt: new Date(Date.UTC(2026, 9, 26, 9, seq)).toISOString(),
    ...extra,
  };
}
export const user = (text: string, extra?: Partial<ThreadMessage>) =>
  message("user", [{ kind: "text", text }], extra);
export const bot = (blocks: MessageBlock[], extra?: Partial<ThreadMessage>) =>
  message("bot", blocks, extra);
export const say = (text: string, extra?: Partial<ThreadMessage>) =>
  bot([{ kind: "text", text }], extra);

export type Scenario = {
  id: string;
  label: string;
  messages: ThreadMessage[];
  running?: boolean;
  bots?: GroupAvatarMember[];
  /** Asks that render as no longer active instead of taking an answer. */
  inactiveAsks?: string[];
};

// Formulas in prose: prices stay text, code stays code, and what cannot be drawn stays source.
export const maths: Scenario = {
  id: "maths",
  label: "Maths",
  messages: [
    user("How does noise-contrastive estimation work?"),
    say(
      [
        "NCE fits \\(p(x)=\\frac{\\phi(x;\\theta)}{Z(\\theta)}\\) by telling real samples from noise. A ticket costs $5 to $10, which is not maths.",
        "$$\\sum_{i=1}^{n} x_i^2 = \\int_0^1 f(t)\\,dt$$",
        "With brackets:\n\n\\[ e^{i\\pi} + 1 = 0 \\]",
        "Broken TeX such as \\(\\frac{\\) stays code, an unclosed $$ stays text, and `\\(x\\)` in code is never drawn.",
      ].join("\n\n"),
    ),
  ],
};
