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
@media (prefers-reduced-motion:no-preference){.rkv-pending{animation:rkv-pulse 1.4s ease-in-out infinite}}
@keyframes rkv-pulse{50%{opacity:.45}}
`;

export const visualStyles = (): string => SHADOW_STYLES + VISUAL_CSS;
