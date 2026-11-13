import { useLingui } from "@lingui/react/macro";
import type { MessageBlock } from "@rakazo/contracts";
import type { VisualFit } from "@rakazo/core";
import { visualFit } from "@rakazo/core";
import { Button } from "@rakazo/ui-web";
import { Maximize2, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLiveNearView } from "../../lib/live-previews";
import { usePageDocument } from "../../lib/pages";
import { PageFrame } from "../pages/PageFrame";

type VisualBlock = Extract<MessageBlock, { kind: "visual" }>;

/** The tallest a visual works in the chat; taller ones show their top and open whole. */
const MAX_INLINE_HEIGHT = 640;
/** The space a visual holds before it reports its height, so the chat does not jump much. */
const PLACEHOLDER_HEIGHT = 160;

/**
 * A visual the bot drew in the chat. One that fits works in place, under the same rules as an
 * opened page, and opens whole only from its Expand button. A taller one draws its top inert and
 * opens whole on a click, where its controls work.
 */
export function VisualCard({ block }: { block: VisualBlock }) {
  const { t } = useLingui();
  const box = useRef<HTMLDivElement>(null);
  const live = useLiveNearView(box);
  const viewer = usePageDocument(block.code, "card", false, 0, "card");
  const [open, setOpen] = useState(false);
  // State rather than a ref: the link prompt portals into it, since a modal dialog makes the rest
  // of the page inert.
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    if (open) dialog?.showModal();
    else if (dialog?.open) dialog.close();
  }, [open, dialog]);
  const summaryId = useId();
  // The last height the visual reported; kept while it is out of the live set, so the chat
  // does not jump when it scrolls back and draws again.
  const [height, setHeight] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [fit, setFit] = useState<VisualFit>("drawing");
  const onHeight = useCallback((next: number) => {
    if (next <= 0) return;
    setHeight(next);
    setDrawn(true);
    setFit((current) => visualFit(current, next, MAX_INLINE_HEIGHT));
  }, []);
  useEffect(() => {
    if (!live) setDrawn(false);
  }, [live]);
  const shown = Math.min(height ?? PLACEHOLDER_HEIGHT, MAX_INLINE_HEIGHT);
  const inline = fit === "inline";
  // An inline visual that grew past the card scrolls in its frame instead of fading out.
  const clipped = !inline && height !== null && height > MAX_INLINE_HEIGHT;
  return (
    <div
      data-testid="visual-card"
      className="relative w-full max-w-[561px] overflow-hidden rounded-[24px] bg-card ring-[0.5px] ring-border has-focus-visible:ring-2 has-focus-visible:ring-ring"
    >
      <div
        ref={box}
        aria-hidden={inline || open ? undefined : "true"}
        className={`relative w-full overflow-hidden ${inline || open ? "" : "pointer-events-none"}`}
        style={{ height: shown }}
      >
        <dialog
          ref={setDialog}
          role={open ? "dialog" : "generic"}
          aria-label={open ? block.title : undefined}
          onClose={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          className={
            open
              ? "fixed inset-0 m-auto h-[88dvh] max-h-none w-[94vw] max-w-[960px] overflow-hidden rounded-2xl border-0 bg-card p-0 text-foreground backdrop:bg-overlay"
              : "relative m-0 block h-full w-full max-w-none border-0 bg-transparent p-0 text-foreground"
          }
        >
          {open ? (
            <header className="flex h-14 items-center border-b border-border px-5">
              <span className="min-w-0 flex-1 truncate text-body font-medium">{block.title}</span>
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label={t`Close preview`}
                onClick={() => setOpen(false)}
              >
                <X />
              </Button>
            </header>
          ) : null}
          {(live || open) && viewer.document !== null ? (
            // Never taller than the card shows: the reported height is the content's, not the frame's.
            <div
              inert={!inline && !open}
              className="absolute inset-x-0"
              style={open ? { top: 56, bottom: 0 } : { top: 0, height: shown }}
            >
              <PageFrame
                portalContainer={dialog}
                document={viewer.document}
                title={block.title}
                interactive={inline || open}
                onHeight={onHeight}
              />
            </div>
          ) : null}
        </dialog>
        {drawn ? null : (
          <div
            className={`absolute inset-0 flex flex-col justify-end gap-2 p-5 ${viewer.failed ? "" : "motion-safe:animate-pulse"}`}
          >
            <p className="line-clamp-4 text-body text-muted-foreground">{block.text}</p>
          </div>
        )}
        {clipped && !open ? (
          <div className="absolute inset-x-0 bottom-0 h-[80px] bg-linear-to-b from-transparent to-card" />
        ) : null}
      </div>
      <span id={summaryId} hidden>
        {block.text}
      </span>
      {inline ? (
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label={t`Expand ${block.title}`}
          aria-describedby={summaryId}
          onClick={() => setOpen(true)}
          className="absolute top-3 right-3 rounded-full"
        >
          <Maximize2 />
        </Button>
      ) : (
        <button
          type="button"
          aria-label={t`Open ${block.title}`}
          aria-describedby={summaryId}
          onClick={() => setOpen(true)}
          className="absolute inset-0 rounded-[24px] outline-none"
        />
      )}
    </div>
  );
}
