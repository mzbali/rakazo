import { parseVisualFence } from "@rakazo/core/visual-fence";
import type { ColorTokens, ResolvedAppearance } from "@rakazo/ui-tokens";
import type { ReactElement } from "react";
import { drawsAsVisual } from "./visual-draw";
import VisualView from "./visual-view.native";

/**
 * A ```ui fence drawn with native views, filling in while the reply streams. Undefined when the
 * fence does not read as a visual, which leaves it as the code block it is.
 */
export function visualFence(
  source: string,
  {
    streaming,
    palette,
    colorScheme,
    unavailable,
  }: {
    streaming: boolean;
    palette: ColorTokens;
    colorScheme: ResolvedAppearance;
    unavailable: string;
  },
): ReactElement | undefined {
  const parse = parseVisualFence(source);
  if (!drawsAsVisual(parse, streaming)) return undefined;
  return (
    <VisualView
      parse={parse}
      streaming={streaming}
      palette={palette}
      colorScheme={colorScheme}
      unavailable={unavailable}
    />
  );
}
