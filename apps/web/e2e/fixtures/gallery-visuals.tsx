import type { MessageBlock, ThreadMessage } from "@rakazo/contracts";
import type { GroupAvatarMember } from "@rakazo/ui-web";

// Answer visuals (```ui fences) over fake replies, streamed and finished, for the gallery.

export type VisualScenario = {
  id: string;
  label: string;
  messages: ThreadMessage[];
  running?: boolean;
  bots?: GroupAvatarMember[];
};

const NCE_FENCE = `<Visual summary="NCE turns density estimation into real-vs-noise classification.">
  <Formula tex="p(x) = \\frac{\\phi(x;\\theta)}{Z(\\theta)}" />
  <Diagram direction="horizontal" nodes={[{id: "real", label: "Real samples"}, {id: "noise", label: "Noise samples"}, {id: "clf", label: "Binary classifier"}, {id: "out", label: "Learn θ and estimate Z"}]} edges={[{from: "real", to: "clf"}, {from: "noise", to: "clf"}, {from: "clf", to: "out"}]} />
  <Callout tone="info" lead="Why it works">
    The classifier only has to tell data from noise, so Z(θ) becomes one more parameter to learn. See [the NCE paper](https://example.test/nce) for the proof.
  </Callout>
  <Steps steps={[{title: "Sample noise", detail: "Draw from a simple distribution."}, {title: "Train the classifier", detail: "Logistic loss on real vs noise."}, {title: "Read off the density"}]} />
  <Metrics metrics={[{value: "0.92", label: "Accuracy", delta: "+0.04", better: "up"}, {value: "12 ms", label: "Step time"}, {value: 3, label: "Noise ratio"}]} />
</Visual>`;

const INTRO = "Noise-contrastive estimation, in one picture:\n\n";
const OUTRO = "\n\nThat is the whole trick.";
const fenced = (body: string, closed = true) =>
  `${INTRO}\`\`\`ui\n${body}${closed ? "\n```" : ""}${closed ? OUTRO : ""}`;

let seq = 900;
function row(role: ThreadMessage["role"], blocks: MessageBlock[]): ThreadMessage {
  seq += 1;
  return {
    id: `visual-message-${seq}`,
    threadId: "thread-1",
    seq,
    role,
    blocks,
    ...(role === "bot" ? { botId: "bot-1" } : {}),
    createdAt: new Date(Date.UTC(2026, 10, 18, 9, seq % 60)).toISOString(),
  };
}
const ask = row("user", [{ kind: "text", text: "Explain NCE with a diagram." }]);
const answer = (text: string) => row("bot", [{ kind: "text", text }]);
const streamed = (text: string) => row("bot", [{ kind: "progress", text }]);

/** Cut points inside the fence: mid first tag, between children, mid diagram, mid callout. */
const cut = (needle: string, extra = 0) => NCE_FENCE.indexOf(needle) + extra;
const CUTS: [string, number][] = [
  ["cut-header", cut("<Formula", 4)],
  ["cut-formula", cut("<Diagram") - 1],
  ["cut-diagram", cut("edges=", 20)],
  ["cut-callout", cut("The classifier", 30)],
  ["cut-steps", cut("<Steps", 40)],
];

const big = `<Visual summary="Too big">${'<Callout lead="x">filler text</Callout>'.repeat(1100)}</Visual>`;

export const VISUAL_SCENARIOS: VisualScenario[] = [
  { id: "visual-nce", label: "Visual: NCE", messages: [ask, answer(fenced(NCE_FENCE))] },
  ...CUTS.map(([id, at]) => ({
    id: `visual-${id}`,
    label: `Visual: ${id}`,
    running: true,
    messages: [ask, streamed(fenced(NCE_FENCE.slice(0, at), false))],
  })),
  {
    id: "visual-too-big",
    label: "Visual: over 32 KB",
    messages: [ask, answer(fenced(big))],
  },
  {
    id: "visual-invalid",
    label: "Visual: invalid parts",
    messages: [
      ask,
      answer(
        fenced(
          `<Visual summary="A, with a > b">\n<Callout tone="loud" lead="Bad tone" />\n<Callout lead="Fine">a < b stays text</Callout>\n<Quote>unknown</Quote>\n</Visual>`,
        ),
      ),
    ],
  },
];
