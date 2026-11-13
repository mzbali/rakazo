import { ORPCError } from "@orpc/server";
import { assertNoAddedClaims, CorrectedClaimError } from "@rakazo/core";

/** The API's answer to a write that adds a claim a recorded correction has made false. */
export async function assertNoAddedClaimsOrBadRequest(
  before: string,
  after: string,
): Promise<void> {
  try {
    await assertNoAddedClaims(before, after);
  } catch (error) {
    if (error instanceof CorrectedClaimError)
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    throw error;
  }
}
