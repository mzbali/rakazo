import { describe, expect, it } from "vitest";
import { ScopedGoalScope } from "./scoped-goals.js";

const scope = {
  agentId: "tracked",
  repository: "https://example.test/repo",
  revision: "abc",
  pullRequests: [],
  intent: "md",
  deployment: "test",
  work: "Ship change",
  requirements: ["merge", "health", "deploy"].map((gate) => ({
    id: gate,
    gate,
    revisionCheck: gate === "merge",
    tool: "read_release",
    request: {},
    assertions: [{ path: ["revision"], equals: "abc" }],
  })),
};
describe("scoped release evidence contract", () => {
  it("does not equate healthy containers with a verified deployment", () => {
    expect(
      ScopedGoalScope.safeParse({ ...scope, requirements: scope.requirements.slice(0, 2) }).success,
    ).toBe(false);
  });
  it("includes installation only for mdi with an explicit target", () => {
    const install = {
      ...scope.requirements[0],
      id: "install",
      gate: "install",
      revisionCheck: false,
    };
    expect(ScopedGoalScope.safeParse(scope).success).toBe(true);
    expect(ScopedGoalScope.safeParse({ ...scope, intent: "mdi" }).success).toBe(true);
    expect(
      ScopedGoalScope.safeParse({ ...scope, requirements: [...scope.requirements, install] })
        .success,
    ).toBe(false);
    expect(
      ScopedGoalScope.safeParse({
        ...scope,
        intent: "mdi",
        installTarget: "device",
        requirements: [...scope.requirements, install],
      }).success,
    ).toBe(true);
  });
});
