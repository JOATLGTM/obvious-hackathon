## 8. Transactions, Optimistic Locking, and Idempotency Keys

Paying an order is four writes that must live or die together: the order's status flips to
`PAID`, its version increments, a `Payment` row records the charge, and the `OrderSplit` row
records the money split. This section builds the three mechanisms that make that write safe —
a transaction for all-or-nothing, an optimistic lock for concurrent writers, and an idempotency
key for the retries the network will force on you.

### Why each tool exists

**The transaction is what makes the invariant survivable.** Without one, the failure mode of
the payment flow is not "sometimes inconsistent" — it is inconsistent at exactly the worst
moment, between the second and third write. A crash there leaves a `PAID` order with no
`OrderSplit`, which means the platform fee, the provider's net, and the COGS no longer sum to
the order total: the books are wrong in a way no single query will surface. It will surface
weeks later in a reconciliation job, when the money is already gone out the door. A
transaction collapses the four writes into one unit that either fully commits or fully rolls
back, and Postgres hands you that guarantee in read-committed isolation (the Prisma default)
because every guarded write re-checks its predicate on the current data.

**Optimistic locking fits this write pattern; pessimistic locking would buy nothing.** The
pessimistic strategy — lock the order row, then read and write it — holds a connection while
work happens and turns every second writer into a waiter or a deadlock participant. The
optimistic strategy reads a row with its `version` column, computes everything, then writes
with a compare-and-swap: an `UPDATE` whose `WHERE` clause demands the exact state that was
read, guarded by both `status` and `version`. If another writer moved the row first, the
`UPDATE` matches zero rows and the transaction fails fast with a 409 instead of waiting on a
lock. Payment is the friendliest possible case for this: one order is paid by one patient, so
genuine contention is near zero, and the conflict rate — the thing optimistic locking converts
into a cheap retry — is effectively the double-payment rate it exists to prevent. The version
column also protects the broader invariant: the row this transaction computed totals from is
provably the row it mutated, so no other transition (a `FULFILLED` flip, an admin edit) can
interleave between read and write.

The guarded write is §7's `transitionToPaid`, and its body is the whole mechanism — one
`updateMany` whose `where` demands the exact state that was read:

```ts
// src/orders/orders.repository.ts — the guarded write inside §7's
// PrismaOrdersRepository.transitionToPaid (quoted verbatim from §7)
const result = await tx.order.updateMany({
  where: {
    id: params.orderId,
    status: 'AWAITING_PAYMENT',
    version: params.expectedVersion,
  },
  data: { status: 'PAID', version: { increment: 1 } },
});
return result.count;
```

**Payments need idempotency keys because retries are not hypothetical.** A double-clicked
button, a client that times out and retries while the server actually succeeded, a proxy that
replays a request after a connection drop — each of these re-sends `POST
/v1/orders/:id/payments` for a payment that may already exist. For a read endpoint a replay is
wasted work; for a payment endpoint a replay is a second charge — a real financial loss and a
refund conversation nobody wants. HTTP cannot fix this; only server-side state can. The client
mints one `Idempotency-Key` per logical operation and reuses it for every retry of that
operation; the server records the key and, if it has seen it, replays the original response
instead of executing the charge again. Two defenses then stand between a duplicate and a
double charge: the idempotency key is the first wall, and the optimistic lock's status guard
is the second — a duplicate charge requires both to fail at once.

### The payment flow: src/orders/order.service.ts

