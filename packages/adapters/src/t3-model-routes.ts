import { getLogger } from "@rakazo/logging";
import { z } from "zod";

const id = z.string().trim().min(1).max(200);
const route = z
  .object({
    instanceId: id,
    model: id,
    options: z
      .array(
        z.object({ id, value: z.union([z.string().max(200), z.number(), z.boolean()]) }).strict(),
      )
      .max(20)
      .optional(),
  })
  .strict();
const routes = z
  .object({
    hard: z.array(route).optional(),
    normal: z.array(route).optional(),
    simple: z.array(route).optional(),
    ui: z.array(route).optional(),
  })
  .strict();

/** The models to try for each kind of work, best first. */
export type T3ModelRoutes = z.infer<typeof routes>;

/**
 * Read `T3_MODEL_ROUTES`. Nothing is built in: an unset or invalid value turns routing off, so a
 * launch behaves as it does without it. The value is never logged.
 */
export function parseT3ModelRoutes(raw: string | undefined): T3ModelRoutes | undefined {
  if (!raw?.trim()) return undefined;
  try {
    return routes.parse(JSON.parse(raw));
  } catch {
    getLogger().warn("T3_MODEL_ROUTES is not valid; model routing is off");
    return undefined;
  }
}
