// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import JobSheet from "../app/job";
import { rpc } from "./api";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ agentId: "old-job" }),
  useRouter: () => ({ push, dismiss: vi.fn() }),
}));
vi.mock("./api", () => ({ rpc: vi.fn() }));
vi.mock("./cloud-jobs", () => ({ useCloudJobs: () => ({ jobs: [] }) }));
vi.mock("./foreground-poll", () => ({
  useForegroundPoll: (run: () => Promise<void>) =>
    useEffect(() => {
      void run();
    }, [run]),
}));
vi.mock("./native", () => ({
  native: { groupedPage: "white" },
  useResolvedAppearance: () => "dark",
}));
vi.mock("./appearance", () => ({ mobileTokens: () => ({}) }));
vi.mock("@rakazo/chat-ui/native", () => ({
  allowedAppLink: () => undefined,
  ChatMarkdown: ({ children }: { children: string }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: "div",
  ScrollView: "div",
  Text: "span",
  ActivityIndicator: "progress",
  Linking: { openURL: vi.fn() },
}));
vi.mock("../components/job-row", () => ({
  JobRow: ({ job }: { job: { title: string } }) => <span>{job.title}</span>,
}));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../components/load-failure", () => ({ LoadFailure: () => <span>Load failed</span> }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings[0] }),
}));

it("opens a job missing from recent jobs and returns to its originating group", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(rpc).mockResolvedValue({
    job: {
      agentId: "old-job",
      title: "Old group job",
      status: "finished",
      url: "",
      botId: "bot",
      botName: "Helper",
      threadId: "thread",
      groupId: "group",
      groupName: "Team",
    },
    brief: "Original brief",
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<JobSheet />));
    expect(rpc).toHaveBeenCalledWith("cloudAgents/detail", { agentId: "old-job" });
    expect(container.textContent).toContain("Old group job");
    expect(container.textContent).toContain("Original brief");
    const open = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Open chat",
    );
    expect(open).toBeDefined();
    await act(async () => open!.click());
    expect(push).toHaveBeenCalledWith({
      pathname: "/thread",
      params: { groupId: "group", name: "Team" },
    });
  } finally {
    await act(async () => root.unmount());
  }
});
