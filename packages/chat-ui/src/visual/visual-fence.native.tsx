import { parseVisualFence } from "@rakazo/core/visual-fence";
import type { ReactNode } from "react";
import { useContext, useMemo } from "react";
import { VisualsContext } from "../markdown";
import { useMarkdownCopy } from "../markdown-copy";
import { DiagramSurfaceContext } from "../native/code";
import { drawsAsVisual } from "./visual-draw";
import VisualView from "./visual-view.native";

/**
 * A ```ui fence drawn with native views, filling in while the reply streams. It stays the code
 * block the caller passes unless the text came from a Space's own bot and reads as a visual.
 */
export function VisualFence({ source, fallback }: { source: string; fallback: ReactNode }) {
  const visuals = useContext(VisualsContext);
  const { streaming, palette, colorScheme } = useContext(DiagramSurfaceContext);
  const copy = useMarkdownCopy();
  const parse = useMemo(() => parseVisualFence(source), [source]);
  if (!visuals || !drawsAsVisual(parse, streaming)) return fallback;
  return (
    <VisualView
      parse={parse}
      streaming={streaming}
      palette={palette}
      colorScheme={colorScheme}
      unavailable={copy.visualUnavailable}
    />
  );
}
