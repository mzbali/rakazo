import type { CloudAgentJob } from "@rakazo/contracts";
import { expect, it } from "vitest";
import { DONE_SHOWN, jobListItems } from "./job-shelves";

const job = (id: string, extra: Partial<CloudAgentJob> = {}): CloudAgentJob => ({
  agentId: id,
  title: id,
  status: "running",
  url: "",
  botId: "bot",
  botName: "Bot",
  threadId: "thread",
  ...extra,
});

it("orders the shelves needs you, working, done and drops empty ones", () => {
  const items = jobListItems(
    [
      job("done", { status: "finished" }),
      job("run"),
      job("ask", { needsInput: true }),
      job("queued", { queued: true }),
    ],
    false,
  );
  expect(
    items.map((item) =>
      item.kind === "job" ? item.job.agentId : item.kind === "header" ? item.shelf : item.kind,
    ),
  ).toEqual(["needsYou", "ask", "working", "run", "queued", "done", "done"]);
  expect(jobListItems([job("run")], false).map((item) => item.kind)).toEqual(["header", "job"]);
});

it("folds finished jobs past the latest few until expanded", () => {
  const finished = Array.from({ length: DONE_SHOWN + 3 }, (_, i) =>
    job(`f${i}`, { status: i % 2 ? "failed" : "finished" }),
  );
  const folded = jobListItems(finished, false);
  expect(folded.filter((item) => item.kind === "job")).toHaveLength(DONE_SHOWN);
  expect(folded.at(-1)).toEqual({ kind: "more", count: 3 });
  const open = jobListItems(finished, true);
  expect(open.filter((item) => item.kind === "job")).toHaveLength(DONE_SHOWN + 3);
  expect(open.some((item) => item.kind === "more")).toBe(false);
});

it("counts a finished job with an owner question on Needs you", () => {
  const items = jobListItems(
    [job("blocked", { status: "finished", ownerQuestion: "Which branch?" })],
    false,
  );
  expect(items[0]).toMatchObject({ kind: "header", shelf: "needsYou", count: 1 });
});
