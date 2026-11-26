// Splits whole spec files across CI shards by how long each took on recent runs, so every shard
// finishes at about the same time. Playwright's own --shard splits by test count, which left one
// shard with nearly four times the work of another. Files without a recorded time weigh the median.

export type SpecDurations = Record<string, number>;

export function parseShard(value: string): { current: number; total: number } {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const current = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || total < 1 || current < 1 || current > total) {
    throw new Error(`Expected a shard like 2/6, got "${value}"`);
  }
  return { current, total };
}

export function planShards(files: string[], durations: SpecDurations, total: number): string[][] {
  const known = Object.values(durations).sort((a, b) => a - b);
  const fallback = known[Math.floor(known.length / 2)] ?? 1;
  const weighted = [...new Set(files)]
    .map((file) => ({ file, seconds: durations[file] ?? fallback }))
    // Longest first, then by name, so every shard computes the same plan.
    .sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));
  const shards = Array.from({ length: total }, () => ({ seconds: 0, files: [] as string[] }));
  for (const { file, seconds } of weighted) {
    const lightest = shards.reduce((min, shard) => (shard.seconds < min.seconds ? shard : min));
    lightest.files.push(file);
    lightest.seconds += seconds;
  }
  return shards.map((shard) => shard.files.sort());
}
