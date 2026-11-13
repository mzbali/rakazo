# Scoped continuation

Goal: retain an owner's exact approved release scope across managed-agent turns,
process restarts and missed wakes. Reuse Runs, external effects and reconciliation.
No live migration or deployment is part of this implementation task.

## Contract

- Authorization is an exact, authenticated approval of the goal tool request.
- Scope includes an existing managed agent, repository/revision, md/mdi intent,
  destinations and structured evidence requirements. Scope is immutable.
- Each evidence requirement identifies a recorded observation tool/request and
  structured result assertions. Prose is never completion evidence.
- Wakes only request reconciliation. Only satisfied evidence completes a goal.
- Unknown writes block for reconciliation; permission denials never trigger fallback.
- Pause/cancel stop future dispatch, not already dispatched external work.

## Done in pass 2

- A goal suppresses the owner's normal completion wake only while it drives the agent
  (active/waiting, current control epoch). Paused, blocked, cancelled and completed goals
  hand wakes back to the owner (previously any goal row silenced them for good).
- Follow-ups queued by a goal continuation carry its Run id; the poller drops one unsent
  if the goal stopped or that Run was superseded. The owner's own follow-ups are untouched.
  Fixed a bug found by the test: the strict follow-up schema rejected the marker key.
- Control actions and scope reapproval clear the active continuation; its later writes
  are refused at the tool gate (superseded Runs count as stopped).
- Finished continuations are settled in their own step: the Run status and failure
  reason go into goal history; no-progress turns back off 1 min, then 5 min; the third
  stops the goal with one durable notice. Waiting goals keep their reset time.
- One goal's failure no longer aborts the reconcile pass for other goals.
- Regressions: pause/resume/cancel, owner intervention, unapproved control, scope
  reapproval needing a new approval, failure reason/backoff/exhaustion, and the
  stopped-goal follow-up through the real poller.

## Open

- All work is uncommitted. No PR, commit, live migration, deploy or install yet.
- Uncertain-effect recovery is conservative: any executing/uncertain effect in the thread
  blocks goal writes until reconciled. A stale effect stops the goal (after three
  turns) rather than replaying. Owner decides whether that is the wanted trade-off.
- Pause/cancel is checked at the tool gate, not at dispatch; a write already past the
  gate when the owner pauses still runs (matches the contract).
- Remote provider fallback is only instructed in the continuation prompt; there is no
  availability scheduler. Do not claim quota-aware remote fallback.
- A dropped goal follow-up still lets the owner's bot get one "finished" wake for it.
- Not run: suites needing an admin database login (job queue, migrations, realtime).

## Compact handoff

Owner authorized local implementation and tests after read-only mapping/research.
One agent only. The existing managed-agent bridge was verified enabled before edits.
Reuse existing managed agent/Run/effect/job/reconciler, no new queue/framework.

Implemented so far: shared scope/report/control schemas; encrypted, tenant-scoped
goal and append-only transition tables; authenticated approval provenance columns
on external effects (set by the existing answer path); goal tools and discovery;
transactional deduplicated continuation Runs; completion-wake/reconciler integration;
three-attempt no-progress bound; separate merge/health/deploy/install evidence;
long cooldown persistence; control epochs and owner-message intervention detection;
explicit scope reapproval invalidates prior evidence. Inspect the diff for details.

Verification after pass 2: contracts, core, db and adapters typecheck; all offline
tests in those packages pass; 396 PostgreSQL tests pass, including 7 goal tests and
all cloud-agent suites. The 22 remaining database failures need an admin login.

Local dependencies were installed from the frozen lockfile. The additive migration
was applied only to a temporary local PostgreSQL instance, never a live database.
The temporary instance was stopped for compaction. Local
verification commands and connection details remain in this thread's tool history,
not in public documentation. Do not publish test logs containing local identities.
