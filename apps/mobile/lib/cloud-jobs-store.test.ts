import { deferred } from "@rakazo/core/test-async";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rpc } from "./api/api";
import { cloudJobsSnapshot, refreshCloudJobs, resetCloudJobs } from "./cloud-jobs-store";

vi.mock("./api/api", () => ({ rpc: vi.fn() }));

beforeEach(() => {
  resetCloudJobs();
  vi.mocked(rpc).mockReset();
});

describe("cloud jobs context changes", () => {
  it("discards a late result and lets the new account load immediately", async () => {
    const oldGate = deferred<never[]>();
    vi.mocked(rpc).mockImplementationOnce(() => oldGate.promise);
    const old = refreshCloudJobs();
    await Promise.resolve();
    resetCloudJobs();
    vi.mocked(rpc).mockResolvedValueOnce([]);
    await refreshCloudJobs();
    const current = cloudJobsSnapshot();
    oldGate.resolve([]);
    await old;
    expect(cloudJobsSnapshot()).toBe(current);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("discards errors from the previous context", async () => {
    const oldGate = deferred<never[]>();
    vi.mocked(rpc).mockImplementationOnce(() => oldGate.promise);
    const old = refreshCloudJobs();
    await Promise.resolve();
    resetCloudJobs();
    oldGate.reject(new Error("old session"));
    await old;
    expect(cloudJobsSnapshot()).toEqual({ jobs: null, error: null });
  });
});

describe("a signal during a read", () => {
  it("is not lost: one more read runs and the newer data wins", async () => {
    const job = (title: string) => [{ agentId: "a", title }] as never;
    const firstGate = deferred<never>();
    vi.mocked(rpc).mockImplementationOnce(() => firstGate.promise);
    vi.mocked(rpc).mockResolvedValueOnce(job("new"));
    const first = refreshCloudJobs();
    await Promise.resolve();
    const signalled = refreshCloudJobs();
    firstGate.resolve(job("old"));
    await Promise.all([first, signalled]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(cloudJobsSnapshot().jobs).toEqual(job("new"));
  });
});
