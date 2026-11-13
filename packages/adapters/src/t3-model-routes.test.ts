import { describe, expect, it } from "vitest";
import { parseT3ModelRoutes } from "./t3-model-routes.js";

describe("parseT3ModelRoutes", () => {
  it("reads ordered routes per kind", () => {
    const routes = {
      hard: [
        { instanceId: "a", model: "m1" },
        { instanceId: "b", model: "m2" },
      ],
    };
    expect(parseT3ModelRoutes(JSON.stringify(routes))).toEqual(routes);
  });

  it("is off when unset, blank, not JSON, or not the shape", () => {
    for (const raw of [undefined, "", "  ", "{", "[]", '{"hard":[{"model":"m"}]}', '{"easy":[]}'])
      expect(parseT3ModelRoutes(raw)).toBeUndefined();
  });
});
