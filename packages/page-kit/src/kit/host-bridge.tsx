import type { MouseEvent } from "react";
import { createContext, useCallback, useContext } from "react";

/** What a page asks of whatever shows it: the frame cannot open windows or copy by itself. */
export type HostBridge = {
  openLink: (url: string) => void;
  copy: (text: string) => Promise<boolean>;
};

const OPEN_LINK_MESSAGE = "rakazo-page:open-link";
const COPY_MESSAGE = "rakazo-page:copy";
const COPIED_MESSAGE = "rakazo-page:copied";
let copies = 0;

/** The page runs in a sandboxed frame, so the app opens and copies when the frame asks. */
function copyViaFrame(text: string): Promise<boolean> {
  copies += 1;
  const id = `copy-${copies}`;
  return new Promise((resolve) => {
    function answer(event: MessageEvent) {
      const data = event.data as { type?: unknown; id?: unknown; ok?: unknown } | null;
      if (data?.type === COPIED_MESSAGE && data.id === id) finish(data.ok === true);
    }
    function finish(ok: boolean) {
      window.removeEventListener("message", answer);
      clearTimeout(timer);
      resolve(ok);
    }
    // A host that cannot copy for pages never answers.
    const timer = setTimeout(() => finish(false), 2000);
    window.addEventListener("message", answer);
    window.parent?.postMessage({ type: COPY_MESSAGE, id, text }, "*");
  });
}

export const FRAME_BRIDGE: HostBridge = {
  openLink: (url) => window.parent?.postMessage({ type: OPEN_LINK_MESSAGE, url }, "*"),
  copy: copyViaFrame,
};

/** The frame's bridge unless a host that draws the kit itself provides its own. */
export const HostBridgeContext = createContext<HostBridge>(FRAME_BRIDGE);

export function useHostBridge(): HostBridge {
  return useContext(HostBridgeContext);
}

/** A link's click handler: the host opens the address, the browser never follows it. */
export function useOpenViaHost() {
  const { openLink } = useHostBridge();
  return useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      openLink(event.currentTarget.href);
    },
    [openLink],
  );
}
