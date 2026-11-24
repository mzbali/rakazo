import { useEffect, useId, useRef, useState } from "react";
import { Inline } from "./inline.js";
import { useWords } from "./labels.js";

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? text : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** A model sometimes quotes the index. Anything else is not an option. */
function answerIndex(value: unknown, length: number): number | undefined {
  const index =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  return Number.isInteger(index) && index >= 0 && index < length ? index : undefined;
}

type QuizItem = { question: string; options: string[]; answer: number; explain?: string };

function questionsOf(value: unknown): QuizItem[] {
  if (!Array.isArray(value)) return [];
  const items: QuizItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as {
      question?: unknown;
      options?: unknown;
      answer?: unknown;
      explain?: unknown;
    };
    const question = textOf(record.question);
    const options = Array.isArray(record.options)
      ? record.options.flatMap((option) => {
          const text = textOf(option);
          return text ? [text] : [];
        })
      : [];
    const answer = answerIndex(record.answer, options.length);
    if (!question || options.length < 2 || answer === undefined) continue;
    const explain = textOf(record.explain);
    items.push(explain ? { question, options, answer, explain } : { question, options, answer });
  }
  return items;
}

type Mark = "correct" | "wrong";

export function Quiz({ questions }: { questions?: unknown }) {
  const words = useWords();
  const items = questionsOf(questions);
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [round, setRound] = useState(0);
  const focusNext = useRef(false);
  const firstOption = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    firstOption.current?.focus();
  }, [step, round]);

  if (items.length === 0) return null;
  const at = step >= 0 && step < items.length ? step : 0;
  const item = items[at]!;
  const answered = picked !== null;
  const right = answered && picked === item.answer;
  const last = at === items.length - 1;

  return (
    <div className="rk-quiz">
      <p className="rk-quiz-progress">
        {words.t("quizProgress", { n: at + 1, total: items.length })}
      </p>
      <p className="rk-quiz-question" id={questionId}>
        <Inline>{item.question}</Inline>
      </p>
      <fieldset className="rk-quiz-options" aria-labelledby={questionId}>
        {item.options.map((option, index) => {
          const mark: Mark | undefined = !answered
            ? undefined
            : index === item.answer
              ? "correct"
              : index === picked
                ? "wrong"
                : undefined;
          return (
            <button
              key={index}
              ref={index === 0 ? firstOption : undefined}
              type="button"
              className="rk-quiz-option"
              data-mark={mark}
              // Stays in the tab order so the right and wrong options can still be read.
              aria-disabled={answered || undefined}
              aria-pressed={index === picked ? true : undefined}
              onClick={() => {
                if (answered) return;
                setPicked(index);
                if (index === item.answer) setCorrectCount((count) => count + 1);
              }}
            >
              {mark ? (
                <span className="rk-visually-hidden">
                  {words.t(mark === "correct" ? "correct" : "incorrect")}{" "}
                </span>
              ) : null}
              <Inline>{option}</Inline>
            </button>
          );
        })}
      </fieldset>
      {answered ? (
        <div className="rk-quiz-feedback" role="status">
          <p className="rk-quiz-verdict" data-mark={right ? "correct" : "wrong"}>
            {words.t(right ? "correct" : "incorrect")}
          </p>
          {item.explain ? (
            <p className="rk-quiz-explain">
              <Inline>{item.explain}</Inline>
            </p>
          ) : null}
          {last ? (
            <p className="rk-quiz-score">
              <span className="rk-visually-hidden">{words.t("score")} </span>
              {words.t("scoreOf", { correct: correctCount, total: items.length })}
            </p>
          ) : null}
        </div>
      ) : null}
      {answered ? (
        <button
          type="button"
          className="rk-button"
          data-variant="primary"
          onClick={() => {
            focusNext.current = true;
            if (last) {
              setRound((value) => value + 1);
              setStep(0);
              setPicked(null);
              setCorrectCount(0);
            } else {
              setStep(at + 1);
              setPicked(null);
            }
          }}
        >
          {words.t(last ? "tryAgain" : "next")}
        </button>
      ) : null}
    </div>
  );
}

type Card = { front: string; back: string };

function cardsOf(value: unknown): Card[] {
  if (!Array.isArray(value)) return [];
  const cards: Card[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { front?: unknown; back?: unknown };
    const front = textOf(record.front);
    const back = textOf(record.back);
    if (front && back) cards.push({ front, back });
  }
  return cards;
}

function shuffled(count: number): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    const next = order[index]!;
    order[index] = order[swap]!;
    order[swap] = next;
  }
  return order;
}

