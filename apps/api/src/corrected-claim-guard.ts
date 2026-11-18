import { assertNoAddedClaims } from "@rakazo/core";

/** The API's answer to a write that adds a claim a recorded correction has made false. */
export async function assertNoAddedClaimsOrBadRequest(
  before: string,
  after: string,
): Promise<void> {
  await assertNoAddedClaims(before, after);
}
