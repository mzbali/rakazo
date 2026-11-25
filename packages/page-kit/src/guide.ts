/** Returned by save_page {"help": true}, so ordinary turns do not pay for it. */
export const PAGE_KIT_GUIDE = `# Pages

A page is JSX source whose default export is a React component. It renders in an isolated viewer in the user's light or dark theme and prints cleanly.

## Rules
- Everything below is already in scope: React, Fragment, useState, useMemo, useEffect, useRef, useCallback, useReducer, the kit components and its helpers. Imports are optional; only "react" and "rakazo/page" (the kit) are allowed. No require, network or CSS files.
- Exactly one \`export default\` (your top component). Helper components and data objects in the same file are fine.
- Do not name your own component after a kit component (Page, Status, Table, Rows...): it replaces the kit's in the whole file, so using that kit component inside it renders itself forever, and the check refuses it. Call it StatusPage, BotTable and so on.
- Gather data first and keep it in one object at the top. Write figures already formatted ("$12,400", "4.8%") and write plain characters, not HTML escapes ("<800ms", not "&lt;800ms").
- Plain HTML and SVG elements (div, span, svg, path, rect, circle, text, linearGradient, animate...) with style={{...}} are allowed for custom visuals; take colours from useTheme() so they match both themes. script, style, iframe, object, embed and foreignObject are not allowed, and handlers are functions, never strings. Images are data: URIs only, or rakazo-image:<n> when show_visual fetched them (see Media).
- Save with save_page {title, source}. To change it later, pass the pageId you got back with edits [{find, replace}] (all apply or none do) or the whole new source; pass only pageId to read the current source.

## Design rules
- Show, don't narrate: pick the richest component that fits the data. Numbers become Metrics, trends a LineChart, comparisons Bars, shares a Pie, flows a Diagram, one set inside another a nested Venn, sequences Steps, options ProsCons, statuses toned Status pills. A paragraph is for the one thing a visual cannot say.
- Lead with the answer: a Callout (lead + tone) or Metrics first, evidence below. The reader should get the point in two seconds.
- Long pages (five or more sections) start with a TableOfContents whose ids match the Section ids. Number sections in reading order when the order matters.
- Avoid walls of text and walls of identical cards: mix open sections, a Grid of two or three cells and one or two tables. Break prose into BulletList / NumberedList items.
- Colour comes from the kit and useTheme: no hex colours, no gradients or glows, no emoji as icons or bullets. Tones (success, warning, danger, info) are for meaning, not decoration.
- Every chart sits in a Section with a heading and, when useful, a caption naming the unit, the period and the source. Omit a section rather than show empty data or placeholder text.
- A LineChart axis starts at 0 unless floor is set: for a narrow range (3.05% to 3.41%) set floor and ceiling just around the data. Chart series take palette colours in order, never tones; to make a part mean "failed", put that colour first with Page palette (from useTheme).
- Custom SVG with text gets a fixed width and height plus style={{maxWidth: "100%"}}; a small viewBox at width "100%" scales its text with the page.
- End research with LinkCards of the sources (site and date), after a Divider.

## Recipes
- Dashboard (width "wide"): Section with a Segmented period switch in actions -> Metrics -> Grid of two charts -> Table with toned Status cells -> Callout with the takeaway.
- Report or research dossier: TableOfContents -> Callout summary (lead + tone) -> numbered Sections, each a short Text plus a Table, Bars or BulletList -> Quote -> ProsCons -> Divider -> LinkCards (numbered) of sources -> Footnote for method notes.
- Tracker: Metrics of progress -> Checklist or Rows with Status -> Steps for what is next -> Properties for owners and dates.
- Plan: Callout with the goal -> Steps or a Diagram of the phases -> Table of milestones with Status -> NumberedList of open questions.
- Long reference: TableOfContents -> collapsible Sections (collapsible, defaultOpen for the first) so the reader opens what they need.

## Components
Text props and list items accept **bold**, *italic* or _italic_, \`code\` and bare https:// or www. links. Tones: "success" | "warning" | "danger" | "accent" | "info".

### Structure
- Page {title, summary?, width?: "column" | "wide" | "full", lang?, palette?: [colour], sources?: [url]}: the page. "column" (default) for reading, "wide" for dashboards; palette replaces the first chart colours; sources become a footer of links. lang is the content's language tag ("fr", "he"); the kit's own buttons, empty states, dates and numbers follow it, and Hebrew or Arabic read right to left. A PageHero given first sits above the title.
- PageHero {eyebrow?, eyebrowMark?}: a small label and any art above the title. PageMeta: a byline or date line. Footnote: a small trailing note.
- Section {heading? or title?, id?, caption?, source?, actions?, collapsible?, defaultOpen?}: a block with a heading; title is the same text as heading. Nesting steps the heading down a level; a figure, or a cell in a Grid, is a card. caption sits inside that card, under the picture. actions sits on the heading line. collapsible folds it behind its heading, closed unless defaultOpen.
- Caption: the one line under a picture. Write it inside the Section, after the picture.
- TableOfContents {items: [{label, id, depth?}], title?}: "On this page" links that follow the reader's position; long lists fold, phones get a compact menu.
- Grid {columns}: side by side (1 to 4 columns); stacks on phones.
- Divider: a hairline between parts. Floating {edge?: "bottom" | "top", align?: "start" | "center" | "end", bar?}: a row of controls pinned while scrolling. BackToTop {label?}: a button back to the top.

### Text and lists
- Text: a paragraph. Callout {lead?, tone?}: a tinted note; children are the body.
- Quote {cite?}: a quotation with its source.
- BulletList {items, marker?: "pro" | "con"} and NumberedList {items}: an item is a string or {text, items?} for a nested list.
- ProsCons {pros, cons, prosHeading?, consHeading?}: two cards of plus and minus points.
- LinkCards {links: [{title, href, site?, date?}], numbered?}: a list of sources or related pages; the site defaults to the link's address.
- Legend {names: [string], comparison?: [index], dots?}: series names in chart colours, for a custom visual; comparison lists indexes of names drawn as grey dashed lines.

### Math
- Equation {label?}: a centred formula; children are terms. Frac {num, den}, Pow {base, exp}, Sqrt, Sum {from?, to?, sign?}, Paren {open?, close?}. Example: <Equation label="Break-even">Sales = <Frac num="fixed costs" den="margin" /></Equation>.

### Data
- Metrics {metrics: [{value, label, detail?, tone?, delta?, better?, trend?}]}: headline numbers, up to four a row; tone colours the detail. delta ("+12%" or -3) adds an up or down mark, green when it moves the good way (better: "up" default, or "down" for churn and cost); trend (numbers) adds a small line under the figure.
- Result {label?, value, unit?, note?, tone?, groups?: [{label, value}] | [[{label, value}]], copy?: {label, text}, inset?}: the answer. The value is large, the unit sits beside it, and the default inset is one shade off the card. tone colours the value. groups are label-over-value rows. copy is a full-width copy button. Set inset={false} when the value sits on the card itself.
- Properties {items: [{label, value}]}: label and value pairs; value may be a Status.
- Status {tone?}: a short status word in a tinted pill, e.g. <Status tone="success">Shipped</Status>; tone "neutral" or none is grey.
- Rows {rows: [{title, lead?, detail?, meta?, status?: {label, tone}}]}: a list; lead sits in a narrow column before the title, the status follows the title in its tone, meta sits at the right.
- Steps {steps: [{title, detail?}]}: a sequence. Checklist {items: [{text, done?, meta?}], sections?: [{title, items}], label?, interactive?, collapsible?, onChange?}: interactive adds ticks, progress, Reset and Copy. sections replace items; collapsible shows one section at a time.
- Timeline {groups: [{label, items: [{title, note?, detail?, series?, open?}]}], items?: [{date?, title, detail?}], focus?}: a year column and rows that open their detail. focus highlights the group with that label. A flat items list draws one row each, using date, year or label as the year. A Slider beside it can set focus.
- Table {columns: string[], rows: cell[][], align?: ("auto" | "start" | "end" | "center")[], emphasis?: column, sortable?: boolean}: a cell is text, a number, {text, tone?} or a Status. Figures and single short words align to the end. Wide tables scroll sideways; long ones get a filter box and a sticky header; sortable makes headers sort.

### Charts
- LineChart {points: [{label, value}], floor?, ceiling?, unit?, format?: (n) => string, labels?: [seriesName], lines?: [{label, values}], secondary?: {label, values}, annotations?: [{at: index | "zero", label}], marker?: index, reference?: {value, label}, legend?}: a trend; one series gets an area fill, lines add series, secondary adds a grey dashed comparison. A missing value leaves a gap. marker pins the dashed vertical guide and outlined dot (a Slider's index). reference is a dashed horizontal line. A note or reference name that would overlap another or run off the edge is left off.
- Bars {bars: [{label, value, display?}], horizontal?}: horizontal rows with values at the end. Short positive labels default to columns unless horizontal is true.
- Columns {points: [{label, value, display?}]}: vertical columns with their value on top, for a few periods or categories; values are 0 or more, so chart losses or other negatives with Bars.
- ColumnSeries {labels: string[], series: [{name, values}], stacked?, unit?, format?, ceiling?, reference?: {value, label}, legend?}: several series per label, side by side or stacked.
- StackedBars {series: string[], bars: [{label, values, display?}], showShares?}: rows split into named parts. showShares labels parts with their percentages.
- Pie {parts: [{label, value, display?, detail?}], total?: true | text, label?, unit?, percentDigits?}: doughnut and legend. Put a note in detail to make that row expandable. total centres the sum or your text with label and unit.
- Scatter {points: [{x, y, size?, label?, series?}], x?: {name, unit, format, floor, ceiling}, y?: {...}, size?: {name}, trend?, legend?}: two measures against each other; trend draws a fitted line and labels points far off it.
- Heatmap {rows: string[], columns: string[], values: number[][], max?}: a grid shaded by value, such as weekday by hour.
- CalendarHeatmap {days: [{date: "YYYY-MM-DD", value}], from?, to?, max?, note?}: daily activity in week columns.
- Venn {sets: [{label, count?, items?, note?, tone?}], overlap?, nested?}: two or three overlapping groups. nested draws them as circles one inside the next (the first set is the outside); each label sits in its band. Keep a label to a few words so it stays inside the circle. note is a second line, and tone ("success", "warning", "danger", "info") colours that circle. overlap names the shared part and is not drawn when nested.
- Rings {rings: string[], center?, markers: [{ring, label}]}: two to four nested zones, outside first. Up to two locations, each with a zero-based ring index and short label.
- Matrix2x2 {axes: {x: [low, high], y: [low, high]}, quadrants: [topLeft, topRight, bottomLeft, bottomRight], points: [{label, x, y}]}: items placed from 0 to 1 on two axes.
- SourceStamp {source}: when data was read, "As of Oct 30, 2026" for a snapshot or "Updated 3 min ago" when live.
- Diagram {nodes: [{id, label, detail?, kind?: "box" | "terminal", series?: 0..4, icon?, tone?}], edges: [{from, to, label?, dashed?, tone?}], direction?: "vertical" | "horizontal", layout?: "cycle", zones?: [{label, nodes, tone?}], flows?: [{node, label, direction?: "in" | "out", tone?}], center?, focus?}: a flow, or a closed loop when layout is "cycle". Loop nodes go clockwise from the left. zones tint the regions they name. tone is info (cold), warning (warm) or danger (hot). flows are labelled arrows into or out of a node. center is the words in the middle. focus highlights that node.
- Stages {stages: [{id, label, title?, detail}], groups?: [{label, stages}], value?, onChange?}: up to four pill choices. A longer flat list is a progress bar, the stage title, and Previous and Next. Groups are a connected path with progress. Then the children. A child Diagram highlights the node whose id matches.
- Cycle explainer: Stages around <Diagram layout="cycle" center="Water cycle" nodes={[{id: "sea", label: "Sea", icon: "droplet"}, {id: "vapour", label: "Vapour", icon: "sun"}, {id: "cloud", label: "Cloud", icon: "cloud"}, {id: "rain", label: "Rain", icon: "droplet"}]} edges={[{from: "sea", to: "vapour", tone: "warning"}, {from: "vapour", to: "cloud", tone: "info"}, {from: "cloud", to: "rain", tone: "info"}, {from: "rain", to: "sea", tone: "info"}]} zones={[{label: "Surface", nodes: ["sea"]}, {label: "Sky", nodes: ["cloud"], tone: "info"}]} flows={[{node: "sea", label: "Heat in", direction: "in", tone: "warning"}]} />. The chosen stage lights its node.
LineChart, Columns, ColumnSeries, Scatter, Heatmap and CalendarHeatmap show exact values on hover and with the arrow keys once focused; Bars, Pie, StackedBars, Venn, Matrix2x2 and Diagram print theirs, so put every figure a reader needs in their labels or display text. Give each a Section heading and say the unit in the heading, caption or unit prop.

### Controls
- Segmented {options: (string | {value, label, count?})[], value, onChange}: plain text tabs. The chosen tab is foreground. Wraps onto more lines; the chosen tab always shows.
- Slider {label, value, min, max, step, prefix?, suffix?, format?: string | (n) => string, ticks?: [{value, label}], onChange}: the label is the name only. The value sits at the right. suffix "%" and step 0.25 show 4.50% beside "Interest rate". A format string ("£0,0", "0.00%") or a function also prints it. ticks sit under the rail.
- Choices {options: (string | {value, label})[], value, onChange, columns?, label?, radio?}: a grid of pills, or a radio group with a visible question. The chosen pill is filled.
Keep each control's value in useState. A control placed straight in a Section or Grid is compact; inside your own element it is full size.
- Button {label, onClick, variant?: "quiet" | "primary", disabled?}: one primary per group.
- Select {label?, options: [{value, label}], value, onChange, placeholder?, disabled?}. Input {label?, value, onChange, placeholder?, type?: "text" | "number" | "search", min?: number}. Set min={0} on a number that can't go negative.
- Toggle {label, value, onChange, disabled?}. Checkbox {label, value}: shows a recorded yes or no; the reader cannot change it. Things the reader ticks off are Checklist interactive. A number the reader steps (servings, quantity) is a row of Button "−", the value and Button "+", or a Slider. Input has no Enter or submit event: act on onChange, or put a Button beside it.
- Quiz {questions: [{question, options: [string], answer: index, explain?}]}: each pick reveals feedback and enables Next. The last answer shows a score and retry. answer is the correct option's zero-based index.
- Flashcards {cards: [{front, back}]}: flip a card, mark it known or not, and shuffle. It shows which card this is and how many are known.
- LinkButton {label, href, variant?: "button" | "text"} and TextLink {href, children}: web or mail links, opened by the app.
- CopyButton {label, text?, copiedLabel?}: copies text (else the label) and shows "Copied"; where copying is blocked it shows the text to select. For your own copy buttons call copyText(text), which resolves true once copied; navigator.clipboard is blocked in pages.
- ReplyButton {label, reply?}: puts reply (or the label), up to 300 characters, in the chat's message box for the reader to send. It is inactive where there is no chat, such as a shared page.

### Media
Use data: URIs for media, or a local blob: for audio and video. For fetched photos, pass images: [{url, alt}] to show_visual (max 4). Use <Image src="rakazo-image:1" alt="Description" caption="Name" />, counting from 1. Retry without failed photos.
- Image {src, alt, caption?, fit?: "cover" | "contain", width?, height?, ratio?: number | "16/9"}: click to enlarge.
- Gallery {photos: [{src, alt}], height?}: up to 8 photos the reader swipes or steps through.
- PhotoStrip {items: [{image, alt?, title?, price?, note?, href?}], tileWidth?, imageHeight?}: a sideways row of small cards.
- Video {src, alt, poster?, caption?, autoplay?, loop?, controls?, ratio?} and Audio {src, alt, caption?, loop?}.

### Calendar
Dates are "YYYY-MM-DD"; times are hours as numbers (13.5 is 1:30 PM). Mark an event selected for the one that matters, free for open time.
- MonthView {month: "YYYY-MM", events: [{date, title, free?, selected?}], today?}: busy days fold into "+N more".
- WeekView {week: first day, start?, end?, events: [{date, start, end, title, free?, selected?}], today?, now?: hour}.
- DayView {start?, end?, events: [{start, end, title, free?, selected?}], mark?: {at: hour}}: events before the mark are crossed out.

### Cards and people
- ProductCard {title, href?, image?, price?, note?, badge?, store?, rating?, reviews?, compact?}: put several in a CardGrid {label?} (a grid) or CardCarousel {label?} (a row that scrolls on phones).
- ProductRows {items: [same fields]}: products as one list card. RatingSummary {rating: 0 to 5, reviews?}.
- WatchCard {title, detail?, label?, reply}: offers to have the bot keep watch, through the chat like ReplyButton.
- Avatar {name, size?, neutral?} and AvatarStack {people: [name or {name}], max?, label?}: initials in a circle; extra people fold into "+N".

### Helpers
- useTheme(): the current theme as values for custom elements: {kind, bg {base, subtle, elevated}, text {primary, secondary, tertiary, accent, success, warning, danger, ...Deep}, fill, border, font, weight, radius, motion, dataviz {categorical, sequential, diverging, other, negative}}. It follows the reader's light or dark mode.
- computeDAGLayout(nodes, edges, {direction?}): the Diagram's layout, for drawing your own flow.
- useSource(id): reads a snapshot declared in a comment that opens the file: "/* page-sources" on the first line, then a JSON object such as {"sales": {"snapshot": {...}, "asOf": "2026-10-30"}}, then "*/". useSource returns {value, asOf, fresh, updating}; nothing refreshes live yet, so fresh is always false. SourceStamp also takes a hand-written {asOf}.

## Example
const data = {
  week: { revenue: "$12,400", users: "398", trend: [42, 51, 47, 63, 58, 71, 66], labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
  month: { revenue: "$48,900", users: "1,640", trend: [210, 245, 232, 268], labels: ["W1", "W2", "W3", "W4"] },
};

function Dashboard() {
  const [period, setPeriod] = useState("week");
  const d = data[period];
  const points = useMemo(() => d.trend.map((value, i) => ({ label: d.labels[i], value })), [d]);
  return (
    <Page title="Weekly business review" summary="Billing export and product analytics, refreshed Monday 9:00." width="wide">
      <Section heading="Headline figures" actions={<Segmented options={[{ value: "week", label: "This week" }, { value: "month", label: "This month" }]} value={period} onChange={setPeriod} />}>
        <Metrics metrics={[{ value: d.revenue, label: "Revenue" }, { value: d.users, label: "New users", detail: "+12% vs last period", tone: "success" }]} />
      </Section>
      <Grid columns={2}>
        <Section heading="Signups" caption="Daily, all sources">
          <LineChart points={points} floor={0} labels={["Signups"]} />
        </Section>
        <Properties items={[
          { label: "Billing", value: <Status tone="success">Healthy</Status> },
          { label: "Churn alert", value: <Status tone="warning">Watching</Status> },
          { label: "Owner", value: "Finance" },
        ]} />
      </Grid>
      <Section heading="Launch checklist">
        <Checklist items={[
          { text: "Pricing page live", done: true, meta: "Shipped Tuesday" },
          { text: "Annual plan in checkout", done: false, meta: "Waiting on tax review" },
        ]} />
      </Section>
    </Page>
  );
}

export default Dashboard;
`;

