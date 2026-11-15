import { expect, it, vi } from "vitest";
import { jobLinks } from "./job-links";

vi.mock("@rakazo/chat-ui/native", () => ({ allowedAppLink: () => undefined }));

it("hides the thread action when launch was refused, including a stale URL", () => {
  expect(jobLinks({ url: "https://example.test/thread", launchFailed: true }).t3).toBeUndefined();
});

it("requires a thread URL for stopped and other jobs, and preserves real thread links", () => {
  expect(jobLinks({ url: "" }).t3).toBeUndefined();
  expect(jobLinks({ url: "https://example.test/thread" }).t3).toBe("https://example.test/thread");
});
