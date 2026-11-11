import type { BackgroundJob } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { createRunExecutor } from "./executor.js";
import { postRoutineWatchMessage, tickRoutineWatch } from "./routine-watch.js";

vi.mock("./routine-watch.js", async (original) => ({
  ...(await original()),
  tickRoutineWatch: vi.fn(),
  postRoutineWatchMessage: vi.fn(async () => undefined),
}));

const BACK = "I can reach `list_threads` again for the **Lead** routine.";

function watchFixture(claims: number) {
  const scheduledAt = new Date(Date.now() - 1_000);
  const routine = {
    id: "routine-1",
    spaceId: "space-1",
    botId: "bot-1",
    userId: "user-1",
    name: "Lead",
    prompt: "report finished threads",
    crons: [],
    timezone: "UTC",
    active: true,
    nextRunAt: scheduledAt,
    threadId: null,
    watch: { kind: "tool", tool: "list_threads", everyMinutes: 5 },
    watchState: null,
  };
  const tx = {
    $queryRaw: vi.fn(async () => []),
    space: { findUnique: vi.fn(async () => null) },
    computerExecutionLease: { findMany: vi.fn(async () => []) },
    computer: { findMany: vi.fn(async () => []) },
    routine: {
      updateMany: vi.fn(async () => ({ count: claims })),
      findUnique: vi.fn(async () => ({
        prompt: routine.prompt,
        modelProvider: null,
        modelId: null,
        thinkingLevel: null,
      })),
    },
    run: { create: vi.fn(async () => ({ id: "run-1", taskId: "task-1" })) },
    task: { create: vi.fn(async () => ({ id: "task-1" })) },
  };
  const prisma = {
    user: { findUnique: vi.fn(async () => null) },
    routine: { findUnique: vi.fn(async () => routine) },
    bot: { findUnique: vi.fn(async () => ({ id: "bot-1", thread: { id: "thread-1" } })) },
    agentSkill: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
  };
  const executor = createRunExecutor({
    prisma,
    jobs: { enqueue: vi.fn(async (_job: BackgroundJob) => undefined), cancel: vi.fn() },
    events: { append: vi.fn(), notify: vi.fn(async () => undefined) },
  } as unknown as Parameters<typeof createRunExecutor>[0]);
  vi.mocked(tickRoutineWatch).mockResolvedValue({
    run: true,
    state: {
      checkedAt: scheduledAt.toISOString(),
      outcome: "changed",
      fingerprint: "b",
      detail: "x",
    },
    nextRunAt: new Date(Date.now() + 5 * 60_000),
    note: "\n\nThis run was started because something you watch changed (list_threads).",
    recovered: BACK,
  });
  vi.mocked(postRoutineWatchMessage).mockClear();
  return { executor, tx, scheduledAt };
}

describe("a change found as the watched source comes back", () => {
  it("says the source is back once the run is claimed", async () => {
    const { executor, tx, scheduledAt } = watchFixture(1);

    await executor.wakeRoutine("routine-1", scheduledAt.toISOString());

    expect(tx.run.create).toHaveBeenCalledOnce();
    expect(postRoutineWatchMessage).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ threadId: "thread-1", role: "bot", text: BACK }),
    );
  });

  it("says nothing from a check that lost the claim", async () => {
    const { executor, tx, scheduledAt } = watchFixture(0);

    await executor.wakeRoutine("routine-1", scheduledAt.toISOString());

    expect(tx.run.create).not.toHaveBeenCalled();
    expect(postRoutineWatchMessage).not.toHaveBeenCalled();
  });
});
