import type { AdapterContext } from "@rakazo/adapter-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const publishMessage = vi.hoisted(() => vi.fn());
const attachWorkspaceFileToThread = vi.hoisted(() => vi.fn());

vi.mock("./runs/assembly/run-messages.js", () => ({ publishMessage }));
vi.mock("./storage/thread-artifacts.js", () => ({
  attachWorkspaceFileToThread,
  noteRunProducedFile: vi.fn(),
}));
vi.mock("./tools/plot-tool.js", () => ({
  assertPlotDataWithinLimits: () => undefined,
  parsePlotData: () => [],
  plotSvgToPng: async () => new Uint8Array([1]),
  renderPlotSpecToSvg: () => "<svg/>",
}));

const { renderPlotFromTool } = await import("./tools/workspace-file-tools.js");

const context: AdapterContext = {
  operationId: "op",
  traceId: "trace",
  signal: new AbortController().signal,
  spaceId: "space",
  userId: "user",
  botId: "bot",
};
const run = {
  id: "run-1",
  spaceId: "space",
  userId: "user",
  threadId: "thread",
  botId: "bot",
  trigger: "user",
};
const workspace = {
  botId: "bot",
  computerMode: "dedicated" as const,
  computer: async () => ({ id: "computer" }) as never,
  markDirty: () => undefined,
  context,
  runSecrets: [],
};
const deps = {
  sandbox: { writeFile: vi.fn(async () => undefined) },
  artifacts: { put: vi.fn() },
  prisma: {},
} as never;

describe("render_plot embed", () => {
  beforeEach(() => {
    publishMessage.mockReset();
    attachWorkspaceFileToThread.mockReset();
    publishMessage.mockResolvedValue({ id: "chart-message" });
  });

  it("returns no embed when the chart itself is posted", async () => {
    const result = await renderPlotFromTool(
      deps,
      run,
      { spec: { marks: [{ type: "barY" }] }, data: [{ month: "Jul", revenue: 1 }] },
      "exec",
      workspace,
      (value) => Promise.resolve(value),
    );
    expect(result).toMatchObject({ ok: true, attached: true });
    expect(result).not.toHaveProperty("embed");
    expect(publishMessage).toHaveBeenCalledWith(deps, run, "bot", [
      expect.objectContaining({ kind: "chart" }),
    ]);
    expect(attachWorkspaceFileToThread).not.toHaveBeenCalled();
  });

  it("returns an embed when the chart is attached as an image", async () => {
    attachWorkspaceFileToThread.mockResolvedValue({
      artifactId: "art1",
      block: { kind: "image", artifactId: "art1", mimeType: "image/png", name: "plot.png" },
    });
    const result = await renderPlotFromTool(
      deps,
      run,
      {
        spec: { marks: [{ type: "barY" }] },
        data: [{ note: "x".repeat(200_000) }],
      },
      "exec",
      workspace,
      (value) => Promise.resolve(value),
    );
    expect(result).toMatchObject({
      ok: true,
      attached: true,
      embed: "![plot.png](image:art1)",
    });
    expect(attachWorkspaceFileToThread).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ produced: true }),
    );
    expect(publishMessage).toHaveBeenCalledWith(deps, run, "bot", [
      expect.objectContaining({ kind: "image", artifactId: "art1" }),
    ]);
  });
});
