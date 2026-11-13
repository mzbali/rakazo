# Scoped goals

A scoped goal keeps an owner's approved release scope alive across managed-agent turns,
restarts and missed wakes. It reuses Runs, external effects and the reconciler; it adds no
queue or framework.

## Contract

- The owner authorizes a goal by approving the `scoped_goal_authorize` request itself. The
  approval records who allowed it and when.
- The scope names an existing managed agent, repository and revision, the intent, the
  destinations and structured evidence requirements. A scope is immutable; changing it needs
  a new approval, which discards earlier evidence.
- Each evidence requirement names a recorded observation (tool and request) and assertions
  on its structured result. Prose from an agent never completes a goal.
- A completion wake only asks the reconciler to look at the goal. Only satisfied evidence
  completes a gate.
- While a goal drives its agent (active or waiting, current control epoch) the owner's normal
  completion wake is held back; the goal starts one deduplicated continuation Run instead.
  Paused, blocked, cancelled and completed goals hand wakes back to the owner.
- Pause, cancel, scope reapproval or the owner writing in the thread stop the current
  continuation. Its later writes are refused at the tool gate and any follow-up it queued
  but did not send is dropped.
- A turn without progress backs off (1 minute, then 5) and the third stops the goal with one
  durable notice.
- Any executing or uncertain write in the thread blocks further goal writes until it is
  reconciled. Permission denials never trigger a fallback.
- `scoped_goal_authorize` and `scoped_goal_control` always need explicit approval;
  `scoped_goal_status` is read-only; `scoped_goal_report` records evidence.

## Done

- Goal and append-only transition tables, encrypted and scoped per space (additive
  migration).
- Shared scope, report and control schemas; goal tools and their discovery.
- Continuation Runs, completion-wake integration, no-progress bound, control epochs and
  owner-intervention detection.

## Open questions

- Uncertain-effect recovery is conservative: a stale effect stops the goal after three turns
  rather than replaying it. Is that the wanted trade-off?
- Pause and cancel are checked at the tool gate, not at dispatch; a write already past the
  gate still runs.
- Remote provider fallback exists only as an instruction in the continuation prompt; there is
  no availability scheduler.
- A dropped goal follow-up can still produce one "finished" wake for the owner's bot.
- Automating the later gates (CI, review, merge, deploy) is out of scope here.
