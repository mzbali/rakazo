import type { ColorTokens, ResolvedAppearance } from "@rakazo/ui-tokens";
import { pageKitPalette } from "@rakazo/ui-tokens";

/** Below this width a wide figure lays out as a narrow one. */
export const NARROW_WIDTH = 480;
const SUBTLE_ALPHA = { dark: "2c", light: "17" };

export type Surface = {
  palette: ColorTokens;
  colorScheme: ResolvedAppearance;
  narrow: boolean;
  width: number;
  unavailable: string;
};

export const tones = (surface: Surface) =>
  pageKitPalette[surface.colorScheme === "light" ? "light" : "dark"];

export function toneColor(surface: Surface, tone: string | undefined): string | undefined {
  const palette = tones(surface);
  if (tone === "info" || tone === "accent") return palette.accent;
  if (tone === "success") return palette.success;
  if (tone === "warning") return palette.warning;
  if (tone === "danger") return palette.danger;
  return undefined;
}

export const subtle = (color: string, surface: Surface) =>
  `${color.slice(0, 7)}${SUBTLE_ALPHA[surface.colorScheme === "light" ? "light" : "dark"]}`;
