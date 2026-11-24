/**
 * How a bot draws a picture in chat. The full kit stays behind show_visual help, so a turn does
 * not pay for it. These lines are what a run sees instead, and what a rejected visual gets back.
 */

/** Shapes that draw without a help call. A rejected visual gets the same text back. */
export const VISUAL_ESSENTIALS = [
  'source is page-kit JSX: one export default, no Page wrapper. One Section (heading or title) and one Caption. At most one Callout, only for a real warning. A Diagram of more than two steps is vertical. SVG uses useTheme(), a viewBox and width "100%". Never use vh.',
  'Nested sets, plus one Slider that changes a variable: <Venn nested sets={[{label: "NP"}, {label: "P", tone: "success"}]} />',
  'How something works, in stages: <Stages stages={[{id: "a", label: "One", title: "One", detail: "What happens"}]}><Diagram direction="vertical" focus="a" nodes={[{id: "a", label: "One"}]} edges={[]} /></Stages>',
  'A number they change: useState, Slider or Input type="number", <Result label="Each" value={n} />, LineChart marker={index}.',
  'A year list: <Timeline items={[{date: "1969", title: "Landing", detail: "Moon"}]} />. Ticks: <Checklist interactive items={[{text: "Shoes"}]} />.',
  'Practice: <Quiz questions={[{question: "Q", options: ["A", "B"], answer: 0}]} /> or <Flashcards cards={[{front: "Q", back: "A"}]} />.',
].join("\n");

/** App chats, where the reply can also carry a ui fence. The fence text comes first. */
export const SHOW_VISUAL_INSTRUCTION = [
  "When someone asks to understand something or how it works, or for a checklist, a timeline or a bill to split, call show_visual before you reply. Practice uses it too. For an explanation, number the sections 1. 2. 3.",
  "When someone asks to compare or decide, or whether to buy, the first sentence is the pick. Then call show_visual: a calculator whose inputs already hold the figures they gave, or one picture of what differs. A web search does not replace that picture.",
  "Call show_visual with title, summary and source. Do not pass help. Place the embed in the reply. Do not tell the reader to open it. It is not saved.",
  VISUAL_ESSENTIALS,
  "A ui fence is only a table, steps, key numbers or a simple chart of figures. A question that asks for one fact, such as the time in a place, gets one plain sentence and no picture and no fence.",
].join("\n\n");

/** Channels whose reply is not drawn in the app. */
export const SHOW_VISUAL_BRIEF =
  "When a picture would show how something works, a comparison or a decision, draw it with show_visual. Pass title, summary and source. Do not pass help. Place the embed where the visual belongs. It works in the chat: do not tell the reader to open it. It is not saved; use save_page for something the user will keep, share or update.";
