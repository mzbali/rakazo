// Refreshes apps/web/e2e/spec-durations.json, which balances the Web E2E shards, from the JSON
// reports of recent CI runs. Merge a run's shard blobs with
// `playwright merge-reports --reporter json <blobs>`, then:
//   pnpm exec tsx packages/testkit/src/cli/spec-durations.ts run-1.json run-2.json ...
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Suite = {
  file: string;
  specs?: { tests: { results: { duration: number }[] }[] }[];
  suites?: Suite[];
};

function specMilliseconds(suite: Suite): number {
  const own = (suite.specs ?? [])
    .flatMap((spec) => spec.tests)
    .flatMap((test) => test.results)
    .reduce((sum, result) => sum + result.duration, 0);
  return own + (suite.suites ?? []).reduce((sum, child) => sum + specMilliseconds(child), 0);
}

const reports = process.argv.slice(2);
if (!reports.length) throw new Error("Pass one or more Playwright JSON reports.");

const runs = new Map<string, number[]>();
for (const report of reports) {
  const { suites } = JSON.parse(readFileSync(report, "utf8")) as { suites: Suite[] };
  for (const suite of suites) {
    runs.set(suite.file, [...(runs.get(suite.file) ?? []), specMilliseconds(suite) / 1000]);
  }
}

const durations: Record<string, number> = Object.fromEntries(
  [...runs]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, seconds]) => {
      const mean = seconds.reduce((sum, value) => sum + value, 0) / seconds.length;
      return [file, Math.round(mean * 10) / 10];
    }),
);

const out = fileURLToPath(new URL("../../../../apps/web/e2e/spec-durations.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(durations, null, 2)}\n`);
console.log(
  `Wrote ${Object.keys(durations).length} spec durations to ${path.relative(process.cwd(), out)}`,
);
