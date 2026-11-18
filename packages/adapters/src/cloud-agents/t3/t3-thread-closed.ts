import { z } from "zod";

/** Older servers leave these out, which reads as a thread still open; so does a missing count. */
const closedSchema = z.object({
  thread: z.object({
    settled: z.boolean().default(false),
    archived: z.boolean().default(false),
    pendingRequestCount: z.number().optional(),
  }),
});

/** A thread read says the owner closed it: settled or archived, with no request still open. */
export function t3ThreadClosed(read: unknown): boolean {
  const { thread } = closedSchema.parse(read);
  return (thread.settled || thread.archived) && thread.pendingRequestCount === 0;
}
