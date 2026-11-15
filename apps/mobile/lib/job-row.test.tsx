// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobRow } from "../components/job-row";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + String(values[index - 1] ?? "") + part),
  }),
}));
vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const element =
    (tag: string) =>
    ({ children }: { children?: React.ReactNode }) =>
      createElement(tag, null, children);
  return { View: element("div"), Text: element("span") };
});
vi.mock("react-native-reanimated", async () => {
  const { View } = await import("react-native");
  return {
    default: { View },
    cancelAnimation: () => undefined,
    withRepeat: (value: number) => value,
    withSequence: (value: number) => value,
    useAnimatedStyle: (style: () => unknown) => style(),
    useReducedMotion: () => true,
    useSharedValue: (value: number) => ({ value }),
    withTiming: (value: number) => value,
  };
});
vi.mock("./appearance", () => ({ mobileTokens: () => ({}) }));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => <i /> }));

const job = {
  agentId: "agent-1",
  title: "Add a README",
  status: "running" as const,
  url: "https://t3.example.test/thread-1",
  startedAt: "2026-11-13T10:00:00.000Z",
};

describe("job row", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-13T10:00:05.000Z"));
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });
  const render = (next: Partial<Parameters<typeof JobRow>[0]["job"]>) =>
    act(() => root.render(<JobRow job={{ ...job, ...next }} />));

  it("shows the plain phase, the latest progress and a ticking clock while it works", () => {
    render({ progress: "Reading the router" });
    expect(container.textContent).toContain("Working");
    expect(container.textContent).toContain("Reading the router");
    expect(container.textContent).toContain("5s");
    act(() => vi.advanceTimersByTime(3000));
    expect(container.textContent).toContain("8s");
  });

  it("stops the clock at the end and shows the clipped result", () => {
    render({
      status: "finished",
      endedAt: "2026-11-13T10:02:00.000Z",
      progress: "stale line",
      resultExcerpt: "Added the README.",
      prUrl: "https://github.com/acme/app/pull/12",
    });
    expect(container.textContent).toContain("Done");
    expect(container.textContent).toContain("2m");
    expect(container.textContent).toContain("Added the README.");
    expect(container.textContent).toContain("PR #12");
    expect(container.textContent).not.toContain("Checks");
    expect(container.textContent).not.toContain("stale line");
    act(() => vi.advanceTimersByTime(120_000));
    expect(container.textContent).toContain("2m");
    expect(container.textContent).not.toContain("4m");
  });

  it("puts the title and the phase on the first row", () => {
    render({});
    expect(container.firstElementChild?.firstElementChild?.nextElementSibling?.textContent).toMatch(
      /^Add a README.*Working/,
    );
  });

  it("shows the needs-you state once and the question without a prefix", () => {
    render({ ownerQuestion: "Which branch should ship?" });
    expect(container.textContent).toContain("Which branch should ship?");
    expect(container.textContent?.match(/Needs you/g)).toHaveLength(1);
    expect(container.textContent).not.toContain("Needs you:");
  });

  it("keeps the model, project and branch off the face", () => {
    render({
      note: "Picked claude-sonnet-5-5 on main (simple).",
      projectName: "app",
      branch: "feature/x",
    });
    expect(container.textContent).not.toMatch(/Sonnet|simple|feature\/x|app$/);
  });

  it("uses a plain word for every state, never a raw status", () => {
    const raw = /running|finished|cancelled|failed|expired|needs input|queued|unreachable/;
    const labels = new Map<string, Partial<Parameters<typeof JobRow>[0]["job"]>>([
      ["Starting", { queued: true }],
      ["Working", {}],
      ["Checking", { review: "checking" }],
      ["Done", { status: "finished" }],
      ["Needs you", { needsInput: true }],
      ["Couldn't start", { status: "failed", launchFailed: true }],
      ["Stopped", { status: "cancelled" }],
      ["Expired", { status: "expired" }],
    ]);
    for (const [label, next] of labels) {
      render(next);
      expect(container.textContent, label).toContain(label);
      expect(container.textContent, label).not.toMatch(raw);
    }
  });
});
