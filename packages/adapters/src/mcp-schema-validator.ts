import type {
  JsonSchemaType,
  JsonSchemaValidator,
  jsonSchemaValidator,
} from "@modelcontextprotocol/sdk/validation";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";

/** Distinct output schemas kept before starting over; far above any one server's tool count. */
const MAX_CACHED_SCHEMAS = 1_000;

/**
 * The SDK compiles every tool's output schema on each `tools/list`, and Ajv keeps each compiled
 * schema for the life of its instance, keyed by object identity. A long-lived session that lists
 * tools on every call therefore grew without bound. Reuse a validator for the same schema
 * content, and drop the Ajv instance with the cache when a server's schemas keep changing.
 */
export class CachedJsonSchemaValidator implements jsonSchemaValidator {
  private ajv = new AjvJsonSchemaValidator();
  private readonly validators = new Map<string, JsonSchemaValidator<unknown>>();

  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    const key = JSON.stringify(schema);
    const cached = this.validators.get(key);
    if (cached) return cached as JsonSchemaValidator<T>;
    if (this.validators.size >= MAX_CACHED_SCHEMAS) {
      this.validators.clear();
      this.ajv = new AjvJsonSchemaValidator();
    }
    const validator = this.ajv.getValidator<T>(schema);
    this.validators.set(key, validator as JsonSchemaValidator<unknown>);
    return validator;
  }
}
