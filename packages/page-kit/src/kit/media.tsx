import { pageKitPalette } from "@rakazo/ui-tokens";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useHostBridge } from "./host-bridge.js";
import { useWords } from "./labels.js";

/** Prop text as one trimmed string; the products module and captions read it too. */
export const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() : "";

/** The viewer loads nothing from the network: a picture is embedded, or an id the host resolves. */
export function imageSource(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(value)) return value;
  return /^rakazo-image:[a-z0-9-]+$/i.test(value) ? value : undefined;
}

/** The id in a rakazo-image: reference, which the host swaps for the stored bytes. */
function imageRefId(source: string): string | undefined {
  return source.startsWith("rakazo-image:") ? source.slice("rakazo-image:".length) : undefined;
}

/**
 * The src a picture can draw: a data URI at once, or a host-resolved id once its bytes arrive.
 * An id that resolves to nothing stays blank, like a picture that never loads.
 */
function useImageSource(source: string): string | undefined {
  const { image } = useHostBridge();
  const [src, setSrc] = useState<string | undefined>(() =>
    imageRefId(source) ? undefined : imageSource(source) ? source : undefined,
  );
  useEffect(() => {
    const id = imageRefId(source);
    if (!id) {
      setSrc(imageSource(source) ? source : undefined);
      return;
    }
    setSrc(undefined);
    let active = true;
    void image(id).then((resolved) => {
      if (active) setSrc(resolved ?? undefined);
    });
    return () => {
      active = false;
    };
  }, [source, image]);
  return src;
}

/** Sound and video may also be a blob the page made itself. */
function mediaSource(value: unknown, kind: "audio" | "video"): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.startsWith("blob:")) return value;
  return new RegExp(`^data:${kind}/[a-z0-9.+-]+[;,]`, "i").test(value) ? value : undefined;
}

/** 1.5, "16/9" or "4:3" as width over height; anything else leaves the picture's own shape. */
export function aspectRatio(value: unknown): number | undefined {
  if (typeof value === "number") return value > 0 && Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*[/:]\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return aspectRatio(Number(value) || undefined);
  const ratio = Number(match[1]) / Number(match[2]);
  return ratio > 0 && Number.isFinite(ratio) ? ratio : undefined;
}

const px = (value: unknown) =>
  typeof value === "number" && value > 0 && Number.isFinite(value) ? value : undefined;

export { px };

/** A soft fill shows until the picture has drawn, then it fades in; it never waits forever. */
export function Picture({
  source,
  alt,
  fit,
  style,
}: {
  source: string;
  alt: string;
  fit?: "contain" | "cover";
  style?: CSSProperties;
}) {
  const src = useImageSource(source);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 8000);
    return () => clearTimeout(timer);
  }, [src]);
  return (
    <div className="rk-picture" data-loading={!loaded || undefined} style={style}>
      {src ? (
        <img
          src={src}
          alt={alt}
          decoding="async"
          data-fit={fit === "contain" ? "contain" : undefined}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
      ) : null}
    </div>
  );
}

function boxStyle(input: { width?: unknown; height?: unknown; ratio?: unknown }) {
  const width = px(input.width);
  const height = px(input.height);
  const ratio = aspectRatio(input.ratio);
  const style: CSSProperties = {};
  if (width) style.maxWidth = width;
  if (height) style.height = height;
  else if (ratio) style.aspectRatio = String(ratio);
  return style;
}

function Caption({ children }: { children?: ReactNode }) {
  return children ? <figcaption className="rk-figcaption">{children}</figcaption> : null;
}

export function Image({
  src,
  alt,
  caption,
  fit = "cover",
  width,
  height,
  ratio,
}: {
  src?: string;
  alt?: string;
  caption?: string;
  fit?: "contain" | "cover";
  width?: number;
  height?: number;
  ratio?: number | string;
}) {
  const words = useWords();
  const source = imageSource(src);
  const [zoomed, setZoomed] = useState(false);
  if (!source) return null;
  const style = boxStyle({ width, height, ratio });
  const name = text(alt);
  return (
    <figure className="rk-figure" style={{ maxWidth: style.maxWidth }}>
      <button
        type="button"
        className="rk-zoom"
        aria-label={name ? words.t("enlarge", { name }) : words.t("enlargeImage")}
        onClick={() => setZoomed(true)}
      >
        <Picture
          source={source}
          alt={name}
          fit={fit}
          style={{ height: style.height, aspectRatio: style.aspectRatio }}
        />
      </button>
      <Caption>{text(caption)}</Caption>
      {zoomed ? <Lightbox source={source} alt={name} onClose={() => setZoomed(false)} /> : null}
    </figure>
  );
}

