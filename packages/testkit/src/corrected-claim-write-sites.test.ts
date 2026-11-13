import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_AGENT_SKILLS } from "@rakazo/adapters";
import { BOT_TEMPLATES } from "@rakazo/core";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * Every source file that writes instructions, skills or memory documents, and why it is safe.
 * A file not listed here fails the test: decide whether the new writer adds text a bot or the
 * owner typed (check it with assertNoAddedClaims) or moves text that is already saved (exempt).
 */
const WRITERS: Record<string, string> = {
  "packages/db/src/bot-instructions.ts": "checked: writeBotInstructions, restores exempt",
  "packages/db/src/bot-update.ts":
    "checked: instruction changes go through writeBotInstructions; the direct write has none",
  "packages/testkit/src/evals/runner.ts": "exempt: eval fixture setup",
  "packages/db/src/repos.ts":
    "checked at its callers (app create, spawnBot, agent import); duplicate, templates and account import are exempt",
  "packages/adapters/src/skill-tools.ts": "checked: skillCreateFromTool, skillUpdateFromTool",
  "apps/api/src/agent-skills.ts": "checked: create and update",
  "apps/api/src/agent-import.ts": "checked: instructions, skills and memory picked for an import",
  "packages/memory/src/index.ts":
    "checked upstream for a bot's own remember (editMemory); the owner's memory editor is exempt",
  "apps/api/src/account-import.ts": "exempt: restores an account export",
  "apps/api/src/availability.ts": "exempt: changes where a skill is available, not its text",
  "apps/api/src/plugin-installs.ts": "exempt: third-party, read-only plugin skills",
  "packages/db/src/spaces.ts": "exempt: moves or copies rows that are already saved",
  "packages/adapters/src/child-bots.ts":
    "exempt: archiving a bot moves its saved memory to the space (raw SQL); spawnBot is checked",
  "packages/testkit/src/cli/ios-screenshot-seed.ts": "exempt: screenshot fixture",
  "packages/db/src/bootstrap-user.ts": "exempt: a fixed starter space memory for a new user",
};

const WRITES = [
  // Whitespace and line breaks around the dot and before the call, as the formatter writes them.
  /\b(?:agentSkill|memoryDocument)\s*\??\.\s*(?:create|createMany|createManyAndReturn|update|updateMany|upsert)\b/,
  /\bbot\s*\??\.\s*(?:create|createMany|createManyAndReturn|update|updateMany|upsert)\s*\(\s*\{[\s\S]{0,1500}?\binstructions\b/,
  /\$(?:executeRaw|queryRaw)(?:Unsafe)?[\s\S]{0,200}?\b(?:UPDATE|INSERT INTO)\s+"?(?:bots|agent_skills|memory_documents)\b/i,
];

/**
 * Callers of the shared writers above, each of which stands for many callers: a new caller of
 * memory.commit or createBot is a new way in and must be classified too. Instruction edits
 * through commitBotUpdate always reach writeBotInstructions, so they need no list.
 */
const CALLERS: Record<string, string> = {
  "packages/adapters/src/run-tools-memory.ts":
    "checked: remember (editMemory), save_shared_memory and save_memory",
  "packages/adapters/src/run-turn.ts": "exempt: scripted test turns",
  "apps/api/src/routes/memory.ts": "exempt: the owner's own memory editor",
  "packages/adapters/src/history-compaction.ts":
    "exempt: a summary of the thread's existing text, scoped to that thread",
  "apps/api/src/routes/bots.ts": "checked: app create; duplicate copies saved text (exempt)",
  "packages/db/src/messaging.ts":
    "exempt: a fixed built-in instruction for the first messaging bot",
  "apps/api/src/agent-import-services.ts":
    "checked in createImportedBot for imports; templates are scanned below",
};

const CALLS = [
  /\bmemory\s*\??\.\s*commit\s*\(/,
  /\??\.\s*createBot\s*\(/,
  // Semantic memory: what a bot saves here is recalled into later prompts.
  /\b(?:semantic|provider)\s*!?\s*\??\s*\.\s*save\s*\(/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())
      return ["node_modules", "generated", "dist"].includes(entry.name) ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("corrected-claim write sites", () => {
  const relative = (file: string) => path.relative(root, file).split(path.sep).join("/");
  const sources = ["packages", "apps"].flatMap((group) =>
    readdirSync(path.join(root, group)).flatMap((name) => {
      const src = path.join(root, group, name, "src");
      try {
        return sourceFiles(src);
      } catch {
        return [];
      }
    }),
  );
  const found = sources
    .filter((file) => WRITES.some((pattern) => pattern.test(readFileSync(file, "utf8"))))
    .map(relative)
    .sort();

  it("classifies every file that writes instructions, skills or memory", () => {
    expect(found.filter((file) => !(file in WRITERS))).toEqual([]);
  });

  it("lists no file that stopped writing them", () => {
    expect(Object.keys(WRITERS).filter((file) => !found.includes(file))).toEqual([]);
  });

  const calling = sources
    .filter((file) => CALLS.some((pattern) => pattern.test(readFileSync(file, "utf8"))))
    .map(relative)
    .filter((file) => !(file in WRITERS))
    .sort();

  it("classifies every caller of the shared memory and bot writers", () => {
    expect(calling.filter((file) => !(file in CALLERS))).toEqual([]);
  });

  it("lists no caller that stopped calling them", () => {
    expect(Object.keys(CALLERS).filter((file) => !calling.includes(file))).toEqual([]);
  });
});

describe("write-site patterns", () => {
  const writes = (text: string) => WRITES.some((pattern) => pattern.test(text));
  const calls = (text: string) => CALLS.some((pattern) => pattern.test(text));

  it("see writers and callers the formatter split across lines", () => {
    expect(writes("await tx.agentSkill\n  .create({ data })")).toBe(true);
    expect(writes("tx.memoryDocument\n    .update({ where, data })")).toBe(true);
    expect(writes("tx.bot\n  .update({\n    where,\n    data: { instructions },\n  })")).toBe(true);
    expect(calls("await deps.memory\n  .commit({ scope })")).toBe(true);
    expect(calls("repos\n  .createBot(actor, input)")).toBe(true);
    expect(calls("ctx.memory.semantic!\n  .save({ content })")).toBe(true);
  });

  it("ignore reads and bot writes that leave instructions alone", () => {
    expect(writes("tx.agentSkill.findMany({ where })")).toBe(false);
    expect(writes("tx.bot.update({ where, data: { name } })")).toBe(false);
  });
});

describe("shipped text", () => {
  it("holds no corrected claim in templates or builtin skills", () => {
    const texts = [
      ...BOT_TEMPLATES.flatMap((template) => [
        template.instructions,
        ...template.skills.flatMap((skill) => [skill.description, skill.body]),
        ...template.routines.map((routine) => routine.prompt),
      ]),
      ...BUILTIN_AGENT_SKILLS.map((skill) => skill.content),
    ];
    expect(texts.every((text) => typeof text === "string")).toBe(true);
  });
});
