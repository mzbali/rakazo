import type { CloudAgentQuestion } from "@rakazo/adapter-kit";
import { z } from "zod";

/** T3's pending questions, as `t3_pending_request` returns them, and the card's view of one. */
export const questionSchema = z.object({
  questions: z.array(
    z.object({
      id: z.string(),
      options: z.array(z.object({ label: z.string(), value: z.string().optional() })).default([]),
      multiSelect: z.boolean().optional(),
    }),
  ),
});
/** T3's pending question as `t3_pending_request` `read` returns it. */
const pendingQuestionSchema = z.object({
  id: z.string(),
  question: z.string().optional(),
  options: z.array(z.object({ label: z.string(), value: z.string().optional() })).default([]),
  multiSelect: z.boolean().optional(),
  allowCustomAnswer: z.boolean().optional(),
});
const questionPromptSchema = z.object({ questions: z.array(pendingQuestionSchema) });
const RECOMMENDED = /\s*\(recommended\)\s*$/i;
const MAX_OPTIONS = 4;

/**
 * T3's answer for one question: an offered option goes in as its value (its label when it has
 * none, "(Recommended)" included, as T3 matches it), in a list for a multiple-choice question;
 * anything else is the typed answer as it is.
 */
export function answerFor(
  question: z.infer<typeof questionSchema>["questions"][number],
  text: string,
): string | string[] {
  const chosen = question.options.find(
    (option) => option.label.trim().replace(RECOMMENDED, "") === text.trim(),
  );
  const answer = chosen ? (chosen.value ?? chosen.label) : text;
  return question.multiSelect ? [answer] : answer;
}

/**
 * What the card shows of a pending question: one-tap answers only for a single-choice question
 * alone in its request, the recommended one (T3 puts it first, its label ending "(Recommended)")
 * marked once.
 */
export function questionOf(value: unknown): CloudAgentQuestion | undefined {
  const parsed = questionPromptSchema.safeParse(value);
  const questions = parsed.success ? parsed.data.questions : [];
  const first = questions[0];
  if (!first) return undefined;
  const single = questions.length === 1 && !first.multiSelect;
  const options = single
    ? first.options
        .map((option) => option.label.trim())
        .filter(Boolean)
        .slice(0, MAX_OPTIONS)
        .map((label) => ({
          label: label.replace(RECOMMENDED, ""),
          ...(RECOMMENDED.test(label) ? { recommended: true } : {}),
        }))
    : [];
  return {
    ...(first.question ? { text: first.question } : {}),
    options,
    ...(first.allowCustomAnswer === false ? { allowCustomAnswer: false } : {}),
  };
}
