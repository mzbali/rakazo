# Corrected claim checking

Checking is off by default. Set `RAKAZO_CORRECTED_CLAIMS_ENABLED=true` in the API and worker environment to opt in. It reuses the existing generic deployment model connection, including configured local models; no additional service is required. The selected connection receives full before and after documents, so use a connection suitable for that data.

The versioned core rubric and calibration corpus compare new assertions against recorded shipped corrections. Inherited claims, historical descriptions and corrective quotations are distinguished from newly asserted contradictions. Enabled writes require an accepted structured verdict. Errors, missing credentials, malformed output and timeouts are unqualified and refuse the write; an unconfigured installation remains usable and is explicitly unchecked.

Instruction assessments run before transactions and are bound to both documents under the row lock. Skill and memory updates retain content/revision compare-and-swap checks. Restoring saved instruction history retains the existing exemption.

Judge usage is emitted separately as structured `corrected-claims` operations. Offline tests script structured verdicts and assert persistence effects; they do not establish model accuracy. Before enabling in production, run every versioned calibration example through the configured model and review mismatches, logging judge usage separately. Live calibration is a deployment acceptance gate, not an offline test pass.

Run opt-in live calibration with `RAKAZO_CLAIMS_CALIBRATE=true pnpm exec vitest run packages/adapters/src/corrected-claims.live.test.ts` in the configured server environment. The default offline run skips these model calls. The initial corpus is a reviewable expected-label set; offline contract checks do not certify its accuracy with any model.
