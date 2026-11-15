import { beforeEach, describe, expect, it, vi } from "vitest";
import { rpc } from "./api";
import { cloudJobsSnapshot, refreshCloudJobs, resetCloudJobs } from "./cloud-jobs-store";

vi.mock("./api", () => ({ rpc: vi.fn() }));

beforeEach(() => {
  resetCloudJobs();
  vi.mocked(rpc).mockReset();
});

describe("cloud jobs context changes", () => {
  it("discards a late result and lets the new account load immediately", async () => {
    let finishOld!: (jobs: never[]) => void;
    vi.mocked(rpc).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const old = refreshCloudJobs();
    await Promise.resolve();
    resetCloudJobs();
    vi.mocked(rpc).mockResolvedValueOnce([]);
    await refreshCloudJobs();
    const current = cloudJobsSnapshot();
    finishOld([]);
    await old;
    expect(cloudJobsSnapshot()).toBe(current);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("discards errors from the previous context", async () => {
    let rejectOld!: (error: Error) => void;
    vi.mocked(rpc).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
    );
    const old = refreshCloudJobs();
    await Promise.resolve();
    resetCloudJobs();
    rejectOld(new Error("old session"));
    await old;
    expect(cloudJobsSnapshot()).toEqual({ jobs: null, error: null });
  });
});

describe("a signal during a read", () => {
  it("is not lost: one more read runs and the newer data wins", async () => {
    const job = (title: string) => [{ agentId: "a", title }] as never;
    let finishFirst!: (jobs: never) => void;
    vi.mocked(rpc).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    vi.mocked(rpc).mockResolvedValueOnce(job("new"));
    const first = refreshCloudJobs();
    await Promise.resolve();
    const signalled = refreshCloudJobs();
    finishFirst(job("old"));
    await Promise.all([first, signalled]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(cloudJobsSnapshot().jobs).toEqual(job("new"));
  });
});
