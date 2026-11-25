import type { MouseEvent } from "react";
import { createContext, useCallback, useContext } from "react";

/** What a page asks of whatever shows it: the frame cannot open windows or copy by itself. */
export type HostBridge = {
  openLink: (url: string) => void;
  copy: (text: string) => Promise<boolean>;
  /** The bytes of a picture the message carries, as a data URI, or null when it has none. */
  image: (id: string) => Promise<string | null>;
};

const OPEN_LINK_MESSAGE = "rakazo-page:open-link";
const COPY_MESSAGE = "rakazo-page:copy";
const COPIED_MESSAGE = "rakazo-page:copied";
const IMAGE_MESSAGE = "rakazo-page:image";
const IMAGE_DATA_MESSAGE = "rakazo-page:image-data";
/** A host that never answers leaves the picture blank, never the page broken. */
const IMAGE_WAIT_MS = 10_000;
/** Resolved pictures, so one id asked twice loads once; a page is one visual, so the list stays short. */
const RESOLVED_IMAGE_MAX = 16;
const resolvedImages = new Map<string, Promise<string | null>>();
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

/** Only an embedded picture ever draws, so anything else answers like no picture at all. */
const IMAGE_DATA_URI = /^data:image\/[a-z0-9.+-]+;base64,/;

/** The bytes for a picture id, asked of the host; the frame never holds a URL to load. */
function imageViaFrame(id: string): Promise<string | null> {
  const cached = resolvedImages.get(id);
  if (cached) return cached;
  const resolved = new Promise<string | null>((resolve) => {
    function answer(event: MessageEvent) {
      const data = event.data as { type?: unknown; id?: unknown; src?: unknown } | null;
      if (data?.type === IMAGE_DATA_MESSAGE && data.id === id) finish(data.src);
    }
    function finish(src: unknown) {
      window.removeEventListener("message", answer);
      clearTimeout(timer);
      resolve(typeof src === "string" && IMAGE_DATA_URI.test(src) ? src : null);
    }
    const timer = setTimeout(() => finish(null), IMAGE_WAIT_MS);
    window.addEventListener("message", answer);
    window.parent?.postMessage({ type: IMAGE_MESSAGE, id }, "*");
  });
  resolvedImages.set(id, resolved);
  if (resolvedImages.size > RESOLVED_IMAGE_MAX) {
    resolvedImages.delete(resolvedImages.keys().next().value!);
  }
  return resolved;
}

export const FRAME_BRIDGE: HostBridge = {
  openLink: (url) => window.parent?.postMessage({ type: OPEN_LINK_MESSAGE, url }, "*"),
  copy: copyViaFrame,
  image: imageViaFrame,
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
