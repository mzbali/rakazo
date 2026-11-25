import { VISUAL_IMAGE_MIME_TYPE } from "@rakazo/contracts";
import { expect, it, vi } from "vitest";
import { rpc } from "../api/api";
import { ARTIFACT_DOWNLOAD_TIMEOUT_MS } from "../artifacts/artifacts";
import { visualImageSrc } from "./visual-images";

vi.mock("../api/api", () => ({ rpc: vi.fn() }));

it("uses the artifact download deadline and only renders visual-image bytes", async () => {
  const read = vi.mocked(rpc);
  read.mockResolvedValueOnce({ mimeType: VISUAL_IMAGE_MIME_TYPE, contentBase64: "AQID" } as never);
  read.mockResolvedValueOnce({ mimeType: "image/webp", contentBase64: "AQID" } as never);
  read.mockRejectedValueOnce(new Error("Unavailable"));
  await expect(visualImageSrc("photo-1")).resolves.toBe("data:image/webp;base64,AQID");
  expect(read).toHaveBeenCalledWith(
    "artifacts/getById",
    { artifactId: "photo-1" },
    {
      timeoutMs: ARTIFACT_DOWNLOAD_TIMEOUT_MS,
    },
  );
  await expect(visualImageSrc("photo-2")).resolves.toBeNull();
  await expect(visualImageSrc("photo-3")).resolves.toBeNull();
});
