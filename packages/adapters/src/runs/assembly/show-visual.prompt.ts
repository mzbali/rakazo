/**
 * How a bot draws a picture in chat. The full kit stays behind show_visual help, so a turn does
 * not pay for it. These lines are what a run sees instead, and what a rejected visual gets back.
 */

/** Shapes that draw without a help call. A rejected visual gets the same text back. */
export const VISUAL_ESSENTIALS = [
  'source is page-kit JSX: one export default, no Page wrapper. One Section and one caption. At most one Callout, only for a real warning. A phone is about 340 pixels wide, so a Diagram of more than two steps is vertical. A grid or board is SVG from useTheme(), with a viewBox and width "100%". Never use vh.',
  'One set inside another, labels of one or two words: <Venn nested sets={[{label: "NP"}, {label: "P", tone: "success"}]} />',
  'A flow: <Diagram direction="vertical" nodes={[{id: "a", label: "Input"}, {id: "b", label: "Output"}]} edges={[{from: "a", to: "b"}]} />',
  'A value the reader changes: useState, then Input type="number" or Button, and a LineChart or SVG follows that number.',
  'Money they already named: useState for each figure, Input type="number" for each, and the text shows what is left to pay.',
  'Practice: <Quiz questions={[{question: "Q", options: ["A", "B"], answer: 0}]} /> or <Flashcards cards={[{front: "Q", back: "A"}]} />.',
].join("\n");

/** App chats, where the reply can also carry a ui fence. The fence text comes first. */
export const SHOW_VISUAL_INSTRUCTION = [
  "When someone asks to understand something or how it works, call show_visual before you reply. Practice uses it too. For an explanation, number the sections 1. 2. 3.",
  "When someone asks to compare or decide, or whether to buy, the first sentence is the pick. Then call show_visual: a calculator whose inputs already hold the figures they gave, or one picture of what differs. A web search does not replace that picture.",
  "Call show_visual with title, summary and source. Do not pass help. Place the embed where the picture belongs. It works in the chat: do not tell the reader to open it. It is not saved; use save_page for something they will keep.",
  VISUAL_ESSENTIALS,
  "A ui fence is only a table, steps, key numbers or a simple chart of figures. A question that asks for one fact, such as the time in a place, gets one plain sentence and no picture and no fence.",
].join("\n\n");

/** Channels whose reply is not drawn in the app. */
export const SHOW_VISUAL_BRIEF =
  "When a picture would show how something works, a comparison or a decision, draw it with show_visual. Pass title, summary and source. Do not pass help. Place the embed where the visual belongs. It works in the chat: do not tell the reader to open it. It is not saved; use save_page for something the user will keep, share or update.";
