import { BACKGROUND_HELPER_TRIGGER } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import type { ExecutorDeps } from "../../runs/executor/executor-deps.js";
import { loadRunImages } from "./cloud-agent-review-images.js";

const context = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space",
  userId: "user",
  botId: "bot",
  runId: "run",
  signal: new AbortController().signal,
};
const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function deps() {
  return {
    prisma: {
      cloudAgent: {
        findFirst: async ({ where }: { where: { jobThreadId: string } }) =>
          where.jobThreadId === "job-thread"
            ? {
                proofImages: [
                  { source: "s", artifactId: "a1", name: "home.png", mimeType: "image/png" },
                ],
              }
            : null,
      },
      artifact: { findFirst: async () => ({ storageKey: "key-1" }) },
    },
    artifacts: { get: async () => bytes },
  } as unknown as ExecutorDeps;
}

describe("the images a job's review looks at", () => {
  it("receives the screenshots kept on the job", async () => {
    const images = await loadRunImages(
      deps(),
      { trigger: BACKGROUND_HELPER_TRIGGER, threadId: "job-thread", spaceId: "space" },
      undefined,
      context,
    );
    expect(images).toEqual([{ name: "home.png", mimeType: "image/png", data: bytes }]);
  });

  it("adds nothing to an ordinary run", async () => {
    const images = await loadRunImages(
      deps(),
      { trigger: "message", threadId: "job-thread", spaceId: "space" },
      undefined,
      context,
    );
    expect(images).toBeUndefined();
  });
});
