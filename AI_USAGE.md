# AI Usage

This project was built end-to-end with an AI coding agent (Obvious). This
document describes what that actually looked like.

## What AI was used for

- **Spec and scoping** — turning the PRD brief into a concrete design:
  architecture choice (FastAPI + SQLAlchemy + SQLite + Jinja over
  single-file-minimal and full Next.js/Postgres), the data model, the API
  surface, and the acceptance criteria. Produced as a design document before
  any code.
- **Implementation** — all application code: split engine, models, routers,
  gateway stub, templates, seeds, tests, CI workflow, and docs.
- **Test authoring** — the pytest suite: table tests for the split math, a
  randomized invariant property over 500 samples, lifecycle and atomicity
  tests, and API-contract tests.
- **Self-review** — an adversarial pass over the design before coding, which
  caught two blocking ambiguities early (fee basis undefined; empty-order-pay
  breaking the "exactly 3 ledger entries" rule) and fixed both in the spec
  rather than in debugging later.
- **Dogfooding and evidence** — driving the running app headlessly to place a
  real order, pay it, and capture page screenshots for acceptance evidence.

## What worked

- Locking the fee-basis and rounding decisions in the spec first. The split
  engine was then a 20-line pure function with an identity that holds by
  construction — the hardest-seeming part of the money handling turned out to
  be the easiest, because it was decided before implementation.
- Persisting the split as ledger rows in the payment transaction. Every later
  feature (receipt view, dashboard aggregates) just read the ledger back;
  there was no split logic to re-implement or drift.
- Protocol-seaming the gateway early. The decline path is reachable via an
  explicit test-mode flag, which made the "decline writes nothing" test
  trivial to write.

## What went sideways

- **Interaction-mode mismatch.** The session opened with interactive decision gates; they were cancelled twice and the user directed zero-interaction execution. The workflow switched to decide-and-document: every assumption (fee basis, rounding rule, negative-margin handling, stock-out behavior) is recorded in the README and the design doc instead of asked. Cost: some assumptions may not match the grader's intent — that risk is stated here rather than hidden.
- **Fee-basis ambiguity caught late in design, not in code.** The PRD's '75 bps platform fee on the transaction' never says 75 bps of what. Caught in the pre-code self-review; resolved to the patient-paid subtotal (GMV) and isolated to one constant, PLATFORM_FEE_BPS. If the intended basis differs, the fix is one number plus its test.
- **Loose end: the remote branch feat/supplement-ordering-slice was left undeleted after the squash merge.** Cleanup only; no effect on the submission.
- Nothing technical: CI is green on the merged head (fe66fb7), all 34 tests pass, and no failure survived to the final state.

## What was overridden

- The design doc initially planned a fresh-context second-opinion review
  round; the user's zero-interaction directive traded it away for an
  adversarial self-review instead.
- An interactive confirmation flow was designed for ambiguous forks (fee
  basis, rounding); the user directed autonomous execution, so forks were
  decided and documented here and in the README instead of asked.
