import { z } from "zod";

/** Older servers leave these out, which reads as a thread still open; so does a missing count. */
const closedSchema = z.object({
  thread: z.object({
    settled: z.boolean().default(false),
    archived: z.boolean().default(false),
    pendingRequestCount: z.number().optional(),
  }),
});

/**
 * A thread read says the owner closed it: settled or archived, with no request still open. A read
 * of any other shape says nothing about the owner.
 */
export function t3ThreadClosed(read: unknown): boolean {
  const parsed = closedSchema.safeParse(read);
  if (!parsed.success) return false;
  const { thread } = parsed.data;
  return (thread.settled || thread.archived) && thread.pendingRequestCount === 0;
}
