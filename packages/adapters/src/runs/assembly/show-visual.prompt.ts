/** Shared by run instructions and rejected visuals. */
export const VISUAL_ESSENTIALS = [
  'JSX: export default, no Page. Section heading, short Caption. Callout only for warnings. Diagrams over two steps go vertical. SVG: useTheme(), viewBox, width "100%", no vh.',
  'Nested sets, plus one Slider that changes a variable: <Venn nested sets={[{label: "NP"}, {label: "P", tone: "success"}]} />',
  'How something works, in stages: <Stages stages={[{id: "a", label: "One", title: "One", detail: "What happens"}]}><Diagram direction="vertical" focus="a" nodes={[{id: "a", label: "One"}]} edges={[]} /></Stages>',
  "Calculator: useState, Slider/Input, Bars horizontal bars=[{label,value,display}], Result. Choices radio {label,options,value,onChange} asks for preferences.",
  "Mix: Pie parts=[{label,value,detail}] total label unit percentDigits={1}; StackedBars showShares, ColumnSeries across periods.",
  "Trend: Metrics, LineChart with month Slider marker, annotations=[{at,label}], reference={value,label}, jump Buttons and history table.",
  "Before/after location: Metrics, Rings {rings,center,markers:[{ring:0,label}]}, horizontal Bars, savings sliders and route table.",
  'A year list: <Timeline items={[{date: "1969", title: "Landing", detail: "Moon"}]} />. Ticks: <Checklist interactive items={[{text: "Shoes"}]} />.',
  'Practice: <Quiz questions={[{question: "Q", options: ["A", "B"], answer: 0}]} /> or <Flashcards cards={[{front: "Q", back: "A"}]} />.',
].join("\n");

/** App chats also support ui fences. */
export const SHOW_VISUAL_INSTRUCTION = [
  "Use show_visual to understand something or how it works, for checklists, timelines, bill splits and requested visuals. Practice uses it too. For explanations, number the sections.",
  "To compare or decide whether to buy, open with the finding or pick. A web search does not replace the chart. Use a table and horizontal Bars. Give the prefilled calculator and radio questions separate embeds. ProductRows lists sourced options.",
  "Pass title, summary and source to show_visual. Split tall visuals so each works inline. Do not pass help, paste source or tell the reader to open it.",
  VISUAL_ESSENTIALS,
  "A ui fence is for a table, steps, key numbers or a simple chart. One fact gets one plain sentence.",
].join("\n\n");

/** Channels whose reply is not drawn in the app. */
export const SHOW_VISUAL_BRIEF =
  "When a picture would show how something works, a comparison or a decision, draw it with show_visual. Pass title, summary and source. Do not pass help. Place the embed where the visual belongs. It works in the chat: do not tell the reader to open it. It is not saved; use save_page for something the user will keep, share or update.";