/** Returned by show_visual {"help": true}: how a visual differs from a page, then the kit guide. */
export const VISUAL_GUIDE = `# Visuals

A visual is a small piece of page-kit JSX drawn in the chat. Place the embed show_visual returns where it belongs. It is not saved; show a new one to change it. For something the user will keep, share or update, use save_page.

- Call show_visual {title, summary, source, images?}. summary is one or two plain sentences with the point and the key figures: the user reads it where the visual cannot be drawn, and you see it later.
- It draws at message width, up to about 2400 pixels tall, and a visual that fits works in place, controls included. Keep it to one idea. A phone is about 340 pixels across, so a Diagram of more than two steps reads better vertical. Never tell the reader to open it full size.
- Skip the Page wrapper. A Section heading names it, and caption is the one line inside the card, under the picture. Size custom SVG with a viewBox and width "100%", and take colours from useTheme(). Never use vh: the frame grows to fit.
- The compiled visual must stay under 32 KB. Put larger work in a page.

## Patterns
One idea per visual. A long answer is short numbered prose between two and four of them. The page recipes below lead with a Callout. A chat visual does not: at most one Callout, for a real warning or the takeaway, never as a diagram or a definition.

Plain labels ("Number of elements", "Polynomial"). No "drag me", and no instruction to tap or open. One caption line inside the card, under the picture. Monochrome. success and danger only where the colour is the meaning, such as polynomial against exponential. A grid or board is custom SVG from useTheme(). One set inside another is <Venn nested sets={[{label: "NP"}, {label: "P", tone: "success"}]} />. A flow of named boxes is a Diagram.

- A concept: show_visual for each picture, and for one control where moving it changes a variable and shows the point. A ui fence is for a table, steps or a few numbers.
- Comparison: open with the finding. Put exact values in a table and show the key difference with horizontal Bars. For a buying decision, lead with the pick and add a calculator prefilled with the figures available. Put Choices radio for missing preferences in a separate visual. Use ProductRows for linked options. Put a Grid with one or two Images in a Section. Use short captions and omit fixed sizes. Put the comparison Table directly in a Section.
- Mix: Pie with a centred total and expandable notes, StackedBars showShares, then ColumnSeries for changes across periods.
- Trend: Metrics, LineChart with a relevant peak and target, a month Slider and jump buttons, then a compact table.
- Before/after location: Metrics, Rings with both markers, horizontal Bars, adjustable savings and a route table.
- An interactive diagram: Segmented, or tappable parts, highlights one part and shows its detail.
- A calculator: one Grid columns={1} around one Section, then inputs, Slider, Result and a LineChart with marker. The Grid keeps them one card.
- A year list: Timeline. A stage explainer: Stages around a Diagram. A cycle explainer: Stages around a Diagram with layout="cycle" (nodes clockwise from the left; info is cold, warning or danger is hot). A list the reader ticks: Checklist interactive, with sections.
- A small tool: a Slider, a stepper (Button "−", the value, Button "+") or tip buttons recalculates from the figures you found.
- Learning or revision: Quiz or Flashcards.
- Plain text when a visual adds nothing. A one-line question gets one line.

${PAGE_KIT_GUIDE.replace(/^# Pages\n/, "")}`;