/** The picture at full size over the page; a click, Escape or the close button dismisses it. */
function Lightbox({ source, alt, onClose }: { source: string; alt: string; onClose: () => void }) {
  const src = useImageSource(source);
  const words = useWords();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        if (event.key === "Escape") onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape and the close button cover the keyboard.
    <div
      className="rk-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt || words.t("image")}
      onClick={onClose}
    >
      {src ? <img src={src} alt={alt} /> : <div className="rk-picture" />}
      <button
        ref={close}
        type="button"
        className="rk-lightbox-close"
        aria-label={words.t("close")}
        onClick={onClose}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}

export function Video({
  src,
  alt,
  poster,
  caption,
  autoplay = true,
  loop,
  controls = true,
  fit = "contain",
  width,
  height,
  ratio,
}: {
  src?: string;
  alt?: string;
  poster?: string;
  caption?: string;
  autoplay?: boolean;
  loop?: boolean;
  controls?: boolean;
  fit?: "contain" | "cover";
  width?: number;
  height?: number;
  ratio?: number | string;
}) {
  const source = mediaSource(src, "video");
  const still = imageSource(poster);
  // A poster may be a host-resolved id, so the frame draws it the same way it draws a picture.
  const posterSrc = useImageSource(still ?? "");
  const [failed, setFailed] = useState<string | undefined>(undefined);
  if (!source && !still) return null;
  const style = boxStyle({ width, height, ratio: ratio ?? (height ? undefined : 16 / 9) });
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const play = autoplay !== false && !reduced;
  return (
    <figure className="rk-figure" style={{ maxWidth: style.maxWidth }}>
      {source && failed !== source ? (
        <div
          className="rk-picture"
          style={{ height: style.height, aspectRatio: style.aspectRatio }}
        >
          <video
            src={source}
            poster={posterSrc}
            aria-label={text(alt) || undefined}
            autoPlay={play}
            muted={play}
            loop={loop ?? autoplay !== false}
            controls={controls !== false}
            playsInline
            preload="metadata"
            data-fit={fit === "cover" ? "cover" : undefined}
            onError={() => setFailed(source)}
          />
        </div>
      ) : (
        <div
          className="rk-picture"
          role="img"
          aria-label={text(alt) || undefined}
          style={{ height: style.height, aspectRatio: style.aspectRatio }}
        >
          {posterSrc ? <img src={posterSrc} alt="" aria-hidden="true" /> : null}
        </div>
      )}
      <Caption>{text(caption)}</Caption>
    </figure>
  );
}

export function Audio({
  src,
  alt,
  caption,
  loop = false,
  width,
}: {
  src?: string;
  alt?: string;
  caption?: string;
  loop?: boolean;
  width?: number;
}) {
  const source = mediaSource(src, "audio");
  if (!source) return null;
  return (
    <figure className="rk-figure" style={{ maxWidth: px(width) }}>
      {/* biome-ignore lint/a11y/useMediaCaption: a page's sound clip has no caption track to offer. */}
      <audio
        className="rk-audio"
        src={source}
        aria-label={text(alt) || undefined}
        controls
        loop={loop === true}
        preload="metadata"
      />
      <Caption>{text(caption)}</Caption>
    </figure>
  );
}

type Photo = { src?: string; alt?: string };

const GALLERY_MAX = 8;

