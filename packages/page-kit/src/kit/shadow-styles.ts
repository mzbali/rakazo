import { PAGE_STYLES } from "./styles.js";

/**
 * The page stylesheet for a Shadow DOM root on a host page: the same parts as `PAGE_STYLES`,
 * aimed at the shadow host instead of the document. The theme attribute sits on the host, rules
 * for `html` and `body` are gone, and width queries ask the host's own width rather than the
 * window's, so a visual in a narrow column lays out as a narrow column. Print and reduced-motion
 * stay media queries.
 */
export function retargetForShadowRoot(css: string): string {
  return css
    .replace(/^(?:html(?:,body)?|body)\{[^}]*\}$/gm, "")
    .replace(/^\[data-inline\] #root\{[^}]*\}$/gm, "")
    .replaceAll(":root,[data-theme]", ":host")
    .replaceAll(":root", ":host")
    .replace(/\[data-theme="(light|dark)"\]/g, ':host([data-theme="$1"])')
    .replace(/@media \((min|max)-width:/g, "@container ($1-width:");
}

const HOST_CSS = `
:host{display:block;container-type:inline-size;min-width:0;color:var(--foreground);font-family:var(--rk-font);font-size:1rem;line-height:1.5;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
`;

export const SHADOW_STYLES = HOST_CSS + retargetForShadowRoot(PAGE_STYLES);
