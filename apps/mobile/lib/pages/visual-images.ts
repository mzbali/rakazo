import { storedVisualImageMimeType } from "@rakazo/contracts";
import { rpc } from "../api/api";

/** Resolved data URIs, so a picture the card draws again answers without another read. */
const MAX_CACHED_IMAGES = 32;
const resolved = new Map<string, Promise<string | null>>();

/**
 * The bytes of a picture a chat visual carries, read through the normal authorized artifact
 * RPC and answered to its WebView as a data URI: the sandboxed view still loads nothing itself.
 * A picture that cannot be read answers null, which the view draws as no picture.
 */
export function visualImageSrc(artifactId: string): Promise<string | null> {
  let pending = resolved.get(artifactId);
  if (!pending) {
    pending = rpc("artifacts/getById", { artifactId })
      .then((artifact) => {
        const mimeType = storedVisualImageMimeType(artifact.mimeType);
        return mimeType ? `data:${mimeType};base64,${artifact.contentBase64}` : null;
      })
      .catch(() => null);
    resolved.set(artifactId, pending);
    if (resolved.size > MAX_CACHED_IMAGES) resolved.delete(resolved.keys().next().value!);
  }
  return pending;
}
