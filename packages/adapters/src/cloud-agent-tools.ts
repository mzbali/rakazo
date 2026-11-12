import { cloudAgentHttpsUrl } from "@rakazo/core";
import { z } from "zod";

const image = z.union([
  z
    .object({
      url: z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password;
        }),
    })
    .strict(),
  z
    .object({
      data: z.string().min(1).max(20_000_000),
      mimeType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
    })
    .strict(),
]);
export const cloudAgentPromptSchema = z
  .object({
    prompt: z.string().trim().min(1).max(100_000),
    images: z.array(image).max(5).optional(),
  })
  .strict();
export const cloudAgentLaunchSchema = cloudAgentPromptSchema.extend({
  repository: z
    .string()
    .url()
    .refine((value) => Boolean(cloudAgentHttpsUrl(value)))
    .optional(),
  openPr: z.boolean().optional(),
  /** The bot's own name for one agreed request; launching it again returns the same agent. */
  requestKey: z.string().trim().min(1).max(120).optional(),
  /** What the owner agreed to, in their words, and how the result will be judged. */
  agreement: z.string().trim().min(1).max(4_000).optional(),
  acceptance: z.string().trim().min(1).max(4_000).optional(),
});
const idSchema = z.object({ id: z.string().trim().min(1) }).strict();
export const cloudAgentReportSchema = z
  .object({
    id: z.string().trim().min(1),
    verdict: z.enum(["accepted", "rejected", "needs_owner"]),
    summary: z.string().trim().min(1).max(4_000),
  })
  .strict();
export const cloudAgentReplySchema = cloudAgentPromptSchema.extend({
  id: z.string().trim().min(1),
});

/** Validate before effect logging: raw environment values must never enter durable tool args. */
export function validCloudAgentArgs(name: string, args: unknown): boolean {
  const schema =
    name === "cloud_agent_launch"
      ? cloudAgentLaunchSchema
      : name === "cloud_agent_reply"
        ? cloudAgentReplySchema
        : name === "cloud_agent_report"
          ? cloudAgentReportSchema
          : idSchema;
  return schema.safeParse(args).success;
}
