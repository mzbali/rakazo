import { parseVisualFence } from "@rakazo/core/visual-fence";
import type { HostBridge } from "@rakazo/page-kit/kit-host";
import type { ReactNode } from "react";
import { lazy, Suspense, useMemo } from "react";
import { drawsAsVisual } from "./visual-draw";
import "./visual.web.css";

// The page kit is large and few replies use it, so it loads when the first visual does.
const VisualView = lazy(() => import("./visual-view.web"));

/**
 * A ```ui fence drawn as real components on the chat background, filling in while the reply
 * streams. Anything that is not a usable visual stays the code block the caller passes.
 */
export function VisualFence({
  source,
  streaming,
  bridge,
  fallback,
}: {
  source: string;
  streaming: boolean;
  bridge: HostBridge;
  fallback: ReactNode;
}) {
  const parse = useMemo(() => parseVisualFence(source), [source]);
  if (!drawsAsVisual(parse, streaming)) return fallback;
  return (
    <Suspense fallback={<div className="rkv-host rkv-pending" aria-hidden="true" />}>
      <VisualView parse={parse} streaming={streaming} bridge={bridge} />
    </Suspense>
  );
}
