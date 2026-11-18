import type { AdapterContext, CloudAgentProvider } from "@rakazo/adapter-kit";
import { CloudAgentRequestRejected, CloudAgentRetryLater } from "@rakazo/adapter-kit";
import { retry } from "@rakazo/core";
import { getLogger } from "@rakazo/logging";

const ATTEMPTS = 3;
const BACKOFF_MS = 1_000;

/** Connections whose refusal was already logged, so a scope the owner left off logs once. */
const refusedConnections = new Set<string>();

/**
 * Tidies the provider's own record of a job once its work is accepted. Housekeeping only: it
 * retries a transient error a few times, then gives up, and never throws, so it cannot change
 * the verdict or wake anyone. Call it once, from the report that recorded the verdict.
 */
export async function settleAcceptedCloudAgent(
  connection: { key: string; provider: CloudAgentProvider },
  remoteId: string | null,
  context: AdapterContext,
  backoffMs = BACKOFF_MS,
): Promise<void> {
  const { provider } = connection;
  if (!remoteId || !provider.settle) return;
  const settle = provider.settle.bind(provider);
  try {
    await retry(
      async () => {
        try {
          await settle(remoteId, context);
        } catch (error) {
          // Refused outright: the connection lacks the permission, or the thread is gone.
          if (error instanceof CloudAgentRequestRejected && error.reason === "not_found") return;
          if (error instanceof CloudAgentRequestRejected) {
            if (!refusedConnections.has(connection.key)) {
              refusedConnections.add(connection.key);
              getLogger().warn(
                "cloud agent thread could not be settled; check the connection's scope",
              );
            }
            return;
          }
          if (error instanceof CloudAgentRetryLater) throw error;
          getLogger().warn("cloud agent thread was not settled");
        }
      },
      {
        attempts: ATTEMPTS,
        delayMs: (attempt) => backoffMs * (attempt + 1),
        retryable: (error) => error instanceof CloudAgentRetryLater,
      },
    );
  } catch (error) {
    if (error instanceof CloudAgentRetryLater)
      getLogger().warn("cloud agent thread was not settled");
  }
}
