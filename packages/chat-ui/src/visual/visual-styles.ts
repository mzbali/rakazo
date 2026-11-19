import { SHADOW_STYLES } from "@rakazo/page-kit/kit-host";

/** What the fence draws itself, inside the shadow root next to the kit's own rules. */
const VISUAL_CSS = `
.rkv-root{display:flex;flex-direction:column;gap:1rem;min-width:0}
.rkv-root>*{min-width:0}
.rkv-note{margin:0;font-size:.875rem;line-height:1.25rem;color:var(--rk-secondary)}
.rkv-pending{height:1.5rem;border-radius:6px;background:var(--rk-fill)}
.rkv-formula-block{padding:.25rem 0;overflow-x:auto;overflow-y:hidden;text-align:center}
.rkv-formula-display{display:block}
.rkv-formula-display .katex-display{margin:0}
.rkv-formula-source{font:.9375rem/1.5rem ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--rk-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
.rk-frame{padding:0;border:0;border-radius:0}
.rkv-copy{display:flex;flex-direction:column;gap:.5rem;align-items:flex-start}
.rkv-copy-text{box-sizing:border-box;width:100%;margin:0;padding:.625rem .75rem;border-radius:8px;background:var(--rk-fill);font:.875rem/1.35rem ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}
@media (prefers-reduced-motion:no-preference){.rkv-pending{animation:rkv-pulse 1.4s ease-in-out infinite}}
@keyframes rkv-pulse{50%{opacity:.45}}
`;

export const visualStyles = (): string => SHADOW_STYLES + VISUAL_CSS;
