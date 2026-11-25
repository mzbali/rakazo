import { markdownEmbed } from "./markdown";

/** Thumbnail edge on the web, in CSS pixels. */
export const MEDIA_ROW_WEB_PX = 96;

/** Thumbnail edge on iOS, in points. */
export const MEDIA_ROW_NATIVE_PT = 88;

/** One inline of a block, enough to decide whether it opens as a media row. */
export type MediaPiece =
  | { type: "text"; value: string }
  | { type: "image"; src: string; alt: string }
  | { type: "other" };

/**
 * The image a media row opens with. The first real content must be an `image:` embed, and
 * something must follow it: a title, a sentence, a price. An image alone, or a `visual:` embed,
 * stays an ordinary embed.
 */
export function openingMediaImage(
  pieces: readonly MediaPiece[],
): { src: string; alt: string } | undefined {
  let index = 0;
  while (index < pieces.length) {
    const piece = pieces[index];
    if (piece?.type !== "text" || piece.value.trim() !== "") break;
    index += 1;
  }
  const first = pieces[index];
  if (first?.type !== "image") return undefined;
  const embed = markdownEmbed(first.src);
  if (embed?.kind !== "image") return undefined;
  const hasMore = pieces
    .slice(index + 1)
    .some((piece) => piece.type !== "text" || piece.value.trim() !== "");
  if (!hasMore) return undefined;
  return { src: first.src, alt: first.alt };
}
