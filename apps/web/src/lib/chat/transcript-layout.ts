export const TRANSCRIPT_CONTENT_PADDING = "px-4 md:px-[max(1.75rem,calc((100%_-_60rem)/2))]";

/**
 * Bot answers fill the transcript column up to this reading measure (48rem), so a wide
 * window keeps a readable line and a phone fills the column. Cards in an answer share it.
 * A pointer reveals the action rail beside the answer, so that room is kept free; touch
 * shows the rail below instead.
 */
export const BOT_PROSE_FRAME =
  "w-full max-w-[min(calc(100%_-_6rem),48rem)] [@media(hover:none)]:max-w-3xl";
