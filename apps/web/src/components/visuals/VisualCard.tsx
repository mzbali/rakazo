import { useLingui } from "@lingui/react/macro";
import type { MessageBlock } from "@rakazo/contracts";
import { Button, Dialog, DialogClose, DialogContent, DialogTitle } from "@rakazo/ui-web";
import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLiveNearView } from "../../lib/live-previews";
import { usePageDocument } from "../../lib/pages";
import { PageFrame } from "../pages/PageFrame";

type VisualBlock = Extract<MessageBlock, { kind: "visual" }>;

/** The tallest a visual draws in the chat; taller ones fade out and open whole. */
const MAX_INLINE_HEIGHT = 640;
/** The space a visual holds before it reports its height, so the chat does not jump much. */
const PLACEHOLDER_HEIGHT = 160;

/**
 * A visual the bot drew in the chat. In the chat it only draws: the frame is inert, so its code
 * cannot take focus, clicks or keys there. Opening it shows it whole, where its controls work
 * under the same rules as an opened page.
 */
export function VisualCard({ block }: { block: VisualBlock }) {
  const { t } = useLingui();
  const box = useRef<HTMLDivElement>(null);
  const live = useLiveNearView(box);
  const viewer = usePageDocument(block.code, "card", false, 0, "card");
  const [open, setOpen] = useState(false);
  // Built only once opened: each document carries the whole page runtime.
  const opened = usePageDocument(open ? block.code : undefined, "card", false, 0, "full");
  const summaryId = useId();
  // The last height the visual reported; kept while it is out of the live set, so the chat
  // does not jump when it scrolls back and draws again.
  const [height, setHeight] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);
  const onHeight = useCallback((next: number) => {
    if (next <= 0) return;
    setHeight(next);
    setDrawn(true);
  }, []);
  useEffect(() => {
    if (!live) setDrawn(false);
  }, [live]);
  const shown = Math.min(height ?? PLACEHOLDER_HEIGHT, MAX_INLINE_HEIGHT);
  const clipped = height !== null && height > MAX_INLINE_HEIGHT;
  return (
    <>
      <div
        data-testid="visual-card"
        className="relative w-full max-w-[561px] overflow-hidden rounded-[24px] bg-card ring-[0.5px] ring-border has-focus-visible:ring-2 has-focus-visible:ring-ring"
      >
        <div
          ref={box}
          aria-hidden="true"
          className="pointer-events-none relative w-full overflow-hidden"
          style={{ height: shown }}
        >
          {live && viewer.document !== null ? (
            // Never taller than the card shows: the reported height is the content's, not the frame's.
            <div inert className="absolute inset-x-0 top-0" style={{ height: shown }}>
              <PageFrame document={viewer.document} title={block.title} onHeight={onHeight} />
            </div>
          ) : null}
          {drawn ? null : (
            <div
              className={`absolute inset-0 flex flex-col justify-end gap-2 p-5 ${viewer.failed ? "" : "motion-safe:animate-pulse"}`}
            >
              <p className="line-clamp-4 text-body text-muted-foreground">{block.text}</p>
            </div>
          )}
          {clipped ? (
            <div className="absolute inset-x-0 bottom-0 h-[80px] bg-linear-to-b from-transparent to-card" />
          ) : null}
        </div>
        <span id={summaryId} hidden>
          {block.text}
        </span>
        <button
          type="button"
          aria-label={t`Open ${block.title}`}
          aria-describedby={summaryId}
          onClick={() => setOpen(true)}
          className="absolute inset-0 rounded-[24px] outline-none"
        />
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[min(88vh,900px)] w-[min(960px,94vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        >
          <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-5">
            <DialogTitle className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
              {block.title}
            </DialogTitle>
            <DialogClose
              aria-label={t`Close preview`}
              render={
                <Button
                  variant="ghost"
                  size="icon-lg"
                  className="rounded-full text-muted-foreground"
                />
              }
            >
              <X />
            </DialogClose>
          </header>
          <div className="min-h-0 flex-1">
            {opened.document !== null ? (
              <PageFrame document={opened.document} title={block.title} interactive />
            ) : (
              <p className="p-5 text-body text-muted-foreground">{block.text}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
