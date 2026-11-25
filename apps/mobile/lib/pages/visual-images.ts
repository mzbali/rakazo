import { storedVisualImageMimeType } from "@rakazo/contracts";
import { getArtifactById } from "../artifacts/artifacts";

/** Read the picture through the authorized artifact RPC for this view. */
export async function visualImageSrc(artifactId: string): Promise<string | null> {
  try {
    const artifact = await getArtifactById(artifactId);
    const mimeType = storedVisualImageMimeType(artifact.mimeType);
    return mimeType ? `data:${mimeType};base64,${artifact.contentBase64}` : null;
  } catch {
    return null;
  }
}
