import { VISUAL_SUMMARY_MAX_LENGTH } from "../visual-fence/visual-catalog.js";

const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/;
const ENTITY = /&(lt|gt|amp|quot);/g;
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"' };

/**
 * The `summary` written in the opening `<Visual summary="…">` of a fence body, read with no
 * parser: only that tag, only a plain string, only once its `>` has arrived. Undefined when the
 * tag is unfinished, has no summary, or the summary is empty or too long to be one.
 */
export function visualFenceSummary(body: string): string | undefined {
  const start = body.search(/\S/);
  if (start < 0 || !body.startsWith("<Visual", start) || !/[\s>/]/.test(body[start + 7] ?? "")) {
    return undefined;
  }
  let at = start + 7;
  let summary: string | undefined;
  while (at < body.length) {
    const char = body[at]!;
    if (char === ">") break;
    if (char === '"') {
      const close = body.indexOf('"', at + 1);
      if (close < 0) return undefined;
      at = close + 1;
    } else if (char === "{") {
      for (let depth = 0; at < body.length; at++) {
        const next = body[at]!;
        if (next === '"' || next === "'") {
          for (at++; at < body.length && body[at] !== next; at++) if (body[at] === "\\") at++;
        } else if (next === "{") depth++;
        else if (next === "}" && --depth === 0) break;
      }
      at++;
    } else if (/\s/.test(char) || (char === "/" && body[at + 1] === ">")) {
      at++;
    } else {
      const name = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(body.slice(at, at + 40))?.[0];
      if (!name) return undefined;
      at += name.length;
      const quoted = name === "summary" && body[at] === "=" && body[at + 1] === '"';
      if (quoted) {
        const close = body.indexOf('"', at + 2);
        if (close < 0) return undefined;
        summary = body.slice(at + 2, close).replace(ENTITY, (_all, key: string) => ENTITIES[key]!);
        at = close + 1;
      } else if (body[at] === "=") at++;
    }
  }
  if (at >= body.length) return undefined;
  const text = summary?.replace(/\s+/g, " ").trim();
  return text && text.length <= VISUAL_SUMMARY_MAX_LENGTH ? text : undefined;
}

/** `[visual: summary]`, or `[visual]` when the fence has no usable summary yet or at all. */
export function visualFence(body: string): string {
  const summary = visualFenceSummary(body);
  return summary ? `[visual: ${summary}]` : "[visual]";
}

/**
 * Every ```ui fence in `text` as `[visual: summary]`, closed or not: an unclosed one runs to the
 * end, as a reply cut off mid-fence does. Other fences are left as written, and a ```ui inside
 * one of them is only text.
 */
export function foldVisualFences(text: string): string {
  if (!/^ {0,3}(`{3,}|~{3,}) *ui *$/m.test(text)) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  let fence: { mark: string; ui: boolean; body: string[] } | undefined;
  for (const line of lines) {
    if (!fence) {
      const opening = OPEN_FENCE.exec(line);
      const info = opening?.[2]?.trim();
      const mark = opening?.[1];
      if (!mark || (mark[0] === "`" && opening[2]?.includes("`"))) {
        out.push(line);
        continue;
      }
      fence = { mark, ui: info === "ui", body: [] };
      if (!fence.ui) out.push(line);
      continue;
    }
    const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
    if (closing && closing[0] === fence.mark[0] && closing.length >= fence.mark.length) {
      if (fence.ui) out.push(visualFence(fence.body.join("\n")));
      else out.push(line);
      fence = undefined;
    } else if (fence.ui) fence.body.push(line);
    else out.push(line);
  }
  if (fence?.ui) out.push(visualFence(fence.body.join("\n")));
  return out.join("\n");
}
