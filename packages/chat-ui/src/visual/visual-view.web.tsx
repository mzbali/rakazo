import type { VisualElement, VisualParse } from "@rakazo/core/visual-fence";
import type { HostBridge } from "@rakazo/page-kit/kit-host";
import { HostBridgeContext, visualKit as kit } from "@rakazo/page-kit/kit-host";
import type { ComponentProps, ReactNode } from "react";
import { useMarkdownCopy } from "../markdown-copy";
import { FormulaText } from "./formula.web";
import { drawPlan, hasUnfinishedPart } from "./visual-draw";
import { useNarrowColumn, VisualShadow } from "./visual-shadow.web";
import { visualStyles } from "./visual-styles";

type Tone = ComponentProps<typeof kit.Callout>["tone"];

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
