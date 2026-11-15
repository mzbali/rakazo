// @vitest-environment jsdom
import type { ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Pressable: ({
    children,
    accessibilityLabel,
  }: {
    children: ReactNode;
    accessibilityLabel: string;
  }) => (
    <button type="button" aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./native", () => ({ useThemedStyles: () => ({}) }));
vi.mock("./activity", () => ({
  activityPreview: (run: { promptSnippet?: string }) => run.promptSnippet ?? "",
  activityStatusLabel: (status: string) => status,
  formatActivityRelativeTime: () => "",
}));
vi.mock("../components/home-styles", () => ({ createHomeStyles: () => ({}) }));
vi.mock("../components/bot-avatar", () => ({ BotAvatar: () => <i /> }));
vi.mock("../components/group-avatar", () => ({ GroupAvatar: () => <i /> }));
vi.mock("../components/inbox-rows", () => ({
  FALLBACK_COLOR: "orange",
  SectionToggle: ({ title, collapsed }: { title: string; collapsed: boolean }) => (
    <button type="button" aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`} />
  ),
  ConversationRow: ({
    title,
    preview,
    actions,
  }: {
    title: string;
    preview?: string;
    actions?: string[];
  }) => (
    <>
      <p data-actions={actions?.join(" ")}>{title}</p>
      {preview ? <small>{preview}</small> : null}
    </>
  ),
  ChatSwipe: ({ rowKey, children }: { rowKey: string; children: ReactNode }) => (
    <section data-swipe={rowKey}>{children}</section>
  ),
}));

import { ActivitySection } from "../components/inbox-activity";

const IDLE_BOT = { id: "builder", name: "Builder", status: "idle" };
const job = (extra: object) => ({
  agentId: "job-1",
  title: "Add dark mode",
  status: "running",
  url: "https://example.com/t",
  botId: "builder",
  botName: "Builder",
  threadId: "thread-1",
  messageId: "card-1",
  ...extra,
});
const renderJobs = (jobs: object[], opened: string[] = []) =>
  renderToStaticMarkup(
    createElement(ActivitySection, {
      activity: { active: [], recent: [] },
      jobs: jobs as never,
      status: "loaded",
      bots: [IDLE_BOT] as never,
      groups: [],
      toggledSections: new Set(opened),
      onToggleSection: () => undefined,
      openChat: () => undefined,
    }),
  );

it("opens Needs attention and folds Working and Unread until the user opens them", () => {
  const markup = renderToStaticMarkup(
    createElement(ActivitySection, {
      activity: {
        active: [
          { runId: "ask", botId: "marketing", botName: "Marketing", status: "waiting_input" },
          { runId: "work", botId: "research", botName: "Research", status: "running" },
        ] as never,
        recent: [],
      },
      status: "loaded",
      bots: [
        { id: "marketing", name: "Marketing", status: "waiting_input" },
        { id: "research", name: "Research", status: "running" },
        { id: "writer", name: "Writer", status: "idle", unread: true },
      ] as never,
      groups: [],
      toggledSections: new Set(["activity:unread"]),
      onToggleSection: () => undefined,
      openChat: () => undefined,
    }),
  );
  expect(markup).toContain('aria-label="Collapse Needs attention"');
  expect(markup).toContain('aria-label="Expand Working"');
  expect(markup).toContain('aria-label="Collapse Unread"');
  expect(markup).toContain("Marketing");
  expect(markup).not.toContain("Research");
  expect(markup).toContain("Writer");
});

it("offers the inbox swipe actions on activity rows and leaves out archived chats", () => {
  const markup = renderToStaticMarkup(
    createElement(ActivitySection, {
      activity: {
        active: [],
        recent: [
          { runId: "a", botId: "marketing", botName: "Marketing", status: "completed" },
          { runId: "b", botId: "archived", botName: "Archived", status: "completed" },
        ] as never,
      },
      status: "loaded",
      bots: [{ id: "marketing", name: "Marketing", status: "idle" }] as never,
      groups: [],
      toggledSections: new Set<string>(),
      onToggleSection: () => undefined,
      openChat: () => undefined,
      swipe: {
        botAction: () => undefined,
        groupAction: () => undefined,
        sections: [],
        onOrganize: () => undefined,
        onEditSection: () => undefined,
      },
    }),
  );
  expect(markup).toContain(
    '<section data-swipe="activity:bot:marketing"><p data-actions="unread archive pin">Marketing</p>',
  );
  expect(markup).not.toContain("Archived");
});

it.each([
  ["loading", ""],
  ["loaded", "No runs yet"],
  ["failed", "Could not load activity"],
] as const)("says why nothing is listed once the inbox is gone (%s)", (status, text) => {
  const markup = renderToStaticMarkup(
    createElement(ActivitySection, {
      activity: { active: [], recent: [] },
      status,
      bots: [],
      groups: [],
      toggledSections: new Set<string>(),
      onToggleSection: () => undefined,
      openChat: () => undefined,
    }),
  );
  expect(markup.replace(/<[^>]+>/g, "")).toBe(text);
});

it("files a bot with a job waiting on the owner under Needs attention, with the question", () => {
  const markup = renderJobs([job({ needsInput: true, ownerQuestion: "Which branch?" })]);
  expect(markup).toContain('aria-label="Collapse Needs attention"');
  expect(markup).toContain("<small>Which branch?</small>");
  expect(markup).not.toContain("Working");
});

it("moves the bot to Working, under the job's title, once the question is answered", () => {
  const markup = renderJobs([job({})], ["activity:working"]);
  expect(markup).not.toContain("Needs attention");
  expect(markup).toContain('aria-label="Collapse Working"');
  expect(markup).toContain("<small>Add dark mode</small>");
});

it("leaves a bot whose job has finished out of Needs attention and Working", () => {
  const markup = renderJobs([job({ status: "finished" })]);
  expect(markup).not.toContain("Needs attention");
  expect(markup).not.toContain("Working");
});
