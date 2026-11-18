import type { HostBridge } from "@rakazo/page-kit/kit-host";
import type { MouseEvent, ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import "./visual.web.css";

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

const readTheme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

/** The app's theme, kept on the host so the shadow stylesheet's theme selectors follow it. */
function useDocumentTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribeTheme, readTheme, () => "dark");
}

/** Below this width a wide figure lays out as a narrow one. */
const NARROW_WIDTH = 480;

const NarrowContext = createContext(false);

/** Whether the column the visual sits in is narrow, as on a phone. */
export const useNarrowColumn = () => useContext(NarrowContext);

let sheet: CSSStyleSheet | undefined;

/** One parsed stylesheet shared by every visual on the page, where the browser supports it. */
function adoptStyles(root: ShadowRoot, css: string) {
  if (typeof CSSStyleSheet === "undefined" || !("adoptedStyleSheets" in root)) return false;
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  }
  root.adoptedStyleSheets = [sheet];
  return true;
}

/**
 * Draws its children in an open shadow root on the chat's own background, with the page kit's
 * stylesheet and no frame. Links never leave on their own: a click goes through the bridge, and
 * a middle click or the context menu on a link is held so no address skips the app's prompt.
 */
export function VisualShadow({
  styles,
  bridge,
  label,
  children,
}: {
  styles: string;
  bridge: HostBridge;
  label: string;
  children: ReactNode;
}) {
  const theme = useDocumentTheme();
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  const [adopted, setAdopted] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const attach = useCallback((node: HTMLDivElement | null) => {
    setRoot(node ? (node.shadowRoot ?? node.attachShadow({ mode: "open" })) : null);
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setNarrow((entry?.contentRect.width ?? NARROW_WIDTH) < NARROW_WIDTH),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (root) setAdopted(adoptStyles(root, styles));
  }, [root, styles]);

  const hold = (event: MouseEvent) => {
    const anchor = event.nativeEvent
      .composedPath()
      .find((target): target is HTMLAnchorElement => target instanceof HTMLAnchorElement);
    if (!anchor) return;
    event.preventDefault();
    if (event.type === "auxclick" && event.button === 1) bridge.openLink(anchor.href);
  };

  return (
    // A figure cannot hold a shadow root, so the group role names the visual instead.
    // biome-ignore lint/a11y/useSemanticElements: see above
    // biome-ignore lint/a11y/noStaticElementInteractions: a middle click or menu on a link is held here
    <div
      role="group"
      ref={attach}
      className="rkv-host"
      data-theme={theme}
      data-testid="chat-visual"
      aria-label={label}
      onAuxClick={hold}
      onContextMenu={hold}
    >
      {root
        ? createPortal(
            <NarrowContext.Provider value={narrow}>
              <div data-inline="card">
                {adopted ? null : <style>{styles}</style>}
                {children}
              </div>
            </NarrowContext.Provider>,
            root,
          )
        : null}
    </div>
  );
}
