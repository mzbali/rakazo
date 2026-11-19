/**
 * The parts of the kit with no DOM in them, for the phone app to draw the same visuals from the
 * same layout: where a diagram's nodes and curves go, and the strokes of a callout's icon.
 */

export type { Formatter } from "./kit/dataviz/scale.js";
export {
  axisGutter,
  finite,
  formatValue,
  niceStep,
  seriesColor,
  textWidth,
  valueScale,
} from "./kit/dataviz/scale.js";
export type { IconShape } from "./kit/diagram-icons.js";
export { DIAGRAM_ICONS, iconShapes } from "./kit/diagram-icons.js";
export type { DiagramEdge, DiagramNode, Placed, Point } from "./kit/diagram-layout.js";
export {
  curveMid,
  DETAIL_LINE,
  edgePoints,
  ICON_SIZE,
  iconOrigin,
  LABEL_LINE,
  layoutDiagram,
  PAD_Y,
  SERIES_COLORS,
  textCentre,
  wrapText,
} from "./kit/diagram-layout.js";
export { nativeWords } from "./kit/native-words.js";
export { TONE_PATHS } from "./kit/tone-icon.js";
