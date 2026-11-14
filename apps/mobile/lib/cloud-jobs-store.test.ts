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
    expect(refreshCloudJobs()).toBe(old);
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
    resetCloudJobs();
    rejectOld(new Error("old session"));
    await old;
    expect(cloudJobsSnapshot()).toEqual({ jobs: null, error: null });
  });
});
