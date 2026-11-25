import { VISUAL_IMAGE_STORED_MAX_BYTES } from "@rakazo/contracts";
import { detectImageMimeType } from "../media/image-mime-type.js";
import type { ResolveHostname } from "../network/network-address.js";
import { fetchSafeWebBytes } from "./web-ssrf.js";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const ALLOWED_PORTS = [80, 443] as const;
const INPUT_MAX_BYTES = 5 * 1024 * 1024;
/**
 * Larger declared images are refused before their pixels are decoded, as favicons are. Four
 * megapixels covers the photos stores serve while bounding what one decode holds in memory.
 */
const MAX_INPUT_PIXELS = 4 * 1024 * 1024;
/** The longest edge a kept picture has; the chat draws it at message width. */
const OUTPUT_MAX_EDGE = 800;
const OUTPUT_QUALITY = 82;

export type ResolvedVisualImage = { bytes: Uint8Array };

export type VisualImageOptions = {
  fetch?: typeof globalThis.fetch;
  resolveHostname?: ResolveHostname;
  signal?: AbortSignal;
  allowUrl?: (url: string) => boolean;
  /** Test seam for the re-encode; defaults to `encodeVisualImage`. */
  decode?: (bytes: Uint8Array) => Promise<ResolvedVisualImage | null>;
};

/**
 * One picture for a chat visual, fetched server-side through the SSRF-checked fetch: public
 * hosts only, ports 80 and 443, bounded redirects and bytes. Only a raster image that sniffs as
 * one is kept, downscaled and re-encoded, so nothing a site serves reaches the viewer as-is.
 */
export async function fetchVisualImage(
  url: string,
  options: VisualImageOptions = {},
): Promise<ResolvedVisualImage> {
  const fetched = await fetchSafeWebBytes(url, {
    fetch: options.fetch,
    resolveHostname: options.resolveHostname,
    signal: options.signal,
    timeoutMs: FETCH_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    allowedPorts: ALLOWED_PORTS,
    allowUrl: options.allowUrl,
    maxBytes: INPUT_MAX_BYTES,
    headers: { accept: "image/png,image/jpeg,image/webp,image/gif,image/*;q=0.8,*/*;q=0.5" },
  });
  const resolved = await (options.decode ?? encodeVisualImage)(fetched.body);
  if (!resolved) throw new Error("the picture is not a usable raster image");
  return resolved;
}

/**
 * Fetched bytes as a small WebP the viewer can draw: the bytes decide the format, whatever type
 * the server declared, and only a raster image that sniffs as one is decoded. SVG and HTML are
 * refused, an animated GIF keeps its first frame, and EXIF orientation is applied.
 */
export async function encodeVisualImage(bytes: Uint8Array): Promise<ResolvedVisualImage | null> {
  if (!detectImageMimeType(bytes)) return null;
  // sharp is a native addon; load it only when an image is processed.
  const { default: sharp } = await import("sharp");
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false });
    const { width = 0, height = 0 } = await image.metadata();
    if (width <= 1 || height <= 1) return null;
    const { data } = await image
      .rotate()
      .resize(OUTPUT_MAX_EDGE, OUTPUT_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: OUTPUT_QUALITY })
      .toBuffer({ resolveWithObject: true });
    if (data.byteLength === 0 || data.byteLength > VISUAL_IMAGE_STORED_MAX_BYTES) return null;
    return { bytes: data };
  } catch {
    // Truncated, corrupt or over the pixel limit.
    return null;
  }
}