export function Flashcards({ cards }: { cards?: unknown }) {
  const words = useWords();
  const items = cardsOf(cards);
  const [order, setOrder] = useState<number[]>([]);
  const [at, setAt] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [marks, setMarks] = useState<Record<number, "know" | "dont">>({});
  const [focusTick, setFocusTick] = useState(0);
  const cardRef = useRef<HTMLButtonElement>(null);
  const deck = order.length === items.length ? order : items.map((_, index) => index);
  const place = deck.length === 0 ? 0 : ((at % deck.length) + deck.length) % deck.length;
  const cardIndex = deck[place] ?? 0;
  const card = items[cardIndex];
  const known = items.reduce((count, _, index) => (marks[index] === "know" ? count + 1 : count), 0);
  useEffect(() => {
    if (focusTick === 0) return;
    cardRef.current?.focus();
  }, [focusTick]);

  if (!card) return null;
  const mark = marks[cardIndex];
  const go = (delta: number) => {
    setAt((deck.length + place + delta) % deck.length);
    setFlipped(false);
  };
  const grade = (next: "know" | "dont") => {
    setMarks((prev) => ({ ...prev, [cardIndex]: next }));
    go(1);
    setFocusTick((tick) => tick + 1);
  };

  return (
    <div className="rk-flash">
      <p className="rk-flash-progress">
        <span>{words.t("cardOf", { n: place + 1, total: items.length })}</span>
        <span>{words.t("known", { count: known })}</span>
      </p>
      <button
        ref={cardRef}
        type="button"
        className="rk-flash-card"
        aria-pressed={flipped}
        onClick={() => setFlipped((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
          event.preventDefault();
          go(event.key === "ArrowRight" ? 1 : -1);
        }}
      >
        <span className="rk-visually-hidden">{words.t("flip")} </span>
        <span className="rk-flash-face">
          <Inline>{flipped ? card.back : card.front}</Inline>
        </span>
      </button>
      <div className="rk-flash-actions">
        <button
          type="button"
          className="rk-button"
          data-mark={mark === "know" ? "correct" : undefined}
          onClick={() => grade("know")}
        >
          {words.t("know")}
        </button>
        <button
          type="button"
          className="rk-button"
          data-mark={mark === "dont" ? "wrong" : undefined}
          onClick={() => grade("dont")}
        >
          {words.t("dontKnow")}
        </button>
        <button
          type="button"
          className="rk-button"
          onClick={() => {
            setOrder(shuffled(items.length));
            setAt(0);
            setFlipped(false);
            setFocusTick((tick) => tick + 1);
          }}
        >
          {words.t("shuffle")}
        </button>
      </div>
    </div>
  );
}

export const PRACTICE_CSS = `
.rk-quiz,.rk-flash{display:flex;flex-direction:column;gap:.75rem;min-width:0}
.rk-quiz-progress,.rk-flash-progress{margin:0;font-size:.875rem;line-height:1.25rem;color:var(--rk-secondary);font-variant-numeric:tabular-nums}
.rk-flash-progress{display:flex;justify-content:space-between;gap:1rem}
.rk-quiz-question{margin:0;font-size:1rem;line-height:1.45;font-weight:500;overflow-wrap:anywhere}
.rk-quiz-options{display:flex;flex-direction:column;gap:.5rem;min-width:0;margin:0;padding:0;border:0;min-inline-size:0}
.rk-quiz-option,.rk-flash-card{position:relative;appearance:none;width:100%;margin:0;border:1px solid var(--rk-line);border-radius:12px;background:transparent;color:inherit;font:inherit;font-size:1rem;line-height:1.4;text-align:start;cursor:pointer;overflow-wrap:anywhere}
.rk-quiz-option{display:block;min-height:2.75rem;padding:.625rem .75rem}
.rk-quiz-option:hover:not([aria-disabled="true"]){background:var(--rk-fill)}
.rk-quiz-option[data-mark="correct"]{border-color:var(--rk-success);color:var(--rk-success)}
.rk-quiz-option[data-mark="wrong"]{border-color:var(--rk-danger);color:var(--rk-danger)}
.rk-quiz-option[aria-disabled="true"]{cursor:default}
.rk-quiz-option:focus-visible,.rk-flash-card:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.rk-quiz-feedback{display:flex;flex-direction:column;gap:.35rem}
.rk-quiz-verdict,.rk-quiz-explain,.rk-quiz-score{margin:0}
.rk-quiz-verdict{font-weight:500}
.rk-quiz-verdict[data-mark="correct"]{color:var(--rk-success)}
.rk-quiz-verdict[data-mark="wrong"]{color:var(--rk-danger)}
.rk-quiz-explain{color:var(--rk-secondary);overflow-wrap:anywhere}
.rk-quiz-score{font-size:1.5rem;line-height:1.875rem;font-weight:500;letter-spacing:-.016em;font-variant-numeric:tabular-nums}
.rk-flash-card{display:flex;align-items:center;min-height:8.5rem;padding:1rem;background:var(--card)}
.rk-flash-face{min-width:0;overflow-wrap:anywhere}
.rk-flash-actions{display:flex;flex-wrap:wrap;gap:.5rem}
.rk-flash-actions .rk-button[data-mark="correct"]{color:var(--rk-success)}
.rk-flash-actions .rk-button[data-mark="wrong"]{color:var(--rk-danger)}
@media (prefers-reduced-motion:reduce){.rk-quiz-option,.rk-flash-card{transition:none}}
`;
