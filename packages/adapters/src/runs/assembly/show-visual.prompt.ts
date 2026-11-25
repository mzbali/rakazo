/** Shared by run instructions and rejected visuals. */
export const VISUAL_ESSENTIALS = [
  'JSX: export default, Section, no Page. Short Caption. Callout only for warnings. SVG: useTheme(), viewBox, width "100%", no vh. Split tall visuals.',
  'Nested sets: <Venn nested sets={[{label: "NP"}, {label: "P", tone: "success"}]} />, plus one Slider; Diagram a reduction.',
  'How it works, in stages: <Stages stages={[{id: "a", label: "One", title: "One", detail: "What happens"}]}><Diagram focus="a" nodes={[{id: "a", label: "One"}]} edges={[]} /></Stages>. A loop: Diagram layout="cycle" zones flows. Routes: Stages groups={[{label,stages}]}.',
  'Calculator: useState, Slider (label is the name only; prefix, suffix or format "£0,0" prints the value once), Result, LineChart marker={index}. Choices radio {label,options,value,onChange} asks for preferences. A split: one Result tone="success", amount first.',
  "Mix: Pie parts=[{label,value,detail}] total label unit percentDigits={1}; StackedBars showShares, ColumnSeries across periods.",
  "Trend: Metrics, LineChart with month Slider marker, annotations=[{at,label}], reference={value,label}, jump Buttons and history table.",
  "Before/after location: Metrics, Rings {rings,center,markers:[{ring:0,label}]}, horizontal Bars, savings sliders and route table.",
  'Years: <Timeline items={[{date: "1969", title: "Landing", detail: "Moon"}]} /> or groups, a year Slider, ColumnSeries counts. Ticks: <Checklist interactive collapsible sections={[{title, items: [{text}]}]} />, Bars for progression.',
  'Practice: <Quiz questions={[{question: "Q", options: ["A", "B"], answer: 0, explain}]} /> or <Flashcards cards={[{front: "Q", back: "A"}]} />.',
].join("\n");

/** App chats also support ui fences. */
export const SHOW_VISUAL_INSTRUCTION = [
  "To understand something or how it works, or for a checklist, a timeline, a bill to split or data you found, call show_visual before you reply. Practice uses it too. For an explanation, number the sections.",
  "Once the data is in hand, draw it with show_visual; a series over time is a LineChart with marker and annotations. A PNG is only when the user asks for an image file. Do not plot it on the computer.",
  "To compare or decide, or whether to buy or return, call show_visual, then open with the pick. Next is a prefilled calculator, or one picture of what differs. A web search does not replace it.",
  "Pass title, summary and source to show_visual, then place the returned embed. A long explanation is short prose between two and four focused visuals, each doing one job; split a tall visual so each works inline. Do not pass help, paste source or tell the reader to open it.",
  VISUAL_ESSENTIALS,
  "A ui fence is for a table, steps, key numbers or a simple chart. A bill split is one Result, not a table. One fact, such as the time in a place, gets one plain sentence and no picture.",
].join("\n\n");

/** Channels whose reply is not drawn in the app. */
export const SHOW_VISUAL_BRIEF =
  "When a picture would show how something works, a comparison or a decision, draw it with show_visual. Pass title, summary and source; the reader here gets only its title and summary, so put the point and key figures in the summary. Do not pass help. Place the embed where the visual belongs, and do not tell the reader to open it. It is not saved; use save_page for something the user will keep, share or update.";
