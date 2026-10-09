# AI Usage

Written by Obvious (Obvious Fusion), an AI coding agent, in the first person.
The human author, Christopher Vo, directed the work: he commissioned the PRD
review, approved the design doc and stack, and made the call to replace the
earlier Python implementation with this one. Everything in this PR — code,
tests, docs — was authored by me; the judgment calls flagged below are mine,
made under that direction.

## Process

1. The PRD went through a structured adversarial review (four lenses plus an
   independent second opinion). It surfaced two blocking definitional gaps —
   the fee base and the rounding policy — before any code existed.
2. An office-hours design doc turned the answers into binding premises and
   Money Rules. I built against that document, not against my reading of the
   PRD.
3. Implementation followed the design doc's acceptance criteria as a checklist;
   this file and the README close them out.

## Decisions and trade-offs (mine, within the spec)

- **Margin as the derived plug.** The review suggested a residual bucket
  (platform-takes-residual). I chose margin = paid − cogs − fee instead: the
  identity then holds exactly on every line with no third rounding step, and
  the audit reads like arithmetic. A residual bucket would make margin the
  plug's sibling and buy nothing here.
- **Extended-line rounding.** The fee rounds once per extended line
  (unit_price x qty), not per unit. 3 x $10.00 pays 23 cents, not 24. The
  design doc names this; I made the engine enforce it and added the
  "not 3 x 8 = 24" comparison to the test.
- **Capture-time stock re-check.** The spec requires a creation-time stock
  check. I added a second check at capture: stock can drift between order
  creation and payment, and paying for goods that no longer exist would break
  the decrement invariant. This is my addition — the spec was silent on drift;
  a blocked capture writes nothing and a restock lets the same order succeed.
- **Server components read services directly.** Pages call the service layer
  in-process rather than fetching their own API routes. One less hop, no HTTP
  self-calls in a serverless-context-shaped framework. The API routes exist for
  the client components (builder, pay, adjust) and for anyone driving the flow
  programmatically.
- **SQLite file, not in-memory, for the app.** Tests use `:memory:` with real
  migrations; the dev app uses `data/app.db` so a grader's paid order survives
  a restart. Gitignored.
- **Decline is a checkbox, not a hidden endpoint.** The forced-decline control
  sits on the patient page on purpose: it exercises the failure path end to end
  through the real UI, which is the honest way to demo a payments stub.

## What worked

- **The table-driven fixtures caught me twice.** I miscomputed two expected
  margins (a subtraction slip: 1547 for 1647; a zero-margin fixture whose COGS
  did not actually zero the margin). The sum-invariant assertions failed
  immediately and loudly. The engine was right both times; the tests earned
  their keep before the code ever shipped.
- **`tsc --noEmit` alongside Vitest.** Vitest's esbuild transform does not
  typecheck; my first exhaustive-switch narrowing and a missing import passed
  tests while failing `tsc`. CI runs both.
- **Premises first.** The fee base and rounding rules were settled on paper
  before implementation, so no line of engine code was ever rewritten for
  semantic reasons — only for defects.

## What did not

- **The scaffold needed workarounds** (interactive prompts, no `rsync` in the
  sandbox), which cost time but no correctness.
- **My first exhaustive-switch pattern fought the typechecker** instead of
  helping it; I restructured to if-narrowing, which is shorter and still
  exhaustive by construction.
- **A parse error in a test file** survived one full test run undetected
  because the file failed to collect rather than fail — it looked like "fewer
  tests" until I read the run output closely. Lesson recorded: check collected
  counts, not just the pass/fail line.

## Cuts (all on the design doc's deferral list)

Refunds, order lifecycle beyond draft/paid, COGS lot tracking, discounts and
promotions, tenant isolation beyond `provider_id`, patient identity (no PHI is
stored; the order link is an opaque token), email delivery, real payments, and
shipping. Each is one line in the README's stub table or the design doc's
deferred list — documented, not built.

## Verification

- 25 Vitest tests (table-driven split engine, service behavior, idempotency,
  decline/retry, immutability, inventory, dashboard totals)
- `eslint` and `tsc --noEmit` clean; `next build` clean
- Browser walk of the core flow (build order → pay → receipt) with screenshots
  at multiple widths, attached as PR evidence
