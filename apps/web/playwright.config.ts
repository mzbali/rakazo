import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { isRealSandboxProvider } from "./e2e/helpers/helpers";
import { parseShard, planShards } from "./server/e2e-shards";

const webPort = Number(process.env.WEB_PORT ?? 5173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${webPort}`;
const realSandbox = isRealSandboxProvider();
const boatSandbox = process.env.SANDBOX_PROVIDER === "boat";
// Pull-request CI leaves visual and edge-case coverage to the nightly run: these whole files, plus
// any test tagged @nightly. Unit and Postgres suites already cover their behavior.
const skipNightly = Boolean(process.env.E2E_SKIP_NIGHTLY);
// CI pulls these into their own jobs so they do not share a shard with each other and set the floor.
const skipHeavy = process.env.E2E_SKIP_HEAVY === "1";
const heavySpecs = ["page-browser", "pages"];
const nightlySpecs = [
  "activity-list",
  "agent-connection-approval",
  "app-connect-card",
  "app-marks",
  "artifacts-tab",
  "avatar-indicator-bounds",
  "avatar-motion",
  "avatar-studio",
  "board",
  "bot-organization",
  "chart-export",
  "chart-links",
  "chat-header",
  "chat-progress-messages",
  "choice-card",
  "collapsible-sidebar-sections",
  "command-palette",
  "computer-needs-you-card",
  "computer-update",
  "computers-unavailable",
  "desktop-update",
  "direct-mcp-integrations",
  "fetch-approval-card",
  "gallery",
  "knowledge-panel",
  "link-favicons",
  "load-failure",
  "login-card",
  "logo-avatar-motion-conformance",
  "logo-avatars",
  "markdown-diagram",
  "markdown-table",
  "message-hover-actions",
  "message-jump",
  "message-quote",
  "messaging-settings",
  "mobile-sidebar-swipe",
  "model-header-discovery",
  "nav-links",
  "new-bot-ux",
  "readable-names",
  "resizable-side-panel",
  "run-failure",
  "settings-shell",
  "sidebar-created-bots",
  "sidebar-density",
  "sidebar-mini-resize",
  "sidebar-search",
  "subagent-card",
  "time-separators-replies",
  "tool-activity",
  "ui-appearance",
  "ui-locale",
];
const ignoredNames = [...(skipNightly ? nightlySpecs : []), ...(skipHeavy ? heavySpecs : [])];
const ignoredSpecs = ignoredNames.map((name) => `**/${name}.spec.ts`);

// CI sets E2E_SHARD (like 2/6) to run one shard. Whole files go to shards by their recorded
// durations (e2e/spec-durations.json) rather than Playwright's --shard, which splits by test count.
const e2eShard = process.env.E2E_SHARD ? parseShard(process.env.E2E_SHARD) : undefined;
const shardFiles = (() => {
  if (!e2eShard) return undefined;
  const e2eDir = path.join(import.meta.dirname, "e2e");
  const files = globSync("**/*.spec.ts", { cwd: e2eDir })
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => !ignoredNames.includes(path.basename(file, ".spec.ts")));
  const durations = JSON.parse(readFileSync(path.join(e2eDir, "spec-durations.json"), "utf8"));
  return planShards(files, durations, e2eShard.total)[e2eShard.current - 1];
})();
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GitHub Actions shards the suite; each shard writes a blob that the merge job turns into one report.
const reporters = [
  ...(process.env.CI ? ([["github"]] as const) : []),
  ["list"] as const,
  process.env.GITHUB_ACTIONS
    ? ([
        "blob",
        {
          outputDir: "../../blob-report",
          fileName: e2eShard ? `report-${e2eShard.current}.zip` : undefined,
        },
      ] as const)
    : (["html", { open: "never", outputFolder: "../../playwright-report" }] as const),
];

export default defineConfig({
  testDir: "./e2e",
  testMatch: shardFiles?.map((file) => new RegExp(`/e2e/${escapeRegExp(file)}$`)),
  testIgnore: ignoredSpecs.length ? ignoredSpecs : undefined,
  grepInvert: skipNightly ? /@nightly/ : undefined,
  forbidOnly: Boolean(process.env.CI),
  // Specs that must stay ordered opt into test.describe.configure({ mode: "serial" }).
  // CI keeps two workers per shard: GitHub's 4-vCPU runners starve at four concurrent Chromiums,
  // and wall clock drops more from extra shards (separate machines) than from packing one box.
  // Heavy page-browser runs alone with one worker so its second Chromium is not fighting a peer.
  fullyParallel: !realSandbox,
  workers: realSandbox
    ? 1
    : process.env.E2E_WORKERS
      ? Number(process.env.E2E_WORKERS)
      : process.env.CI
        ? 2
        : undefined,
  timeout: boatSandbox ? 600_000 : realSandbox ? 300_000 : 120_000,
  expect: { timeout: boatSandbox ? 300_000 : realSandbox ? 90_000 : 20_000 },
  reporter: reporters,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Video encodes every test on CI; screenshots and the failure trace are enough to debug.
    video: process.env.CI ? "off" : "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
