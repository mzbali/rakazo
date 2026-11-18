import type { VisualElement, VisualParse } from "@rakazo/core/visual-fence";

/** The language of a fence a bot draws as a visual. */
export const VISUAL_FENCE_LANGUAGE = "ui";

/** Tags that hold elements: their complete children draw while they are still open. */
const HOLDS_ELEMENTS = new Set(["Visual", "Grid"]);

export type DrawPlan = "draw" | "skip" | "unavailable";

/**
 * What to do with an element of a fence being read. An element mounts once it is complete, and
 * a container once its opening tag is read; an unfinished element that draws whole waits.
 */
export function drawPlan(element: VisualElement): DrawPlan {
  if (element.state === "invalid") return "unavailable";
  if (element.state === "open" && !HOLDS_ELEMENTS.has(element.tag)) return "skip";
  return "draw";
}

function anyUnfinished(element: VisualElement): boolean {
  if (element.state === "open" && !HOLDS_ELEMENTS.has(element.tag)) return true;
  return element.state !== "invalid" && element.children.some(anyUnfinished);
}

/** Whether something after the last complete sibling is still being written. */
export function hasUnfinishedPart(parse: VisualParse): boolean {
  return parse.tail || (parse.root !== undefined && anyUnfinished(parse.root));
}

/**
 * Whether a fence draws as a visual at all. A fence that is not a `<Visual>`, one whose summary
 * is not usable, and a finished one over the size limit stay code blocks.
 */
export function drawsAsVisual(
  parse: VisualParse,
  streaming: boolean,
): parse is VisualParse & {
  root: VisualElement;
} {
  return (
    parse.root !== undefined && parse.root.state !== "invalid" && (streaming || !parse.truncated)
  );
}
