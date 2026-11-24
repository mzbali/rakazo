/** Shared by run instructions and rejected visuals. */
export const VISUAL_ESSENTIALS = [
  'JSX: export default, Section, no Page. Short Caption. Callout only for warnings. SVG: useTheme(), viewBox, width "100%", no vh. Split tall visuals.',
  'Nested sets: <Venn nested sets={[{label: "NP"}, {label: "P", tone: "success"}]} />, plus one Slider; Diagram a reduction.',
  'How it works, in stages: <Stages stages={[{id: "a", label: "One", title: "One", detail: "What happens"}]}><Diagram focus="a" nodes={[{id: "a", label: "One"}]} edges={[]} /></Stages>. A loop: Diagram layout="cycle" zones flows. Routes: Stages groups={[{label,stages}]}.',
  'Calculator: useState, Slider/Input, Bars horizontal bars=[{label,value,display}], Result. Choices radio {label,options,value,onChange} asks for preferences. A split: one Result tone="success" groups copy, amount first.',
  "Mix: Pie parts=[{label,value,detail}] total label unit percentDigits={1}; StackedBars showShares, ColumnSeries across periods.",
  "Trend: Metrics, LineChart with month Slider marker, annotations=[{at,label}], reference={value,label}, jump Buttons and history table.",
  "Before/after location: Metrics, Rings {rings,center,markers:[{ring:0,label}]}, horizontal Bars, savings sliders and route table.",
  'Years: <Timeline items={[{date: "1969", title: "Landing", detail: "Moon"}]} /> or groups, a year Slider, ColumnSeries counts. Ticks: <Checklist interactive collapsible sections={[{title, items: [{text}]}]} />, Bars for progression.',
  'Practice: <Quiz questions={[{question: "Q", options: ["A", "B"], answer: 0, explain}]} /> or <Flashcards cards={[{front: "Q", back: "A"}]} />.',
].join("\n");

/** App chats also support ui fences. */
export const SHOW_VISUAL_INSTRUCTION = [
  "Use show_visual to understand something or how it works, for checklists, timelines, bill splits and requested visuals. Practice uses it too. For explanations, number the sections.",
  "To compare or decide whether to buy, open with the finding or pick, then the visual. A web search does not replace the chart. Use a table and horizontal Bars. Give the prefilled calculator and radio questions separate embeds. ProductRows lists sourced options.",
  "Pass title, summary and source to show_visual, then place the returned embed. Split tall visuals so each works inline. Do not pass help, paste source or tell the reader to open it.",
  VISUAL_ESSENTIALS,
  "A ui fence is for a table, steps, key numbers or a simple chart. One fact gets one plain sentence.",
].join("\n\n");

/** Channels whose reply is not drawn in the app. */
export const SHOW_VISUAL_BRIEF =
  "When a picture would show how something works, a comparison or a decision, draw it with show_visual. Pass title, summary and source. Do not pass help. Place the embed where the visual belongs. It works in the chat: do not tell the reader to open it. It is not saved; use save_page for something the user will keep, share or update.";
