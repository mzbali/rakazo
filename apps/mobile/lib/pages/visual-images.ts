import { storedVisualImageMimeType } from "@rakazo/contracts";
import { rpc } from "../api/api";

/** Read the picture through the authorized artifact RPC for this view. */
export async function visualImageSrc(artifactId: string): Promise<string | null> {
  try {
    const artifact = await rpc("artifacts/getById", { artifactId });
    const mimeType = storedVisualImageMimeType(artifact.mimeType);
    return mimeType ? `data:${mimeType};base64,${artifact.contentBase64}` : null;
  } catch {
    return null;
  }
}
