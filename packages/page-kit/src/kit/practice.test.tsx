// @vitest-environment jsdom
import type { ReactElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageLanguage } from "./labels.js";
import { Flashcards, Quiz } from "./practice.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  host.remove();
  vi.restoreAllMocks();
});

function render(element: ReactElement) {
  const root = createRoot(host);
  act(() => root.render(element));
}

const click = (element: Element | null) => act(() => (element as HTMLElement).click());
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((entry) => entry.textContent === name);
const option = (name: string) =>
  [...host.querySelectorAll(".rk-quiz-option")].find((entry) => entry.textContent?.includes(name));

const questions = [
  {
    question: "Is **P** inside NP?",
    options: ["No", "Yes"],
    answer: 1,
    explain: "What is fast to solve is fast to check.",
  },
  { question: "Does a short proof make it fast to find?", options: ["Yes", "No"], answer: 1 },
];

describe("Quiz", () => {
  it("draws nothing when a question has no real choice", () => {
    render(<Quiz questions={[{ question: "Only one", options: ["A"], answer: 0 }, null, "x"]} />);
    expect(host.querySelector(".rk-quiz")).toBeNull();
  });

  it("marks the pick, explains it, scores the round and can start again", () => {
    render(<Quiz questions={questions} />);
    expect(host.textContent).toContain("Question 1 of 2");
    expect(host.querySelector("strong")?.textContent).toBe("P");
    expect(button("Next")).toBeUndefined();

    click(option("No") ?? null);
    expect(host.querySelector(".rk-quiz-verdict")?.textContent).toBe("Incorrect");
    expect(host.querySelector('[data-mark="wrong"]')?.textContent).toContain("No");
    expect(host.querySelector('[data-mark="correct"]')?.textContent).toContain("Yes");
    expect(host.textContent).toContain("What is fast to solve is fast to check.");
    expect(option("No")?.getAttribute("aria-disabled")).toBe("true");
    click(option("Yes") ?? null);
    expect(host.querySelector(".rk-quiz-verdict")?.textContent).toBe("Incorrect");

    click(button("Next") ?? null);
    expect(host.textContent).toContain("Question 2 of 2");
    expect(host.querySelector(".rk-quiz-verdict")).toBeNull();
    click(option("No") ?? null);
    expect(host.querySelector(".rk-quiz-verdict")?.textContent).toBe("Correct");
    expect(host.querySelector(".rk-quiz-score")?.textContent).toContain("1 of 2");
    expect(button("Try again")).toBeTruthy();

    click(button("Try again") ?? null);
    expect(host.textContent).toContain("Question 1 of 2");
    expect(host.querySelector(".rk-quiz-verdict")).toBeNull();
    expect(host.querySelector(".rk-quiz-score")).toBeNull();
  });

  it("uses the page language for its own words", () => {
    render(
      <PageLanguage.Provider value="fr">
        <Quiz questions={[{ question: "Q", options: ["A", "B"], answer: 0 }]} />
      </PageLanguage.Provider>,
    );
    expect(host.textContent).toContain("Question 1 sur 1");
    click(option("A") ?? null);
    expect(host.textContent).toContain("Juste");
    expect(button("Recommencer")).toBeTruthy();
  });
});

const cards = [
  { front: "P", back: "Fast to solve" },
  { front: "NP", back: "Fast to check" },
];

describe("Flashcards", () => {
  it("flips, grades, moves with the arrow keys and shuffles", () => {
    render(<Flashcards cards={[...cards, { front: "", back: "nope" }, null]} />);
    const card = () => host.querySelector<HTMLButtonElement>(".rk-flash-card")!;
    const face = () => host.querySelector(".rk-flash-face")!.textContent;
    expect(host.textContent).toContain("1 of 2");
    expect(host.textContent).toContain("0 known");
    expect(face()).toBe("P");
    expect(card().textContent).toContain("Flip");

    click(card());
    expect(face()).toBe("Fast to solve");
    expect(card().getAttribute("aria-pressed")).toBe("true");

    click(button("Know") ?? null);
    expect(host.textContent).toContain("2 of 2");
    expect(host.textContent).toContain("1 known");
    expect(face()).toBe("NP");
    expect(card().getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(card());

    act(() => {
      card().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(face()).toBe("P");
    expect(button("Know")?.getAttribute("data-mark")).toBe("correct");

    click(button("Don't know") ?? null);
    expect(host.textContent).toContain("0 known");
    expect(face()).toBe("NP");

    act(() => {
      card().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(face()).toBe("P");
    vi.spyOn(Math, "random").mockReturnValue(0);
    click(button("Shuffle") ?? null);
    expect(face()).toBe("NP");
    expect(host.textContent).toContain("1 of 2");
  });

  it("names its actions in the page language", () => {
    render(
      <PageLanguage.Provider value="de">
        <Flashcards cards={[{ front: "A", back: "B" }]} />
      </PageLanguage.Provider>,
    );
    expect(button("Gewusst")).toBeTruthy();
    expect(button("Nicht gewusst")).toBeTruthy();
    expect(button("Mischen")).toBeTruthy();
    expect(host.textContent).toContain("Umdrehen");
  });
});
