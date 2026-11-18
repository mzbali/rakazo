import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));

/** Every file that draws the job card, the jobs row or the job sheet, on mobile and web. */
const SURFACES = [
  "apps/mobile/components/job-status.tsx",
  "apps/mobile/components/job-row.tsx",
  "apps/mobile/components/thread/cloud-agent-card.tsx",
  "apps/mobile/app/job.tsx",
  "apps/mobile/app/jobs.tsx",
  "apps/web/src/components/messages/CloudAgentCard.tsx",
];

const PHASE_WORDS = [
  "Starting",
  "Working",
  "Checking",
  "Done",
  "Needs you",
  "Resumes",
  "Couldn't start",
  "Stopped",
  "Expired",
];

function msgids(locale: string) {
  const catalog = readFileSync(root(`packages/i18n/locales/${locale}/messages.po`), "utf8");
  return new Set([...catalog.matchAll(/^msgid "(.*)"$/gm)].map((match) => match[1]!));
}

/** The messages a file asks Lingui for, in catalog form (`${name}` becomes `{name}`). */
function messagesIn(file: string) {
  const source = readFileSync(root(file), "utf8");
  const found = [
    ...[...source.matchAll(/\bt`([^`]*)`/g)].map((match) => match[1]!),
    ...[...source.matchAll(/<Trans>([\s\S]*?)<\/Trans>/g)].map((match) => match[1]!.trim()),
  ];
  return found.map((message) =>
    message.replace(/\$\{([A-Za-z_]\w*)\}/g, "{$1}").replace(/\{([A-Za-z_]\w*)\}/g, "{$1}"),
  );
}

const quoted = (message: string) => message.replace(/"/g, '\\"');

describe("job card strings", () => {
  const catalog = msgids("en");

  it("has every phase word extracted into the catalog", () => {
    for (const word of PHASE_WORDS) expect(catalog.has(quoted(word)), word).toBe(true);
  });

  it("has every string the card, row, sheet and web card show extracted", () => {
    for (const file of SURFACES)
      for (const message of messagesIn(file))
        expect(catalog.has(quoted(message)), `${file}: ${message}`).toBe(true);
  });

  it("no longer keeps the raw status words as messages", () => {
    for (const raw of ["running", "finished", "failed", "cancelled", "needs input", "queued"])
      expect(catalog.has(raw), raw).toBe(false);
  });

  it("never prints a raw status or a literal word on a card", () => {
    for (const file of SURFACES) {
      const source = readFileSync(root(file), "utf8").replace(/<Trans>[\s\S]*?<\/Trans>/g, "");
      expect(source, file).not.toMatch(/\{(?:job|block|attempt)\.status\}/);
      // Visible text between tags that is not a Lingui message or an expression.
      for (const text of source.matchAll(/>\s*([A-Za-z][^<>{}`]*?)\s*<\//g))
        expect(text[1], `${file}: unextracted "${text[1]}"`).toBe("");
    }
  });
});
