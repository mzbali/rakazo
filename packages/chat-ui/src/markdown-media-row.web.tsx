import type { ReactNode } from "react";
import { Children, createContext } from "react";
import type { MediaPiece } from "./media-row";
import { openingMediaImage } from "./media-row";

export type HastLike = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: { src?: unknown; alt?: unknown };
  children?: HastLike[];
};

/** Inlines of a block. A list item also walks its paragraphs, which wrap those inlines. */
export function hastPieces(node: HastLike | undefined, descendParagraphs: boolean): MediaPiece[] {
  const pieces: MediaPiece[] = [];
  for (const child of node?.children ?? []) {
    if (child.type === "text") {
      pieces.push({ type: "text", value: child.value ?? "" });
      continue;
    }
    if (child.tagName === "img") {
      pieces.push({
        type: "image",
        src: typeof child.properties?.src === "string" ? child.properties.src : "",
        alt: typeof child.properties?.alt === "string" ? child.properties.alt : "",
      });
      continue;
    }
    if (descendParagraphs && child.tagName === "p") {
      pieces.push(...hastPieces(child, false));
      continue;
    }
    if (child.tagName || child.type === "element") pieces.push({ type: "other" });
  }
  return pieces;
}

/** Everything after the opening image, aligned with the elements react-markdown already made. */
export function restAfterOpeningImage(
  node: HastLike | undefined,
  children: ReactNode,
): ReactNode[] {
  const list = Children.toArray(children);
  let reactIndex = 0;
  for (const child of node?.children ?? []) {
    const whitespace = child.type === "text" && (child.value ?? "").trim() === "";
    if (whitespace) {
      const item = list[reactIndex];
      if (typeof item === "string" && item.trim() === "") reactIndex += 1;
      continue;
    }
    if (child.tagName === "img") return list.slice(reactIndex + 1);
    reactIndex += 1;
  }
  return list;
}

// Set by a list item that is a media row, so its paragraphs keep their text and drop the thumb.
export const MediaRowHostContext = createContext(false);

export function MediaRow({ thumb, children }: { thumb: ReactNode; children: ReactNode }) {
  return (
    <div className="rk-chat-media-row">
      <div className="rk-chat-media-thumb">{thumb}</div>
      <div className="rk-chat-media-copy">{children}</div>
    </div>
  );
}

export function mediaListClass(node: HastLike | undefined): string | undefined {
  const items = (node?.children ?? []).filter((child) => child.tagName === "li");
  if (items.length === 0 || !items.every((item) => openingMediaImage(hastPieces(item, true)))) {
    return undefined;
  }
  return "rk-chat-media-list";
}
