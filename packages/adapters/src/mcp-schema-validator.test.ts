import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpJsonSchemaValidator } from "./mcp-output-schema.js";
import { CachedJsonSchemaValidator } from "./mcp-schema-validator.js";
import { McpSession } from "./mcp-transport.js";

// A fresh object each time, as every `tools/list` response parses new schema objects.
const outputSchema = () => ({
  type: "object" as const,
  properties: { count: { type: "number" } },
  required: ["count"],
});

afterEach(() => vi.restoreAllMocks());

describe("CachedJsonSchemaValidator", () => {
  it("compiles a schema once however many listings repeat it", () => {
    const compile = vi.spyOn(AjvJsonSchemaValidator.prototype, "getValidator");
    const validator = new CachedJsonSchemaValidator();
    for (let listing = 0; listing < 200; listing += 1) validator.getValidator(outputSchema());
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it("caches repaired output schemas across repeated tool listings", () => {
    const compile = vi.spyOn(AjvJsonSchemaValidator.prototype, "getValidator");
    const validator = createMcpJsonSchemaValidator();
    const schema = () => ({ type: "string" as const, pattern: "\\:" });
    const first = validator.getValidator(schema());
    for (let listing = 0; listing < 200; listing += 1) {
      expect(validator.getValidator(schema())).toBe(first);
    }
    expect(compile).toHaveBeenCalledTimes(2);
    expect(first("value").valid).toBe(true);
    expect(first(42).valid).toBe(false);
  });

  it("still validates tool output", () => {
    const validate = new CachedJsonSchemaValidator().getValidator(outputSchema());
    expect(validate({ count: 3 })).toMatchObject({ valid: true, data: { count: 3 } });
    expect(validate({ count: "3" }).valid).toBe(false);
  });

  it("starts over instead of growing when schemas keep changing", () => {
    const compile = vi.spyOn(AjvJsonSchemaValidator.prototype, "getValidator");
    const validator = new CachedJsonSchemaValidator();
    for (let n = 0; n < 1_001; n += 1)
      validator.getValidator({ type: "object", properties: { [`f${n}`]: { type: "string" } } });
    // The first schema was dropped with the full cache, so it compiles again.
    validator.getValidator({ type: "object", properties: { f0: { type: "string" } } });
    expect(compile).toHaveBeenCalledTimes(1_002);
  });

  it("is what an MCP session's client validates with", () => {
    const client = new McpSession().client as unknown as { _jsonSchemaValidator: unknown };
    expect(client._jsonSchemaValidator).toBeInstanceOf(CachedJsonSchemaValidator);
  });
});
