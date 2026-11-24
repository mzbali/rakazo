/**
 * How a bot draws a picture in chat. The full kit stays behind show_visual help, so a turn does
 * not pay for it. These lines are what a run sees instead, and what a rejected visual gets back.
 */

/** Shapes that draw without a help call. A rejected visual gets the same text back. */
export const VISUAL_ESSENTIALS = [
  'JSX: export default, Section, no Page. SVG: viewBox, width="100%", useTheme(), no vh. Split tall visuals.',
  'Grid: Venn nested sets={[{label:"NP"},{label:"P"}]} vs one equal set. Diagram the reduction. Slider and LineChart marker for growth; Slider/Input and Result for calculators.',
  "For multi-route flows: Choices selects the route; Stages groups={[{label,stages:[{id,label,detail}]}]} shows each step. Diagram outcomes; table differences. Short flows wrap Diagram in Stages.",
  "For timelines: year Slider updates the SVG scene, Metrics, and Timeline groups={[{label,items:[{title,detail}]}]}. Then grouped ColumnSeries labels/series[{name,values}].",
  'Fixed split: one Result with label, value, tone="success", groups={[[{label,value}]]}, copy={{text}}. Amount first.',
  "Checklist interactive collapsible sections={[{title,items:[{text}]}]}, plus Bars bars={[{label,value}]} for progression.",
  "Quiz questions={[{question,options,answer:0,explain}]} or Flashcards cards={[{front,back}]}.",
].join("\n");

/** App chats, where the reply can also carry a ui fence. The fence text comes first. */
export const SHOW_VISUAL_INSTRUCTION = [
  "Call show_visual for explanations, diagrams, timelines, checklists, bill splits and practice. Follow the relevant recipe below. Open with the visual or a one-sentence answer.",
  "For a decision, give the pick first, then the visual: prefill the calculator or draw what differs. A search does not replace the visual.",
  "Pass title, summary and source, then place the returned embed. No help on the first call. No pasted JSX or instructions to open it.",
  VISUAL_ESSENTIALS,
  "Use ui fences for tables, steps, figures or simple charts. A one-fact question gets a plain sentence.",
].join("\n\n");

/** Channels whose reply is not drawn in the app. */
export const SHOW_VISUAL_BRIEF =
  "When a picture would show how something works, a comparison or a decision, draw it with show_visual. Pass title, summary and source. Do not pass help. Place the embed where the visual belongs. It works in the chat: do not tell the reader to open it. It is not saved; use save_page for something the user will keep, share or update.";
