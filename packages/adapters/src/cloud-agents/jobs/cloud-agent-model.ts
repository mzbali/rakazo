/** A model as a job card shows it. `mark` is an opaque key the apps map to a picture. */
export interface CloudAgentModelDisplay {
  name: string;
  effort?: string;
  mark?: string;
}

/** "claude-sonnet-5-5" reads "Sonnet 5.5" and "gpt-6-luna" "GPT-6 Luna"; a trailing date goes. */
function modelName(id: string): string {
  const parts = id.split(/[-_\s]/).filter((part) => part && !/^\d{8}$/.test(part));
  if (parts[0]?.toLowerCase() === "claude") parts.shift();
  const words: string[] = [];
  for (const part of parts) {
    const last = words.length - 1;
    if (/^\d+$/.test(part) && last >= 0 && /^\d+$/.test(words[last]!))
      words[last] = `${words[last]}.${part}`;
    else words.push(part.toLowerCase() === "gpt" ? "GPT" : part[0]!.toUpperCase() + part.slice(1));
  }
  return words.join(" ").replace(/^GPT (\d)/, "GPT-$1");
}

function modelMark(id: string): string | undefined {
  if (/^(claude|sonnet|opus|haiku)/.test(id)) return "claude";
  if (/^(gpt|o\d|codex)/.test(id)) return "openai";
  return undefined;
}

/**
 * The model and its effort from a job's pick note ("Picked claude-sonnet-5-5 on main (simple;
 * effort medium)."), as display data the apps show without knowing any maker. A job without a pick
 * note has none, and neither does one where T3 started a different model than was picked: the
 * pick's model and effort would be wrong, so the note, which says so, stays the card's text.
 */
export function cloudAgentModelDisplay(note: string | null | undefined) {
  const picked = note?.match(/^Picked (\S+) on [^(]*\(/);
  if (!picked || /, T3 started /.test(note!)) return undefined;
  const name = modelName(picked[1]!);
  if (!name) return undefined;
  const mark = modelMark(picked[1]!.toLowerCase());
  const effort = note?.match(/[(;] effort ([^;)]+)/)?.[1]?.trim();
  return {
    name,
    ...(effort ? { effort: effort[0]!.toUpperCase() + effort.slice(1) } : {}),
    ...(mark ? { mark } : {}),
  } satisfies CloudAgentModelDisplay;
}
