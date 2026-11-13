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
  completion wake is held back; the goal starts one deduplicated continuation Run instead
  (that Run stays in the bot's chat even with `CLOUD_AGENT_JOB_THREADS=1`).
  Paused, blocked, cancelled and completed goals hand wakes back to the owner.
- Pause, cancel, scope reapproval or the owner writing in the thread stop the current
  continuation. Its later writes are refused at the tool gate and any follow-up it queued
  but did not send is dropped.
- A turn without progress backs off (1 minute, then 5) and the third stops the goal with one
  durable notice.
- Any executing or uncertain write in the thread blocks further goal writes until it is
  reconciled. That includes the automatic follow-up: it is checked in the same transaction
  that records it, and while blocked the goal waits with the effect named in its blocker, then
  sends the follow-up once the effect settles. Permission denials never trigger a fallback.
- `scoped_goal_authorize` and `scoped_goal_control` always need explicit approval;
  `scoped_goal_status` is read-only; `scoped_goal_report` records evidence.

## Gates in code

Orchestration is code; the model only judges. The reconciler observes the current gate itself
and advances it, so a normal release takes no continuation Run.

- The periodic pass only finds due goals and gives each its own `scoped_goal.advance` job
  (keyed per goal), so one goal's slow remote check never holds back another's. A finishing
  agent nudges only its own goal's job. The goal row's version claim keeps two workers from
  advancing the same goal twice.

- Two built-in observations carry the evidence contract like any other tool: `agent_pull_request`
  (the managed thread's pull request, its state and, once merged, the merge commit) and
  `http_check` (a GET of an approved URL: status code and, for JSON, values at configured
  paths such as a deployed revision). Their results are checked with the same assertions as
  reported evidence and recorded with `source: "code"`, so goal history tells them apart from
  evidence a model reported.
- The provider reports the pull request. When it names no merge commit, a public repository
  is asked once per check for it, with a timeout and no credentials. Failing that, merge is
  recorded without a commit, and the deploy gate passes only on a revision the owner approved
  in the scope.
- `http_check` fetches only the URL its approved requirement names, under the same egress
  rules as web fetches: private and internal hosts are refused.
- When a gate passes, the agent gets one templated follow-up for the next (merge, then deploy
  with the merged commit, then install for `mdi`), sent through the normal follow-up path.
  Health is observed, not requested.
- A deploy must name the merged commit. One that names another revision is waited on, and
  once the agent has been idle past the stuck window the goal blocks with that reason.
- A finished-and-accepted report for an agent whose goal is still incomplete is refused,
  listing the missing evidence.
- A model turn starts only when the agent failed or has been idle past the window with the
  gate unobserved (or the gate has no code observation). The existing back-off and
  three-strike stop apply.
- The owner gets one notice when the goal completes (pull request, merged commit, deployed
  revision, live check) and one when it blocks; neither wakes a run.

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
- CI and review stay with the managed agent; the goal sees them only through the merge.
- The stuck window (10 minutes) and check interval (1 minute) are constants, not settings.