export function Gallery({
  photos,
  height = 360,
  radius = 22,
}: {
  photos?: Photo[];
  height?: number;
  radius?: number;
}) {
  const words = useWords();
  const items = (Array.isArray(photos) ? photos : [])
    .flatMap((photo) => {
      const src = imageSource(photo?.src);
      return src ? [{ src, alt: text(photo.alt) }] : [];
    })
    .slice(0, GALLERY_MAX);
  const track = useRef<HTMLDivElement>(null);
  const [chosen, setCurrent] = useState(0);
  if (items.length === 0) return null;
  // Fewer photos on a later render keep the last one marked rather than none.
  const current = Math.min(chosen, items.length - 1);
  // A right-to-left track starts at zero and scrolls to negative offsets towards later photos.
  const side = (node: HTMLElement) => (getComputedStyle(node).direction === "rtl" ? -1 : 1);
  const show = (index: number) => {
    const node = track.current;
    if (!node) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    node.scrollTo({
      left: side(node) * index * node.clientWidth,
      behavior: reduced ? "auto" : "smooth",
    });
    setCurrent(index);
  };
  return (
    <section
      className="rk-gallery"
      aria-roledescription="carousel"
      aria-label={words.t("photos", { count: items.length })}
      style={{ height: px(height) ?? 360, borderRadius: px(radius) ?? 22 }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the scroller takes arrow keys to move between photos. */}
      <div
        className="rk-gallery-track"
        ref={track}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys move between the photos.
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            const step = (event.key === "ArrowRight" ? 1 : -1) * side(event.currentTarget);
            show(Math.min(items.length - 1, Math.max(0, current + step)));
          }
        }}
        onScroll={(event) => {
          const node = event.currentTarget;
          if (node.clientWidth > 0) {
            const index = Math.round((side(node) * node.scrollLeft) / node.clientWidth);
            setCurrent(Math.min(items.length - 1, Math.max(0, index)));
          }
        }}
      >
        {items.map((photo, index) => (
          <figure
            className="rk-gallery-slide"
            key={index}
            aria-roledescription="slide"
            aria-label={words.t("slideOf", { n: index + 1, total: items.length })}
          >
            <Picture source={photo.src} alt={photo.alt} />
          </figure>
        ))}
      </div>
      {items.length > 1 ? (
        <div className="rk-gallery-dots">
          {items.map((_, index) => (
            <button
              key={index}
              type="button"
              aria-label={words.t("showPhoto", { n: index + 1 })}
              aria-current={index === current || undefined}
              onClick={() => show(index)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export const MEDIA_CSS = `
.rk-figure{display:flex;flex-direction:column;gap:8px;min-width:0;margin:0;container-type:inline-size}
.rk-picture{position:relative;overflow:hidden;border-radius:16px;transition:background-color .3s}
@container (min-width:560px){.rk-figure>.rk-picture{border-radius:8px}}
.rk-picture[data-loading]{background:var(--rk-control)}
.rk-picture img,.rk-picture video{display:block;width:100%;height:100%;object-fit:cover;transition:opacity .3s}
.rk-picture[data-loading] img{opacity:0}
.rk-picture img[data-fit="contain"],.rk-picture video{object-fit:contain}
.rk-picture video[data-fit="cover"]{object-fit:cover}
.rk-picture[role="img"]{background:var(--rk-control)}
.rk-zoom>.rk-picture:not([style*="height"]):not([style*="aspect-ratio"]) img{height:auto}
.rk-zoom{display:block;width:100%;margin:0;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:inherit;cursor:zoom-in;border-radius:16px}
@container (min-width:560px){.rk-zoom{border-radius:8px}.rk-zoom>.rk-picture{border-radius:8px}}
.rk-zoom:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.rk-lightbox{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:24px;background:color-mix(in srgb,var(--background) 92%,transparent);cursor:zoom-out;animation:rk-fade .18s ease-out}
.rk-lightbox img{max-width:100%;max-height:100%;border-radius:12px;object-fit:contain}
.rk-lightbox-close{position:absolute;top:12px;right:12px;display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;border-radius:9999px;background:var(--rk-control);color:var(--foreground);cursor:pointer}
.rk-lightbox-close svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round}
.rk-lightbox-close:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
@keyframes rk-fade{from{opacity:0}}
.rk-gallery-track:focus-visible{outline:2px solid var(--ring);outline-offset:-2px}
.rk-figcaption{font-size:14px;line-height:20px;color:var(--rk-secondary)}
.rk-audio{display:block;width:100%;height:54px;border-radius:9999px}
.rk-gallery{position:relative;overflow:hidden;min-width:0}
.rk-gallery-track{display:flex;height:100%;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain}
.rk-gallery-track::-webkit-scrollbar{display:none}
.rk-gallery-slide{margin:0;flex:none;width:100%;height:100%;scroll-snap-align:start}
.rk-gallery-slide .rk-picture{height:100%;border-radius:0}
.rk-gallery-dots{position:absolute;left:0;right:0;bottom:3px;display:flex;justify-content:center}
.rk-gallery-dots button{appearance:none;display:grid;place-items:center;width:24px;height:24px;margin:0 -6px;padding:0;border:0;background:none;cursor:pointer}
.rk-gallery-dots button::before{content:"";width:6px;height:6px;border-radius:6px;background:${pageKitPalette.shared.onDeepTone};opacity:.5;box-shadow:0 1px 3px ${pageKitPalette.shared.dotShadow};transition:opacity .14s,width .2s}
.rk-gallery-dots button[aria-current="true"]::before{width:14px;opacity:1}
.rk-gallery-dots button:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.rk-lightbox{animation:none}.rk-picture,.rk-picture img,.rk-gallery-dots button::before{transition:none}.rk-gallery-track{scroll-behavior:auto}}
@media print{.rk-figure{break-inside:avoid}.rk-gallery-dots{display:none}}
`;
