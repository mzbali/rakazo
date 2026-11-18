import { expect, it } from "vitest";
import { OWNER_CLOSED_POLL_MS, ownerClosedPollAt } from "./cloud-agent-owner-closed.js";

const DAY = 24 * 60 * 60_000;

it("checks every few minutes, last at the end of the week after the work ended", () => {
  const ended = new Date(0);
  expect(ownerClosedPollAt(ended, DAY)?.getTime()).toBe(DAY + OWNER_CLOSED_POLL_MS);
  // A question asked just before the week ends still gets its check, at the end.
  expect(ownerClosedPollAt(ended, 7 * DAY - 60_000)?.getTime()).toBe(7 * DAY);
  expect(ownerClosedPollAt(ended, 7 * DAY)).toBeNull();
  expect(ownerClosedPollAt(null, DAY)?.getTime()).toBe(DAY + OWNER_CLOSED_POLL_MS);
});
