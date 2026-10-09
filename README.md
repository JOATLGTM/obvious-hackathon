# Supplement Ops — in-house ordering with an auditable split

A vertical slice of in-house supplement ordering for clinical practices: a
provider assembles an order, the patient pays through a link, and the system
persists an exact, immutable split of every cent — COGS, provider margin, and a
75 bps platform fee — plus a dashboard for sales and inventory.

The audit surface is the product: look at a paid order and see exactly where
every cent went, per line, in integer cents, with `cogs + margin + fee ==
patient paid` enforced by tests.

## Run it

```bash
npm install
npm run setup   # migrate + seed the SQLite database (data/app.db)
npm run dev     # http://localhost:3000
```

Then: **Dashboard → New order** → set patient prices → **Create order** → copy
the payment link → open it (the patient view) → **Pay**. The paid order renders
the split receipt.

## The flow

| Step | Surface | What happens |
|---|---|---|
| 1 | `/orders/new` | Provider picks catalog items, sets per-line patient price, quantity. Unit COGS and the item name are **frozen onto the line at creation**. |
| 2 | `/orders/{id}` (draft) | Shows the order and an in-app opaque-token payment link. **STUB: delivery** — copy the link by hand; no email is sent. |
| 3 | `/pay/{token}` | Patient-facing. Pays via the stub gateway. A decline writes nothing; a retry succeeds. |
| 4 | `/orders/{id}` (paid) | The split receipt, read from persisted `split_entries` — never recomputed. |
| 5 | `/` (dashboard) | Sold orders, platform totals, inventory, manual adjustments recorded as `inventory_events`. |

## Money rules

- All money is **integer cents** (USD). Floats never touch money.
- The fee is **75 bps of the patient-paid extended line total**
  (`unit_price x qty`), `round_half_up` per line. Extending before rounding is
  the base-consistent choice: 3 x $10.00 pays **23 cents** of fee, not 3 x 8 = 24.
- Provider **margin is the derived plug**: `margin = paid − cogs − fee`, so the
  identity `cogs + margin + fee == paid` holds exactly on every line and order.
  There is no residual bucket.
- `unit_price_cents` and `unit_cogs_cents` are **frozen at order creation**;
  catalog edits cannot rewrite history.
- On capture the split is **persisted once as immutable `split_entries`**; reads
  never recompute.
- Capture is **idempotent per order**: at most one successful payment; retries
  and double-submits return the existing split. A **forced-decline** flag on the
  pay endpoint models one deterministic failure path: a declined capture leaves
  the order unpaid with no split entries and no inventory change, and a retry
  succeeds.

## Data model

Five tables (see `src/db/schema.ts` and `docs/design/supplement-ordering-slice.md`):

- `supplements` — seeded catalog: name, sku, `unit_cogs_cents`, suggested price, stock on hand
- `orders` — `provider_id` (stubbed auth), `status` (`draft` | `paid`), `channel`, timestamps, opaque `payment_token`
- `order_items` — qty, frozen `unit_price_cents` / `unit_cogs_cents`, `name_snapshot`
- `split_entries` — one row per line, written once at capture (immutable)
- `inventory_events` — append-only deltas with reason, note, and order reference

## Stubs (every external system is fake, behind clean seams)

| Stub | Where | Ceiling |
|---|---|---|
| **Payments** | `src/lib/payments.ts` — one-method `PaymentGateway` interface, `StubPaymentGateway` implementation. No card data, no real charge. Deterministic success plus a forced-decline test control. | No real money movement, authorizations, or refunds. |
| **Link delivery (email)** | `src/components/CopyLink.tsx` — the provider copies the in-app link. | No email sending, no link expiry. |
| **Auth** | `src/lib/constants.ts` — a fixed `PROVIDER_ID`; `orders.provider_id` exists so the dashboard query has an owner. | No login, no tenant isolation beyond the column. |
| **Shipping** | Not modeled (out of scope). | — |

## Tests

```bash
npm test
```

25 tests, table-driven, covering: every money fixture (single line, multi-item,
the qty-3 extended-rounding canonical case, zero margin, negative margin,
mid-cent rounding), the `cogs + margin + fee == paid` sum invariant on every
fixture and across a deterministic pseudo-random sweep, fee boundaries,
double-capture idempotency, forced-decline-then-retry, capture-time stock
drift, post-payment catalog edits leaving the split unchanged, stock checks at
creation, inventory adjustments, and dashboard totals.

## Design doc

`docs/design/supplement-ordering-slice.md` is the binding spec this slice was
built against — premises, money rules, acceptance criteria, and the deferral
list (refunds, order lifecycle beyond draft/paid, COGS lots, discounts, patient
identity/PHI, tenant isolation).

## AI usage

See [AI-USAGE.md](AI-USAGE.md).
