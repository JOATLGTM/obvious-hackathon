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

<!-- Honest placeholders — to be finalized with the session's actual narrative. -->

- (placeholder) Tooling friction consumed more cycles than code: several file
  writes failed on tooling validation and needed retries.
- (placeholder) The venv resolved to a newer Python minor than pinned in CI.
- (placeholder) Browser automation needed OS libraries installed before the
  first launch succeeded.

## What was overridden

- The design doc initially planned a fresh-context second-opinion review
  round; the user's zero-interaction directive traded it away for an
  adversarial self-review instead.
- An interactive confirmation flow was designed for ambiguous forks (fee
  basis, rounding); the user directed autonomous execution, so forks were
  decided and documented here and in the README instead of asked.
