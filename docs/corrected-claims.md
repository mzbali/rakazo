# Corrected claim checking

Checking is off by default. Set `RAKAZO_CORRECTED_CLAIMS_ENABLED=true` in the API and worker environment to opt in. After credentials initialize, checking uses the current member's main model selection for the current space, with the same scoped stored-credential resolver as agent runs. It never selects another member's connection. Missing member context, model selection or credentials leaves the assessment unqualified and refuses the write. No additional service is required.

The selected connection receives the complete before and after documents, including any private instructions, skills or memory they contain. Operators must assess that data boundary before enabling the flag; members must use a main connection suitable for those documents. The environment-only judge remains available for isolated operator calibration with the generic deployment connection; server writes use the member-scoped selection.

The versioned core rubric and calibration corpus compare new assertions against recorded shipped corrections. Inherited claims, historical descriptions and corrective quotations are distinguished from newly asserted contradictions. Enabled writes require an accepted structured verdict. Errors, missing credentials, malformed output and timeouts are unqualified and refuse the write; an unconfigured installation remains usable and is explicitly unchecked.

Instruction assessments run before transactions and are bound to both documents under the row lock. Skill and memory updates retain content/revision compare-and-swap checks. Restoring saved instruction history, account backups and bot duplication retain historical text without reassessment. Subsequent guarded edits assess the complete before and after documents. These historical exemptions do not certify old content.

Judge usage is emitted separately as structured `corrected-claims` operations. Offline tests script structured verdicts and assert persistence effects; they do not establish model accuracy. Before enabling in production, run every versioned calibration example through the configured model and review mismatches, logging judge usage separately. Live calibration is a deployment acceptance gate, not an offline test pass.

Run opt-in live calibration with `RAKAZO_CLAIMS_CALIBRATE=true pnpm exec vitest run packages/adapters/src/corrected-claims.live.test.ts` in the configured server environment. The default offline run skips these model calls. The initial corpus is a reviewable expected-label set; offline contract checks do not certify its accuracy with any model.
