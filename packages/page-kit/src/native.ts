/**
 * The parts of the kit with no DOM in them, for the phone app to draw the same visuals from the
 * same layout: where a diagram's nodes and curves go, and the strokes of a callout's icon.
 */
export type { DiagramEdge, DiagramNode, Placed, Point } from "./kit/diagram-layout.js";
export {
  curveMid,
  DETAIL_LINE,
  edgePoints,
  LABEL_LINE,
  layoutDiagram,
  PAD_Y,
  SERIES_COLORS,
  wrapText,
} from "./kit/diagram-layout.js";
export { TONE_PATHS } from "./kit/tone-icon.js";
