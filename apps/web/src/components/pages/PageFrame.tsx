import { useExternalLinkOpener } from "@rakazo/chat-ui/web";
import type { PageSectionAnchor } from "@rakazo/contracts";
import {
  pageCopyRequest,
  pageCopyResult,
  pageImageRequest,
  pageImageResult,
  pageLinkRequest,
  pageReviewSections,
} from "@rakazo/core";
import type { CSSProperties } from "react";
import { useCallback, useRef, useState } from "react";
import { writeClipboard } from "../../lib/copy-text";
import { pageFrameHeight } from "../../lib/pages/page-cards";
import { visualImageSrc } from "../../lib/pages/visual-images";
import { SandboxedHtmlViewer } from "../messages/SandboxedHtmlViewer";

/**
 * A page document in the sandboxed viewer. Only an `interactive` frame acts for its page (copy,
 * open a link, offer a reply), and only right after the person used that frame: the viewer
 * shell vouches for a click or key inside it, the frame still has focus, and that click or key
 * has not been used for another action yet. Previews draw only.
 * An interactive frame prints whole: on paper it keeps the width the page was drawn at, so the
 * page's last reported height still fits it, and the browser scales it to the paper.
 */
export function PageFrame({
  document,
  title,
  interactive = false,
  onHeight,
  onReply,
  portalContainer,
  onSections,
  images,
}: {
  portalContainer?: HTMLElement | null;
  document: string;
  title: string;
  interactive?: boolean;
  onHeight?: (height: number) => void;
  /** Where a page's reply button puts its text; without it the page offers no replies. */
  onReply?: (text: unknown) => void;
  onSections?: (sections: PageSectionAnchor[]) => void;
  /**
   * The pictures this frame's own message carries. A frame may ask for these ids and nothing
   * else, and the answer is a data URI, so the sandbox never loads from the network.
   */
  images?: ReadonlyArray<{ id: string }>;
}) {
  const { open, dialog } = useExternalLinkOpener(portalContainer);
  const box = useRef<HTMLDivElement>(null);
  const [drawnAt, setDrawnAt] = useState<CSSProperties | undefined>(undefined);
  const usedGesture = useRef<string | null>(null);
  const receive = useCallback(
    (data: unknown, answer: (message: object) => void, focused: boolean) => {
      if (!data || typeof data !== "object") return;
      const message = data as {
        type?: unknown;
        height?: unknown;
        text?: unknown;
        gesture?: unknown;
      };
      // A picture is a read of the message's own data, not an action: it needs no click or key.
      const image = images ? pageImageRequest(data, images) : null;
      if (image) {
        void visualImageSrc(image.id).then((src) => answer(pageImageResult(image.id, src)));
        return;
      }
      if (message.type === "rakazo-page:height" && typeof message.height === "number") {
        const height = pageFrameHeight(message.height);
        if (interactive && box.current) {
          setDrawnAt({
            "--page-width": `${box.current.offsetWidth}px`,
            "--page-height": `${height}px`,
          } as CSSProperties);
        }
        onHeight?.(height);
        return;
      }
      const sections = onSections && pageReviewSections(data);
      if (sections) onSections(sections);
      const { gesture } = message;
      if (!interactive || !focused || typeof gesture !== "string") return;
      if (gesture === usedGesture.current) return;
      const copy = pageCopyRequest(data);
      const url = copy ? null : pageLinkRequest(data);
      const reply = !copy && !url && message.type === "rakazo-page:reply" && onReply;
      if (!copy && !url && !reply) return;
      usedGesture.current = gesture;
      if (copy) void writeClipboard(copy.text).then((ok) => answer(pageCopyResult(copy.id, ok)));
      else if (url) open(url);
      else if (reply) reply(message.text);
    },
    [interactive, onHeight, onReply, onSections, open, images],
  );
  return (
    <>
      <div
        ref={box}
        style={drawnAt}
        className={`h-full ${interactive ? "print:mx-auto print:h-(--page-height) print:w-(--page-width)" : ""}`}
      >
        <SandboxedHtmlViewer
          html={document}
          title={title}
          className="bg-transparent"
          onFrameMessage={receive}
        />
      </div>
      {dialog}
    </>
  );
}
