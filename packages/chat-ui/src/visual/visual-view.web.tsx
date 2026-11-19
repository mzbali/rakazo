import type { VisualElement, VisualParse } from "@rakazo/core/visual-fence";
import type { HostBridge } from "@rakazo/page-kit/kit-host";
import { HostBridgeContext, visualKit as kit } from "@rakazo/page-kit/kit-host";
import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import { useMarkdownCopy } from "../markdown-copy";
import { FormulaText } from "./formula.web";
import { drawPlan, hasUnfinishedPart } from "./visual-draw";
import { useNarrowColumn, VisualShadow } from "./visual-shadow.web";
import { visualStyles } from "./visual-styles";

type Tone = ComponentProps<typeof kit.Callout>["tone"];

type Props<T extends keyof typeof kit> = ComponentProps<(typeof kit)[T]>;

/** The tabs that can show, a switch between them, and the chosen tab's own elements. */
function Tabs({ element, unavailable }: { element: VisualElement; unavailable: string }) {
  const [chosen, setChosen] = useState<string>();
  const tabs = element.children.filter((tab) => tab.state !== "invalid");
  const shown = tabs.find((tab) => tab.key === chosen) ?? tabs[0];
  return (
    <div className="rkv-root">
      {tabs.length > 0 ? (
        <kit.Segmented
          options={tabs.map((tab) => ({ value: tab.key, label: String(tab.props.label) }))}
          value={shown?.key}
          onChange={setChosen}
        />
      ) : null}
      {shown ? <Draw key={shown.key} element={shown} unavailable={unavailable} /> : null}
      {element.children.some((tab) => tab.state === "invalid") ? (
        <p className="rkv-note">{unavailable}</p>
      ) : null}
    </div>
  );
}

function Draw({
  element,
  unavailable,
}: {
  element: VisualElement;
  unavailable: string;
}): ReactNode {
  const narrow = useNarrowColumn();
  const plan = drawPlan(element);
  if (plan === "skip") return null;
  if (plan === "unavailable") return <p className="rkv-note">{unavailable}</p>;
  const { props } = element;
  const drawn = element.children.map((child) => (
    <Draw key={child.key} element={child} unavailable={unavailable} />
  ));
  switch (element.tag) {
    case "Visual":
      return <div className="rkv-root">{drawn}</div>;
    case "Grid":
      return <kit.Grid columns={props.columns as number | undefined}>{drawn}</kit.Grid>;
    case "Callout":
      return (
        <kit.Callout lead={props.lead as string | undefined} tone={props.tone as Tone}>
          {element.text || undefined}
        </kit.Callout>
      );
    case "Steps":
      return <kit.Steps steps={props.steps as ComponentProps<typeof kit.Steps>["steps"]} />;
    case "Metrics":
      return (
        <kit.Metrics metrics={props.metrics as ComponentProps<typeof kit.Metrics>["metrics"]} />
      );
    case "Diagram":
      return (
        <kit.Diagram
          nodes={props.nodes as ComponentProps<typeof kit.Diagram>["nodes"]}
          edges={props.edges as ComponentProps<typeof kit.Diagram>["edges"]}
          // A flow written left to right reads top to bottom in a narrow column.
          direction={
            narrow ? "vertical" : (props.direction as "horizontal" | "vertical" | undefined)
          }
        />
      );
    case "Formula":
      return <FormulaText tex={props.tex as string} />;
    case "Bars":
      return (
        <kit.Bars
          bars={props.bars as Props<"Bars">["bars"]}
          emphasis={props.emphasis as Props<"Bars">["emphasis"]}
        />
      );
    case "LineChart":
      return (
        <kit.LineChart
          points={props.points as Props<"LineChart">["points"]}
          lines={props.lines as Props<"LineChart">["lines"]}
          labels={props.labels as string[] | undefined}
          floor={props.floor as number | undefined}
          ceiling={props.ceiling as number | undefined}
          unit={props.unit as string | undefined}
        />
      );
    case "Pie":
      return (
        <kit.Pie
          parts={props.parts as Props<"Pie">["parts"]}
          total={props.total as boolean | string | undefined}
          label={props.label as string | undefined}
        />
      );
    case "Table":
      return (
        <kit.Table
          columns={props.columns as string[]}
          rows={props.rows as Props<"Table">["rows"]}
          align={props.align as Props<"Table">["align"]}
          emphasis={props.emphasis as number | undefined}
        />
      );
    case "ProsCons":
      return (
        <kit.ProsCons
          pros={props.pros as string[] | undefined}
          cons={props.cons as string[] | undefined}
          prosHeading={props.prosHeading as string | undefined}
          consHeading={props.consHeading as string | undefined}
        />
      );
    case "Status":
      // Inside a block, so the pill keeps its own width in a column.
      return (
        <div>
          <kit.Status tone={props.tone as Props<"Status">["tone"]}>{element.text}</kit.Status>
        </div>
      );
    case "CopyButton":
      return (
        <div className="rkv-copy">
          <pre className="rkv-copy-text">{props.text as string}</pre>
          <kit.CopyButton label={props.label as string} text={props.text as string} />
        </div>
      );
    case "Tabs":
      return <Tabs element={element} unavailable={unavailable} />;
    case "Tab":
      return <div className="rkv-root">{drawn}</div>;
    default:
      return null;
  }
}

/** The fence's drawn visual. Loaded on demand, so the kit stays out of the startup bundle. */
export default function VisualView({
  parse,
  streaming,
  bridge,
}: {
  parse: VisualParse & { root: VisualElement };
  streaming: boolean;
  bridge: HostBridge;
}) {
  const copy = useMarkdownCopy();
  const { root } = parse;
  const unfinished = hasUnfinishedPart(parse);
  // While it streams the unfinished part is one quiet line; once it ends, it did not draw.
  const showPending = streaming && !parse.truncated && unfinished;
  const showNote = parse.truncated || (!streaming && unfinished);
  return (
    <VisualShadow styles={visualStyles()} bridge={bridge} label={String(root.props.summary ?? "")}>
      <HostBridgeContext.Provider value={bridge}>
        <Draw element={root} unavailable={copy.visualUnavailable} />
        {showPending ? <div className="rkv-pending" aria-hidden="true" /> : null}
        {showNote ? <p className="rkv-note">{copy.visualUnavailable}</p> : null}
      </HostBridgeContext.Provider>
    </VisualShadow>
  );
}
