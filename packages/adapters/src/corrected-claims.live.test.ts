import { CORRECTED_CLAIMS_CALIBRATION } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import { deploymentCorrectedClaimJudge } from "./corrected-claims.js";
import { resolveDeploymentModel } from "./deployment-model.js";

describe.skipIf(process.env.RAKAZO_CLAIMS_CALIBRATE !== "true")(
  "live claim rubric calibration",
  () => {
    it.each(CORRECTED_CLAIMS_CALIBRATION)(
      "$after",
      async ({ before, after, status }) => {
        expect(
          resolveDeploymentModel().configured,
          "A configured deployment connection is required",
        ).toBe(true);
        const assessment = await deploymentCorrectedClaimJudge({ before, after });
        expect(assessment.status, assessment.reason).toBe(status);
      },
      35000,
    );
  },
);
