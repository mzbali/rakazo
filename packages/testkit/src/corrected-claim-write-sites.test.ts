import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_AGENT_SKILLS } from "@rakazo/adapters";
import { addedClaimMessage, BOT_TEMPLATES } from "@rakazo/core";
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
  "packages/testkit/src/cli/ios-screenshot-seed.ts": "exempt: screenshot fixture",
};

const WRITES = [
  /\b(?:agentSkill|memoryDocument)\.(?:create|createMany|update|updateMany|upsert)\b/,
  /\bbot\.(?:create|createMany|update|updateMany|upsert)\(\s*\{[\s\S]{0,1500}?\binstructions\b/,
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
  const found = ["packages", "apps"]
    .flatMap((group) =>
      readdirSync(path.join(root, group)).flatMap((name) => {
        const src = path.join(root, group, name, "src");
        try {
          return sourceFiles(src);
        } catch {
          return [];
        }
      }),
    )
    .filter((file) => {
      const text = readFileSync(file, "utf8");
      return WRITES.some((pattern) => pattern.test(text));
    })
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .sort();

  it("classifies every file that writes instructions, skills or memory", () => {
    expect(found.filter((file) => !(file in WRITERS))).toEqual([]);
  });

  it("lists no file that stopped writing them", () => {
    expect(Object.keys(WRITERS).filter((file) => !found.includes(file))).toEqual([]);
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
    expect(texts.map((text) => addedClaimMessage("", text)).filter(Boolean)).toEqual([]);
  });
});
