// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CloudAgentCard } from "./CloudAgentCard";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
}));

async function render(block: Parameters<typeof CloudAgentCard>[0]["block"]) {
  const container = document.createElement("div");
  await act(async () => createRoot(container).render(<CloudAgentCard block={block} />));
  return container.textContent;
}

const running = {
  kind: "cloud_agent" as const,
  agentId: "agent-1",
  title: "Add a README",
  status: "running" as const,
  url: "",
};

it("says an unreachable running agent resumes when it is back, and since when", async () => {
  const text = await render({ ...running, unreachableSince: "2026-11-13T10:05:00.000Z" });
  expect(text).toContain("unreachable");
  expect(text).toContain("Resumes when it's back");
  expect(text).toContain("since");
});

it("shows a reachable agent as running, and a finished one as finished", async () => {
  expect(await render(running)).not.toContain("unreachable");
  const text = await render({
    ...running,
    status: "finished",
    unreachableSince: "2026-11-13T10:05:00.000Z",
  });
  expect(text).toContain("finished");
  expect(text).not.toContain("unreachable");
});
