import type { AdapterContext, CloudAgentProvider } from "@rakazo/adapter-kit";
import { CloudAgentRequestRejected, CloudAgentRetryLater } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { settleAcceptedCloudAgent } from "./cloud-agent-settle.js";
import { T3ThreadEventsEmulator, t3EmulatedProvider } from "./t3-cloud-agent.test-support.js";

const context: AdapterContext = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space",
  userId: "user",
  botId: "bot",
  signal: new AbortController().signal,
};

const connection = (settle: CloudAgentProvider["settle"], key = "k") => ({
  key,
  provider: { settle } as CloudAgentProvider,
});

describe("settling accepted cloud agent work", () => {
  it("retries a transient error and then stops", async () => {
    const settle = vi
      .fn()
      .mockRejectedValueOnce(new CloudAgentRetryLater("unavailable"))
      .mockResolvedValueOnce(undefined);
    await settleAcceptedCloudAgent(connection(settle), "t1", context, 0);
    expect(settle).toHaveBeenCalledTimes(2);

    const down = vi.fn().mockRejectedValue(new CloudAgentRetryLater("unavailable"));
    await expect(
      settleAcceptedCloudAgent(connection(down), "t1", context, 0),
    ).resolves.toBeUndefined();
    expect(down).toHaveBeenCalledTimes(3);
  });

  it("never throws, and does not retry a refusal", async () => {
    const refused = vi.fn().mockRejectedValue(new CloudAgentRequestRejected("invalid"));
    await settleAcceptedCloudAgent(connection(refused, "refused"), "t1", context, 0);
    await settleAcceptedCloudAgent(connection(refused, "refused"), "t2", context, 0);
    expect(refused).toHaveBeenCalledTimes(2);
    const broken = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(
      settleAcceptedCloudAgent(connection(broken), "t1", context, 0),
    ).resolves.toBeUndefined();
    expect(broken).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a provider with no settle or an agent with no remote", async () => {
    await settleAcceptedCloudAgent(connection(undefined), "t1", context, 0);
    const settle = vi.fn();
    await settleAcceptedCloudAgent(connection(settle), null, context, 0);
    expect(settle).not.toHaveBeenCalled();
  });
});

describe("T3 thread housekeeping", () => {
  it("names the thread as the card does at launch, and settles it through T3's own tool", async () => {
    const emulator = new T3ThreadEventsEmulator();
    const provider = t3EmulatedProvider(emulator);
    const handle = await provider.launch(
      { scratch: true, idempotencyKey: "abcdef123456", prompt: "Fix it", title: "Fix login" },
      context,
    );
    expect(handle.title).toBe("Fix login");
    // The tag stays until a poll has seen the thread, so a replayed launch can still find it.
    expect(emulator.threads.get(handle.id)!.title).toMatch(/^Fix login · /);
    await provider.get(handle.id, context);
    expect(emulator.threads.get(handle.id)!.title).toBe("Fix login");
    // A title someone changed since is left alone.
    emulator.threads.get(handle.id)!.title = "Renamed by the owner";
    await provider.get(handle.id, context);
    expect(emulator.threads.get(handle.id)!.title).toBe("Renamed by the owner");
    await provider.settle(handle.id, context);
    expect(emulator.settled).toEqual([handle.id]);
  });

  it("still launches when the connection cannot rename, and reports a settle it cannot make", async () => {
    const emulator = new T3ThreadEventsEmulator();
    emulator.tools = emulator.tools.filter(
      (tool) => !["t3_thread_update", "t3_thread_organize"].includes(tool.name),
    );
    const provider = t3EmulatedProvider(emulator);
    const handle = await provider.launch(
      { scratch: true, idempotencyKey: "abcdef123456", prompt: "Fix it", title: "Fix login" },
      context,
    );
    expect(handle.status).toBe("running");
    await expect(provider.settle(handle.id, context)).rejects.toBeInstanceOf(
      CloudAgentRequestRejected,
    );
  });
});