The service opens one interactive transaction and runs the entire flow inside it. Two
conventions from §7 matter here. Every data operation goes through the `OrdersRepository`
methods that accept a transaction client (`tx`), so the service never touches Prisma's query
surface itself — it opens boundaries, the repository fills them. And the transaction's options
are stated explicitly: Prisma's defaults are `maxWait: 2000` ms (how long the call waits for a
pool connection before giving up) and `timeout: 5000` ms (the transaction's entire lifetime).
The payment flow's five statements get a deliberately wider lifetime of 10 seconds; the
acquisition wait stays at the default, because a long `maxWait` only hides pool exhaustion
from your dashboards.

```ts
// src/orders/order.service.ts
import { prisma } from '../shared/db/prisma.js';
import { ConflictError, InternalError, NotFoundError } from '../shared/errors/api-errors.js';
import type { OrderForPayment, OrdersRepository } from './orders.repository.js';
import type { OrderSplit, Payment } from './orders.repository.js';
import type { ReqUser } from '../auth/types.js';

export type Actor = ReqUser;

export interface PayResult {
  payment: Payment;
  split: OrderSplit;
  order: OrderForPayment;
}

// 75 basis points, applied with integer math only.
const PLATFORM_FEE_BPS = 75;

// Defaults are maxWait 2000ms and timeout 5000ms. The payment flow's five
// statements get a wider lifetime; the pool-acquisition wait stays default so
// saturation surfaces as a fast failure instead of a slow one.
const TX_OPTIONS = { maxWait: 2_000, timeout: 10_000 } as const;

export class OrderService {
  constructor(private readonly orders: OrdersRepository) {}

  async pay(orderId: string, actor: Actor, idempotencyKey: string): Promise<PayResult> {
    if (idempotencyKey === '') {
      // The idempotency middleware 400s a missing header before any handler
      // runs; reaching this line means a route was wired without it. No
      // payment ever proceeds unkeyed.
      throw new InternalError('idempotency_key_missing');
    }

    return prisma.$transaction(
      async (tx) => {
        // 1. Load authoritatively inside the transaction — items and patient
        //    included, because everything below reads from this snapshot.
        const order = await this.orders.findForPayment(tx, orderId);
        if (order === null) {
          throw new NotFoundError('order_not_found');
        }

        // 2. Tenancy recheck. Route-level authorization is §6's policies, but
        //    a service must be safe to call from anywhere (a job, another
        //    service), so it repeats the check: staff match on practiceId,
        //    the paying patient matches via Patient.userId. Tenant leaks
        //    answer 404, never 403.
        const isStaff = actor.role === 'ADMIN' || actor.role === 'PROVIDER';
        const allowed = isStaff
          ? actor.practiceId !== null && actor.practiceId === order.practiceId
          : order.patient.userId === actor.id;
        if (!allowed) {
          throw new NotFoundError('order_not_found');
        }

        // 3. Optimistic lock: one compare-and-swap UPDATE that lands only
        //    while the row still shows the status and version just read.
        //    count === 0 means another writer moved the row first.
        const updated = await this.orders.transitionToPaid(tx, {
          orderId,
          expectedVersion: order.version,
        });
        if (updated === 0) {
          throw new ConflictError('order_state_changed');
        }

        // 4. Recompute every money value from the line items inside the same
        //    transaction. A client-supplied total is never trusted.
        const totalCents = order.items.reduce(
          (sum, item) => sum + item.unitPriceCents * item.quantity,
          0,
        );
        const platformFeeCents = Math.round((totalCents * PLATFORM_FEE_BPS) / 10_000);
        const providerNetCents = totalCents - platformFeeCents;
        const cogsCents = order.items.reduce(
          (sum, item) => sum + item.unitCostCents * item.quantity,
          0,
        );
        const providerMarginCents = providerNetCents - cogsCents;

        // 5. The load-bearing assert: fee + COGS + margin must account for
        //    the total to the exact cent. The integer arithmetic above makes
        //    the identity true by construction, so a failure means the
        //    formula was changed (a float crept in, the fee basis moved).
        //    Persisting an unbalanced split is corruption an auditor finds
        //    months later; this is a loud 500 at write time instead.
        const accountedCents = platformFeeCents + cogsCents + providerMarginCents;
        if (accountedCents !== totalCents) {
          throw new InternalError('split_invariant_violated');
        }

        // 6. The financial records commit together with the status flip, or
        //    not at all. The processor is stubbed (§17): method CARD,
        //    processorRef null. A real integration charges OUTSIDE this
        //    transaction and records the outcome inside it, keyed by the
        //    same idempotency key — never a network call while holding a
        //    pool connection.
        const payment = await this.orders.createPaymentInTx(tx, {
          orderId,
          amountCents: totalCents,
          method: 'CARD',
          processorRef: null,
          status: 'SUCCEEDED',
        });
        const split = await this.orders.createSplitInTx(tx, {
          orderId,
          platformFeeCents,
          providerNetCents,
          cogsCents,
          providerMarginCents,
        });

        return { payment, split, order };
      },
      TX_OPTIONS,
    );
  }
}
```

Three details deserve their prose. The tenancy recheck duplicates §6 on purpose: policies run
at the route, but a service is a library — background jobs and other services will call it,
and none of them carry route middleware. The 404-for-leaks contract (§2, §6) holds here too:
a caller who names another practice's order sees the same `order_not_found` a missing id
produces. The cent invariant assert is load-bearing, not decorative: `Math.round(totalCents *
75 / 10_000)` on an integer total, followed by pure integer subtraction, guarantees fee +
COGS + margin equals the total — so a violation is proof the arithmetic was edited, and
failing the write converts silent financial corruption into a paged alert. And the processor
stub is marked where the real integration will go: when a processor lands, its network call
happens before the transaction opens (or after it closes, recording the outcome in a second
short transaction) — a network round-trip inside a database transaction holds a pool
connection hostage for the processor's latency, which is how pools die under load.

### The pessimistic alternative: locking the row with FOR UPDATE

The optimistic path is the default because payment rows are cold. Pessimistic locking earns
its keep in three situations: genuine hot-row contention (a row many writers touch per second,
where compare-and-swap retries would thrash), a read-modify-write cycle too complex to express
as one guarded `UPDATE`, and multi-row sections that must lock several rows in a fixed order
to stay deadlock-free. The mechanism is a raw `SELECT` carrying the `FOR UPDATE` clause, run
on the transaction's own connection, which holds the row lock until commit. The snippet is
complete — it is the same flow through the repository's raw-SQL seam:

```ts
// src/orders/pay-pessimistic.ts — the pessimistic twin of OrderService.pay
import { prisma } from '../shared/db/prisma.js';
import { ConflictError, InternalError, NotFoundError } from '../shared/errors/api-errors.js';
import type { OrdersRepository } from './orders.repository.js';
import type { OrderSplit, Payment } from './orders.repository.js';
import type { ReqUser } from '../auth/types.js';

const TX_OPTIONS = { maxWait: 2_000, timeout: 10_000 } as const;

export interface PessimisticPayResult {
  payment: Payment;
  split: OrderSplit;
  order: { id: string; status: 'PAID' };
}

export async function payPessimistic(
  orders: OrdersRepository,
  orderId: string,
  actor: ReqUser,
  idempotencyKey: string,
): Promise<PessimisticPayResult> {
  if (idempotencyKey === '') {
    throw new InternalError('idempotency_key_missing');
  }

  return prisma.$transaction(
    async (tx) => {
      // Runs on the transaction's own connection, so the row lock lives
      // until this transaction commits or rolls back. The ${orderId} slot
      // is a bound parameter of the tagged template — never concatenation.
      const locked = await orders.lockOrderRowInTx(tx, orderId);
      if (locked === null) {
        throw new NotFoundError('order_not_found');
      }

      const isStaff = actor.role === 'ADMIN' || actor.role === 'PROVIDER';
      const allowed = isStaff
        ? actor.practiceId !== null && actor.practiceId === locked.practiceId
        : locked.patientUserId === actor.id;
      if (!allowed) {
        throw new NotFoundError('order_not_found');
      }
      if (locked.status !== 'AWAITING_PAYMENT') {
        throw new ConflictError('order_state_changed');
      }

      const items = await orders.findItemsInTx(tx, orderId);
      const totalCents = items.reduce(
        (sum, item) => sum + item.unitPriceCents * item.quantity,
        0,
      );
      const platformFeeCents = Math.round((totalCents * 75) / 10_000);
      const providerNetCents = totalCents - platformFeeCents;
      const cogsCents = items.reduce(
        (sum, item) => sum + item.unitCostCents * item.quantity,
        0,
      );
      const providerMarginCents = providerNetCents - cogsCents;
      const accountedCents = platformFeeCents + cogsCents + providerMarginCents;
      if (accountedCents !== totalCents) {
        throw new InternalError('split_invariant_violated');
      }

      // The lock already excludes concurrent writers on this row; the
      // version still moves so other readers see the transition.
      const updated = await orders.transitionToPaid(tx, {
        orderId,
        expectedVersion: locked.version,
      });
      if (updated === 0) {
        throw new ConflictError('order_state_changed');
      }

      const payment = await orders.createPaymentInTx(tx, {
        orderId,
        amountCents: totalCents,
        method: 'CARD',
        processorRef: null,
        status: 'SUCCEEDED',
      });
      const split = await orders.createSplitInTx(tx, {
        orderId,
        platformFeeCents,
        providerNetCents,
        cogsCents,
        providerMarginCents,
      });

      return { payment, split, order: { id: orderId, status: 'PAID' as const } };
    },
    TX_OPTIONS,
  );
}
```

The lock lives in the repository's `lockOrderRowInTx` (§7): `FOR UPDATE OF o` locks only the
`Order` row, not the joined `Patient` row, and the `::text` cast renders the enum as a string.
Note what did not change: the idempotency key requirement and the split math are identical.
Pessimistic locking is a concurrency strategy, not an idempotency strategy — the key is still
the only thing standing between a network replay and a second charge.

### Idempotency keys

The key record lives in Postgres next to the data it protects. That is deliberate: the
`INSERT` of a pending key is atomic, transactional, and enforceable with a unique constraint —
the insert itself is the lock that decides which of two concurrent duplicate requests executes.
Redis (§12) is the right store for rate limits and caches, where a lost record costs a request
or a cache miss; a lost idempotency record costs a double charge.

Add the auxiliary model to §7's schema:

```prisma
// prisma/schema.prisma — appended to the §7 schema
enum IdempotencyKeyStatus {
  PENDING
  COMPLETED
}

model IdempotencyKey {
  id             String               @id @default(uuid()) @db.Uuid
  key            String
  endpoint       String
  requestHash    String
  userId         String
  status         IdempotencyKeyStatus @default(PENDING)
  responseStatus Int?
  responseBody   String?
  createdAt      DateTime             @default(now())
  expiresAt      DateTime

  @@unique([key, endpoint])
  @@index([expiresAt])
}
```

```bash
$ npx prisma migrate dev --name add_idempotency_keys
```

The generated migration pins the scope contract in SQL:

```sql
-- prisma/migrations/20261006120000_add_idempotency_keys/migration.sql
CREATE TYPE "IdempotencyKeyStatus" AS ENUM ('PENDING', 'COMPLETED');

CREATE TABLE "IdempotencyKey" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "IdempotencyKeyStatus" NOT NULL DEFAULT 'PENDING',
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotencyKey_key_endpoint_key" ON "IdempotencyKey"("key", "endpoint");
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");
```

Four fields encode the policy. The unique pair `(key, endpoint)` scopes a key to one logical
operation on one endpoint — the same UUID minted by a shared client helper must not let a
`GET /v1/supplements` response be replayed into a payments call. `requestHash` is the SHA-256
of the canonical request body: a key that arrives with a different body than the one that
created it is a client bug or a replay attempt, and it is rejected. `userId` scopes replay
rights to the caller who created the key — a guessed or leaked key belongs to someone else.
And `expiresAt` bounds everything: keys expire after 30 days, so a lost record self-heals.

The middleware below enforces the whole policy as the last gate before the controller. Guards
run in order: require the header (400 without it — a transport-shape error, written directly
as a problem-details body since §10's class hierarchy covers state and authorization
failures), look the key up (`COMPLETED` replays the stored response with
`Idempotent-Replayed: true`; `PENDING` conflicts with 409), insert a pending record for new
keys (catching the `P2002` race when a concurrent duplicate wins the insert), and finally wrap
`res.json` so the handler's own serialization is the commit point that persists the outcome.

```ts
// src/payments/idempotency.middleware.ts
import { createHash } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { prisma } from '../shared/db/prisma.js';
import { ConflictError, UnauthorizedError } from '../shared/errors/api-errors.js';

const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_KEY_LENGTH = 16;
const MAX_KEY_LENGTH = 255;

// The endpoint template this guard protects — one half of a key's scope.
export const PAYMENTS_IDEMPOTENCY_ENDPOINT = 'POST /v1/orders/:id/payments';

interface IdempotencyRecord {
  key: string;
  endpoint: string;
  requestHash: string;
  userId: string;
  status: 'PENDING' | 'COMPLETED';
  responseStatus: number | null;
  responseBody: string | null;
}

// Deterministic JSON: object keys sorted recursively, undefined dropped.
// Semantically identical retries hash identically even when key order in the
// serialized body differs. Array order is preserved — it is significant
// (line items are a list, not a set).
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    const entries = value.map((entry) => stableStringify(entry));
    return `[${entries.join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${pairs.join(',')}}`;
}

function requestHash(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

// A missing or malformed header is a transport-shape error: 400 with a
// problem-details body, written directly (§10's class hierarchy covers state
// and authorization failures, not malformed requests).
function badRequest(res: Response, instance: string, detail: string): void {
  res.status(400).type('application/problem+json').json({
    type: 'https://api.supplementdirect.example/problems/missing_idempotency_key',
    title: 'Bad Request',
    status: 400,
    detail,
    instance,
    traceId: res.get('x-request-id') ?? null,
  });
}

function replay(record: IdempotencyRecord, res: Response): void {
  // A COMPLETED record always carries its response; the fallbacks exist so
  // the types below are honest about the impossible case.
  res.setHeader('Idempotent-Replayed', 'true');
  res.status(record.responseStatus ?? 200).type('application/json').send(record.responseBody ?? '{}');
}

export function idempotency(endpoint: string): RequestHandler {
  return async (req, res, next) => {
    const key = req.get('Idempotency-Key');
    if (key === undefined || key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
      badRequest(
        res,
        req.originalUrl,
        `Provide an Idempotency-Key header of ${MIN_KEY_LENGTH} to ${MAX_KEY_LENGTH} characters.`,
      );
      return;
    }

    const user = req.user; // §5's authenticate ran first
    if (user === undefined) {
      throw new UnauthorizedError('authentication required');
    }
    const hash = requestHash(req.body);

    const existing = await prisma.idempotencyKey.findUnique({
      where: { key_endpoint: { key, endpoint } },
    });
    if (existing !== null) {
      if (existing.userId !== user.id || existing.requestHash !== hash) {
        // Same key, different caller or body: the first request owns the
        // key. This is either a client bug or a replay attempt.
        throw new ConflictError('idempotency_key_reused');
      }
      if (existing.status === 'COMPLETED') {
        replay(existing, res);
        return;
      }
      throw new ConflictError('request_in_progress');
    }

    try {
      await prisma.idempotencyKey.create({
        data: {
          key,
          endpoint,
          requestHash: hash,
          userId: user.id,
          status: 'PENDING',
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });
    } catch (err) {
      // A concurrent request with the same key won the insert race (P2002).
      if ((err as { code?: string }).code === 'P2002') {
        const winner = await prisma.idempotencyKey.findUnique({
          where: { key_endpoint: { key, endpoint } },
        });
        if (winner === null || winner.userId !== user.id || winner.requestHash !== hash) {
          throw new ConflictError('idempotency_key_reused');
        }
        if (winner.status === 'COMPLETED') {
          replay(winner, res);
          return;
        }
        throw new ConflictError('request_in_progress');
      }
      throw err;
    }

    // The handler's res.json call is the commit point of the idempotency
    // record. 2xx and 4xx outcomes are deterministic answers — persist and
    // replay them. A 5xx outcome is unknown or failed: free the key so the
    // client can retry the same logical operation with the same key.
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const status = res.statusCode;
      if (status >= 500) {
        void prisma.idempotencyKey
          .delete({ where: { key_endpoint: { key, endpoint } } })
          .catch(() => undefined);
      } else {
        void prisma.idempotencyKey
          .update({
            where: { key_endpoint: { key, endpoint } },
            data: {
              status: 'COMPLETED',
              responseStatus: status,
              responseBody: JSON.stringify(body),
            },
          })
          .catch(() => undefined);
      }
      return originalJson(body);
    };

    next();
  };
}
```

**Request-hash drift policy.** The hash covers the parsed request body only — not headers, not
the URL's order id (the endpoint template already scopes the key), not the authentication
header. The rule is first-request-wins: the first body to claim a key defines it, and any
later request with the same key and a different hash is rejected with
`idempotency_key_reused` (409). Servers never update a stored hash, and clients never reuse a
key across logical operations — a fresh UUID per checkout attempt, reused verbatim across
retries of that attempt. The stable stringify makes the two practical noise sources vanish
(member ordering in serialized JSON) while keeping the one meaningful difference visible:
array order, which changes which line items a charge covers and therefore changes the hash.

**TTL cleanup.** The 30-day expiry needs a reaper — a scheduled `DELETE` is the whole job:

```sql
-- Scheduled daily (pg_cron, or the job scheduler §16 wires):
DELETE FROM "IdempotencyKey" WHERE "expiresAt" < now();
```

A crashed worker can strand a key in `PENDING` (no handler ever reached `res.json`); the
record self-heals at expiry, and until then the client's retry gets the honest 409 — the
alternative, a second charge on an unknown outcome, is strictly worse.

### Wiring the payments endpoint

The router composes the guards in the order that makes a denied actor cheap: authentication
first (§5's middleware attaches `req.user`), §6's payment policy would slot next (a denied
actor must never consume an idempotency key), the idempotency guard third, the controller
last. The controller is thin — it reads verified context, delegates, and projects the pinned
201 shape `{ payment, split, order: { id, status } }`.

```ts
// src/payments/payments.controller.ts
import type { RequestHandler } from 'express';
import { InternalError, UnauthorizedError } from '../shared/errors/api-errors.js';
import { container } from '../container.js';

export const pay: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user; // §5's authenticate attaches the verified claims
    if (user === undefined) {
      throw new UnauthorizedError('authentication required');
    }
    const key = req.get('Idempotency-Key');
    if (key === undefined) {
      // The idempotency middleware 400s a missing key before controllers
      // run; this branch is unreachable when the router below is wired as
      // written.
      throw new InternalError('idempotency_key_missing');
    }

    const result = await container.orderService.pay(req.params.id, user, key);

    // 201 with the pinned response shape: the order collapses to id + status.
    res.status(201).json({
      payment: result.payment,
      split: result.split,
      order: { id: result.order.id, status: result.order.status },
    });
  } catch (err) {
    next(err); // §10's mapper renders ApiErrors and Prisma errors as problem details
  }
};
```

```ts
// src/payments/routes.ts
import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import { idempotency, PAYMENTS_IDEMPOTENCY_ENDPOINT } from './idempotency.middleware.js';
import { pay } from './payments.controller.js';

const router = Router();

// Guard order matters. authenticate (§5) attaches req.user; §6's payment
// policy slots between it and the idempotency guard so a denied actor never
// consumes a key; the idempotency guard is the last gate before the
// controller, so every request that reaches the service is keyed.
router.post(
  '/orders/:id/payments',
  authenticate,
  idempotency(PAYMENTS_IDEMPOTENCY_ENDPOINT),
  pay,
);

export default router;
```

`src/app.ts` mounts this router at `/v1` next to the orders router (§2's mounting block): with
the seed from §7 in place, `POST /v1/orders/<seeded order id>/payments` with a fresh
`Idempotency-Key` header returns the 201 once and replays it with `Idempotent-Replayed: true`
on every identical retry.

### Common mistakes

- **Modeling money as floats.** `0.1 + 0.2` is not `0.3` in binary floating point, and
  `Math.round(total * 0.0075)` on a float total is off-by-one cent on a schedule you do not
  control. *Production failure:* splits that stop summing to totals — the cent invariant
  assert above starts paging you, or worse, was never written and reconciliation finds the
  drift. *Fix:* integer cents everywhere (`unitPriceCents`, `totalCents`), fee as
  `Math.round((totalCents * 75) / 10_000)`, and the assert as the tripwire.
- **Forgetting the version in the guard.** A transition guarded by `status` alone still works
  for the payment flow (a paid order no longer matches `AWAITING_PAYMENT`), but the habit
  leaks: any other read-modify-write on the row loses the compare-and-swap, and two writers
  who both read version 1 can both "succeed" on different columns. *Production failure:* a
  lost update — an admin edit or a fulfilment transition silently overwritten. *Fix:* every
  guarded write filters on both `status` and `version` and increments `version` in the same
  `updateMany` (§7's `transitionToPaid` is the template).
- **Nesting transactions.** Calling `prisma.$transaction` inside an interactive transaction —
  usually a repository method that opens its own transaction while the service's `tx` is
  already open — starts a second transaction on a second connection while the first is held.
  *Production failure:* self-deadlock under modest concurrency: the inner transaction waits
  for the outer's locks (or the pool), the outer waits on the inner, everything behind them
  queues, and the pool times out (`P2024`). *Fix:* services open the one transaction;
  repositories accept `tx?: Queryable` and join the caller's transaction (§7's convention).
- **Scoping idempotency to the key alone.** A unique index on `key` without `endpoint` lets
  one client's shared UUID generator replay a `GET` response into a payments call — or replay
  one order's payment response as another's. *Production failure:* a replayed 201 that never
  charged anyone, or charged the wrong order. *Fix:* the composite unique `(key, endpoint)`
  plus the `userId` check in the middleware above.
- **Replaying 5xx responses as success.** Persisting a 500 body as a completed idempotency
  record freezes an unknown outcome: the client's retry gets the stored failure forever, and
  the operation may or may not have committed. *Production failure:* a charge that landed but
  is unrecoverable from the client's side — support cannot even tell which. *Fix:* persist
  2xx and 4xx (deterministic answers), delete the key on 5xx so the retry re-executes; the
  optimistic lock is the second wall if the first attempt actually committed.
- **Raising the transaction timeout instead of shrinking the transaction.** A 60-second
  `timeout` does not make a slow transaction safe; it makes a pool connection hostage for a
  minute and moves the failure from "this request failed" to "every request is failing."
  *Production failure:* `P2028` timeouts under load, then pool exhaustion (`P2024`) as
  waiters stack. *Fix:* the transaction holds five statements and no network calls; if real
  work is bigger than that, it is two transactions with an idempotency key, not one bigger
  timeout.
- **Returning Prisma rows with BigInt columns as JSON.** `JSON.stringify` throws
  `TypeError: Do not know how to serialize a BigInt`, and §7 modeled cents as `Int` partly to
  avoid this. The failure returns the day a column outgrows Int range and someone reaches for
  `BigInt`. *Production failure:* every endpoint returning that row 500s at serialization
  time, after the queries already succeeded. *Fix:* serialize explicitly — map `BigInt`
  values to strings at the controller boundary before anything calls `res.json`.
- **Letting the idempotency insert race surface as a 500.** Two concurrent requests with the
  same key: one `INSERT` wins, the loser's uncaught `P2002` becomes a 500 that looks like a
  server fault — and a frightened client minting a new key. *Production failure:* spurious
  500s precisely when two retries race, the moment idempotency exists for. *Fix:* catch
  `P2002` on the insert, re-fetch the winning record, and replay or 409 as shown above.

### Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Client reports a double charge; two `Payment` rows exist for one order | the two charges carried different `Idempotency-Key` values — the client minted a key per request instead of per logical operation | audit `IdempotencyKey` for the pattern; fix the client to mint one UUID per checkout attempt and reuse it across retries; the server's status guard is the backstop, not the client's discipline |
| `409 request_in_progress` storms on one endpoint | the client retries while the original request is still executing (same key), or transactions are slow enough that the `PENDING` window is wide | that 409 is correct behavior — tune client retry backoff; if the window is genuinely wide, find the slow transaction (§11's query events) instead of narrowing the guard |
| `P2028` transaction timeout on pay under load | the transaction waited too long for a pool connection (`maxWait`) or outlived `timeout` behind a saturated pool | keep transactions at the five-statement shape above, no external I/O inside; size `connection_limit` per §15; raise `timeout` only with a measured reason |
| `P2034` write conflict or deadlock on `Order` | two guarded writers race the same row (an admin tool against the payment flow) and Postgres resolves it as a conflict | retry the transaction once with a fresh read — the version guard makes the retry safe; if one writer is a bulk job, move it off the hot path or batch it off-peak |
| Every retry gets `409 idempotency_key_reused` | the client regenerates the body (a timestamp, a nonce) while reusing the key — the request hash drifts | the drift policy is doing its job; make the retried body byte-stable for one logical operation, or mint a new key per attempt and accept the re-execution risk |
| A key is stuck in `PENDING` and the client gets 409 on retries | the worker crashed after the insert and before `res.json` persisted the outcome | bounded self-heal: the 30-day TTL reaper reclaims it; if the wait is unacceptable, add a pending-timeout sweep that frees keys older than a few minutes |
| Retry after a "successful" payment returns `409 order_state_changed` instead of a replayed 201 | the retry carried a new key (so the service ran again), found the order already `PAID`, and the optimistic lock refused it | expected under the two-wall defense; the client should reuse the original key so the middleware replays the stored 201 — check `IdempotencyKey` to confirm which wall fired |
