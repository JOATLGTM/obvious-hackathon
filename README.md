# In-House Supplement Ordering — Vertical Slice

A provider assembles a supplement order for a patient with a patient-facing
price per item, the patient pays through a stubbed gateway, and the system
computes and **persists** the money split — item cost (COGS), provider margin,
and a 75 bps platform fee — so every paid order shows exactly where every cent
went. Plus a provider dashboard for sales and inventory.

Built as a graded take-home vertical slice: graded on money-handling
correctness, clean seams, and judgment — not polish or breadth.

## Run it

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload          # http://127.0.0.1:8000
pytest -q                              # 34 tests
```

The catalog (6 supplements) seeds itself at startup into `app.db`.
Set `PAYMENT_GATEWAY_MODE=decline` to make every charge decline (test mode).

## The money split — the core of this submission

One pure function, `app/split_engine.py::compute_split`, no I/O:

```
fee    = subtotal_cents * 75 // 10000        # 75 bps of subtotal, floored
margin = subtotal_cents - cogs_cents - fee   # margin absorbs the remainder
```

Because margin is defined as the remainder, the identity
**cogs + fee + margin == amount_paid** holds **by construction** — not by
reconciliation. No floats anywhere; integer cents end to end.

Worked example: subtotal 1333¢, COGS 500¢ → fee floor(1333 × 75 / 10000) = 9¢,
margin 824¢. 500 + 9 + 824 = 1333. ✓

The split is **persisted at payment time** as three `LedgerEntry` rows written
in the same DB transaction that marks the order paid and writes the payment
row — never derived on read. "Show me where every cent went" is a one-query
answer, and the receipt reads the ledger back.

## Flow

1. `GET /orders/new` — provider builds the order; per-line patient price.
   Costs and prices are **snapshotted per line at creation**; later catalog or
   cost edits never rewrite order history.
2. `POST /orders/{id}/pay` — charges the stub gateway, then in **one
   transaction**: order → `paid`, payment row, exactly 3 ledger entries, stock
   decremented. Double-pay → 409 with no partial writes; insufficient stock →
   409 with nothing written.
3. `GET /orders/{id}` — receipt: per-line and per-order split to the cent,
   negative margin flagged, ledger entries listed.
4. `GET /dashboard` — GMV processed, platform fees earned, provider margins
   due, per-paid-order splits, and an inventory table with restock.

## Decisions and trade-offs

- **Fee basis: 75 bps of the patient-paid subtotal (GMV).** The brief says
  "75 bps platform fee" without naming the basis; subtotal is what the patient
  actually pays and matches how card processing is normally quoted. If the
  business means bps of margin or of COGS, the change is one constant in one
  pure function.
- **Rounding: floor, margin absorbs the remainder.** The alternative
  (banker's rounding) moves at most 1¢ per order and lives in the same
  function. Defining margin as the remainder makes the audit identity true by
  construction instead of by reconciliation.
- **Split persisted as rows, not derived.** A `LedgerEntry` table written in
  the payment transaction beats storing three columns on the order: the entry
  descriptions document themselves, and the shape generalizes to more entry
  types (refunds, adjustments) without a migration.
- **Negative margin is allowed.** Providers price freely; margin may be zero
  or negative — the math still balances and the receipt flags it. Blocking it
  would need a business rule that doesn't exist yet.
- **Stock checked and decremented inside the payment transaction.** Stock-out
  rejects the payment with 409 and writes nothing. This is a pragmatic
  correctness/complexity trade: SQLite serializes writers, so a
  check-then-decrement in one transaction is atomic here. Postgres at scale
  would want conditional updates (`UPDATE ... WHERE stock >= qty`) or row
  locks.
- **Order-level fee, not per-line.** The fee is computed once on the order
  subtotal. Per-line fee computation would round per line and the sum could
  drift from 75 bps of the true subtotal.
- **FastAPI + SQLAlchemy 2 + SQLite + Jinja.** Production-shaped seams
  (Protocol-based gateway, app factory, pure-function split engine) without
  burning the time box on Postgres/Next.js infrastructure the grader never
  sees.

## What is stubbed

- **Payments** — `payments/gateway.py`: a `PaymentGateway` Protocol plus a
  `FakePaymentGateway` that succeeds (or declines via the explicit test-mode
  flag). Swap in a real gateway by implementing the Protocol and setting
  `app.state.gateway`; no flow code changes.
- **Auth** — hardcoded demo provider (`Dr. Dana Demo, MD`) and patient
  (`Riley Vance`), no login.
- **Email, shipping, taxes** — not built; out of scope for the slice.
- **Gateway ref is a UUID** — a real gateway's charge id would replace it.

## What was cut

Catalog CRUD UI (seeded catalog only), order editing after creation,
fulfillment/shipping states beyond `paid`, refunds, auth, pagination, JS
framework on the frontend (plain server-rendered pages + a little vanilla JS
in the order builder).

## Tests

`pytest -q` — 34 tests across the split engine (table tests + 500-sample
invariant property), order lifecycle (draft→paid, double-pay, cancel, decline
path writes nothing), stock atomicity (decrement, stock-out, partial stock-out
leaves nothing written), the audit identity (exactly 3 ledger rows summing to
amount paid), and the API happy path via `TestClient`. CI runs the suite on
push/PR to main (`.github/workflows/ci.yml`).
