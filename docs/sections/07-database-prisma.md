## 7. The Database Layer with Prisma

Everything the API knows about money, patients, and orders lives in Postgres 17. This section
builds the data layer that every later section writes against: the Prisma schema that pins
the eight domain models, the migration workflow that gets that schema into every environment,
the seed that makes a fresh database behave like a real practice, the client singleton, and the
repository layer that keeps data access out of the business logic.

### Why Prisma — and why a repository layer anyway

Three capabilities earn Prisma its place here:

- **A typed client generated from the schema.** The schema is the single source of truth; the
  generated client types every query argument and every result row. Renaming a field becomes a
  compile error across the whole codebase instead of a 500 in staging, and the editor completes
  `where` shapes that actually exist.
- **Migrations as reviewed artifacts.** `prisma migrate` produces plain SQL files under version
  control, applied identically in a laptop, CI, and production. Schema changes get the same
  review a code change gets.
- **A real seed story.** One command produces a database with users, a catalog, and an order
  waiting at `AWAITING_PAYMENT` — the exact state the later examples need.

(A newer Prisma major exists; this section targets the 6.x schema and query syntax, which is
the stable surface every later section uses.)

An ORM this capable makes part of the classic repository pattern obsolete and part of it more
important than ever. What it obsoletes: hiding SQL behind a generic "query object" — Prisma
already is that layer, and a worse reimplementation on top adds nothing. What it makes more
important:

- **Transaction scoping.** Multi-write invariants (§8's payment flow) need a transaction whose
  boundary the *service* controls. The convention that makes this work: every repository method
  that can participate accepts an optional transaction client and falls back to the shared one —
  `const db = tx ?? this.prisma`. Services open transactions; repositories execute inside them
  without knowing where the boundary came from.
- **Type hygiene.** Prisma's generated row types stop at the repository layer. Controllers never
  import `@prisma/client`; responses are serialized explicitly, which is what keeps `passwordHash`
  and internal columns out of payloads by construction rather than by discipline.
- **Testability.** The repository sits behind an interface, so §13 can unit-test services against
  in-memory fakes and integration-test the Prisma implementation against real Postgres — with no
  mocks of the query API anywhere.

The naming choice is deliberate and visible in everything below: field names are camelCase and
there is no `@@map` anywhere in the schema. Postgres therefore stores quoted, mixed-case
identifiers (`"Order"`, `"totalCents"`), which means hand-written SQL must quote them (§8's
`FOR UPDATE` query does). The alternative — `@@map` to snake_case — buys conventional SQL naming
at the cost of two vocabularies for every column. One naming language from schema to JSON
response is worth more than pretty DDL, so the book pays the quoting tax instead.

### The schema: prisma/schema.prisma

The eight models and their relations:

| Relation | Cardinality | Why |
| --- | --- | --- |
| Practice — User | 1 — * | staff belong to one practice; `practiceId` is nullable because patients self-register without one (§5's registration writes exactly this shape) |
| Practice — Patient | 1 — * | patients are records owned by a practice, with US shipping fields |
| User (provider) — Order | 1 — * | the clinician who assembled the order |
| Patient — Order | 1 — * | who the order is for |
| Patient — User | *—1 (optional) | a patient's login account; §6's `orderVisible` policy expects a `patientUserId` resource attribute, and the loader reads it off this link |
| Order — OrderItem | 1 — * | line items snapshot both COGS and the patient price |
| Supplement — OrderItem | 1 — * | the catalog entry each line came from |
| Order — Payment | 1 — * | payment attempts; a real processor integration (§17) fills `processorRef` |
| Order — OrderSplit | 1 — 1 | the persisted money split, written exactly once, at payment time (§8) |

Money is always `Int` cents. A signed 32-bit integer tops out at 2,147,483,647 cents — about
$21.47M per column value — which is ample headroom for per-unit prices and order totals. Reaching
for `BigInt` costs you JSON serialization (see Common mistakes); this schema never needs it.

Three enums are pinned: `UserRole` (§5's RBAC roles), `OrderStatus` (the lifecycle §8 guards),
and `PaymentMethod`. `Payment.status` stays a `String` on purpose: the processor is stubbed, and
a stub does not get to define a lifecycle. When a real integration lands, its statuses become an
enum through a normal migration.

`Order.version Int @default(1)` is the optimistic-lock column. It looks redundant next to a
`status` column; §8 shows why it is not — it turns "check-then-act" into a single compare-and-swap
that two concurrent writers cannot both satisfy.

The indexes:

| Index | Serves |
| --- | --- |
| `@@index([practiceId, createdAt])` on Order | `GET /v1/orders` for one practice, newest first — the equality column is leftmost |
| `@@index([patientId])` on Order | the `patientId` filter |
| `@@index([status])` on Order | the `status` filter and operational views ("everything awaiting payment") |
| `@@index([orderId])` on OrderItem | order detail reads and the cascade-delete path |
| `@@index([orderId])` on Payment | order detail reads and the delete guard |
| `@@unique([practiceId, sku])` on Supplement | catalog identity per practice |

Delete rules encode the lifecycle: an order's items are meaningless without the order (cascade),
but anything money-touched is forever (restrict):

| Relation | onDelete | Why |
| --- | --- | --- |
| OrderItem → Order | `Cascade` | line items have no meaning without their order |
| OrderItem → Supplement | `Restrict` | a supplement that ever appeared on an order cannot be deleted — financial history outlives catalog changes |
| Payment → Order | `Restrict` | a paid order is a financial record, not a row someone cleans up |
| OrderSplit → Order | `Restrict` | same, for the audit split |
| Order → Practice/User/Patient | `Restrict` | orders reference real parties (Prisma's default for required relations is restrict; these are written explicitly so the intent survives refactors) |
| User → Practice | `Restrict` | deactivating a practice is a process, not a `DELETE` |

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  ADMIN
  PROVIDER
  PATIENT
}

enum OrderStatus {
  DRAFT
  AWAITING_PAYMENT
  PAID
  FULFILLED
  CANCELLED
}

enum PaymentMethod {
  CARD
  ACH
}

model Practice {
  id          String   @id @default(uuid()) @db.Uuid
  name        String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  users       User[]
  patients    Patient[]
  supplements Supplement[]
  orders      Order[]
}

model User {
  id           String    @id @default(uuid()) @db.Uuid
  practiceId   String?   @db.Uuid
  email        String    @unique
  passwordHash String
  role         UserRole  @default(PATIENT)
  firstName    String?
  lastName     String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  practice      Practice? @relation(fields: [practiceId], references: [id], onDelete: Restrict)
  orders        Order[]
  patientRecord Patient?

  @@index([practiceId])
}

model Patient {
  id           String   @id @default(uuid()) @db.Uuid
  practiceId   String   @db.Uuid
  userId       String?  @db.Uuid @unique
  firstName    String
  lastName     String
  email        String?
  phone        String?
  addressLine1 String
  addressLine2 String?
  city         String
  state        String   @db.VarChar(2)
  postalCode   String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  practice Practice @relation(fields: [practiceId], references: [id], onDelete: Restrict)
  user     User?    @relation(fields: [userId], references: [id])
  orders   Order[]

  @@index([practiceId])
}

model Supplement {
  id                 String   @id @default(uuid()) @db.Uuid
  practiceId         String   @db.Uuid
  name               String
  sku                String
  wholesaleCostCents Int
  isActive           Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  practice Practice    @relation(fields: [practiceId], references: [id], onDelete: Restrict)
  items    OrderItem[]

  @@unique([practiceId, sku])
}

model Order {
  id         String      @id @default(uuid()) @db.Uuid
  practiceId String      @db.Uuid
  providerId String      @db.Uuid
  patientId  String      @db.Uuid
  status     OrderStatus @default(DRAFT)
  totalCents Int         @default(0)
  version    Int         @default(1)
  createdAt  DateTime    @default(now())
  updatedAt  DateTime    @updatedAt

  practice Practice    @relation(fields: [practiceId], references: [id], onDelete: Restrict)
  provider User        @relation(fields: [providerId], references: [id], onDelete: Restrict)
  patient  Patient     @relation(fields: [patientId], references: [id], onDelete: Restrict)
  items    OrderItem[]
  payments Payment[]
  split    OrderSplit?

  @@index([practiceId, createdAt])
  @@index([patientId])
  @@index([status])
}

model OrderItem {
  id             String @id @default(uuid()) @db.Uuid
  orderId        String @db.Uuid
  supplementId   String @db.Uuid
  quantity       Int
  unitCostCents  Int
  unitPriceCents Int

  order      Order      @relation(fields: [orderId], references: [id], onDelete: Cascade)
  supplement Supplement @relation(fields: [supplementId], references: [id], onDelete: Restrict)

  @@index([orderId])
}

model Payment {
  id           String        @id @default(uuid()) @db.Uuid
  orderId      String        @db.Uuid
  amountCents  Int
  method       PaymentMethod
  processorRef String?
  status       String        @default("SUCCEEDED")
  createdAt    DateTime      @default(now())

  order Order @relation(fields: [orderId], references: [id], onDelete: Restrict)

  @@index([orderId])
}

model OrderSplit {
  id                  String   @id @default(uuid()) @db.Uuid
  orderId             String   @unique @db.Uuid
  platformFeeCents    Int
  providerNetCents    Int
  cogsCents           Int
  providerMarginCents Int
  createdAt           DateTime @default(now())

  order Order @relation(fields: [orderId], references: [id], onDelete: Restrict)
}
```

The connection string comes from §1's `DATABASE_URL`. Local development adds two pool knobs so
the pool is explicit rather than inferred from the machine:

```bash
$ export DATABASE_URL="postgresql://supplementdirect:devpassword@localhost:5432/supplementdirect?schema=public&connection_limit=10&pool_timeout=20"
```

Prisma's documented default pool size is the machine's physical CPU count times two plus one —
reasonable on a laptop, wrong on a sized container, where you want an explicit `connection_limit`
(§15 sizes it per deployment).

### How migrations actually flow

Development uses `migrate dev`; every non-development environment uses `migrate deploy`. The two
commands share the migration files and nothing else.

`migrate dev` diffs the schema against a **shadow database** — a scratch database Prisma creates
and replays your existing migrations in — then generates SQL for the difference, applies it to the
development database, and regenerates the client. The shadow database is why `migrate dev` needs
the `DATABASE_URL` role to be allowed to create databases.

The first migration generates the whole schema:

```bash
$ npx prisma migrate dev --name init
```

The generated file is plain SQL you can read in review — here is the `Order` table as Prisma
writes it, quoted PascalCase identifiers and all (that is the no-`@@map` trade, showing up in
real DDL):

```sql
-- prisma/migrations/20260901090000_init/migration.sql (the "Order" table)
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Order_practiceId_createdAt_idx" ON "Order"("practiceId", "createdAt");
CREATE INDEX "Order_patientId_idx" ON "Order"("patientId");
CREATE INDEX "Order_status_idx" ON "Order"("status");

ALTER TABLE "Order" ADD CONSTRAINT "Order_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Two formatting and integrity commands belong in the edit loop and in CI before migrations are
committed:

```bash
$ npx prisma format
$ npx prisma validate
```

`migrate deploy` applies migrations that have not been applied yet, in order, and nothing else:
no diffing, no shadow database, no prompts, no resets. That is why it is the only migration
command CI and production ever run — §15's release pipeline executes it before the new code
serves traffic:

```bash
$ npx prisma migrate deploy
```

When a schema change is pending and you want to see exactly what the next migration will do
before generating it, `migrate diff` prints the SQL. Suppose you added a nullable `notes` column
to `Order` in `schema.prisma` and have not created a migration yet:

```bash
$ npx prisma migrate diff \
    --from-migrations ./prisma/migrations \
    --to-schema-datamodel ./prisma/schema.prisma \
    --shadow-database-url "$SHADOW_DATABASE_URL" \
    --script
```

```sql
-- the diff output for that edit
ALTER TABLE "Order" ADD COLUMN "notes" TEXT;
```

The same command in the other direction (`--from-url "$DATABASE_URL" --to-schema-datamodel
./prisma/schema.prisma`) detects drift — a production database whose shape no longer matches the
migration history. Run it when a deploy reports an unexpected failure and you suspect someone
"fixed" a table by hand.

**When a migration fails partway.** Migrations are recorded in a `_prisma_migrations` table, and
a failed one stops every later deploy until it is resolved. The concrete story: a migration
`20261005120000_patient_shipping_notes_required` adds a required `shippingNotes` column to
`Patient` with no default. Staging has patients, so Postgres rejects the statement — a column
cannot be `NOT NULL` while existing rows hold NULL. Staging is now stuck: the migration is
recorded as failed and `migrate deploy` refuses to continue past it.

```bash
$ npx prisma migrate status
# 2 migrations found in prisma/migrations
#
# 1 migration failed
# 20261005120000_patient_shipping_notes_required

$ npx prisma migrate resolve --rolled-back 20261005120000_patient_shipping_notes_required
```

`--rolled-back` tells Prisma "that attempt never happened" so the migration can be edited and
reapplied. The fix follows the **expand/contract habit** — the pattern for every column-level
change, stated here and carried as an item in §17's production readiness checklist:

1. **Expand:** ship an additive migration — add the column nullable (or with a default). Old
   code and new code both run against it. `ALTER TABLE "Patient" ADD COLUMN "shippingNotes" TEXT;`
2. **Backfill:** populate the column in application code (writes it on new rows) plus a one-time
   backfill for existing rows, deployed with the code that reads it.
3. **Contract:** once every environment runs the new code, a *separate later* migration tightens
   the shape — `ALTER TABLE "Patient" ALTER COLUMN "shippingNotes" SET NOT NULL;`

Never mix expand and contract in one migration: on Postgres each migration runs in a single
transaction, and a contract step inside an expand migration reintroduces exactly the failure the
habit exists to avoid. The habit is also why this schema's evolving columns (like `Payment.status`
becoming an enum) will arrive as three reviewed commits rather than one daring one.

### Seeding: prisma/seed.ts

A seed exists so that `npx prisma db seed` after a fresh `migrate dev` produces the exact world
every later section writes against: one practice, staff and patient users, a six-item
catalog, two patients, and one order at `AWAITING_PAYMENT` with two line items. The seed wipes and
recreates in foreign-key-safe order, so repeated runs are deterministic. Passwords are hashed with
Argon2id — the same algorithm §5's auth flow verifies — and because Argon2id embeds a per-hash
salt in the PHC string, the same demo password produces three different hashes.

The `prisma.seed` key tells the CLI how to run the file (tsx, §1's TypeScript runner):

```json
// package.json — the Prisma-related keys (the full manifest is §1's)
{
  "name": "supplementdirect-api",
  "scripts": {
    "postinstall": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:seed": "prisma db seed"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

```ts
// prisma/seed.ts
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'correct-horse-battery-staple';

const CATALOG = [
  { name: 'Magnesium Glycinate 120ct', sku: 'MG-GLY-120', wholesaleCostCents: 940 },
  { name: 'Vitamin D3 + K2 60ct', sku: 'D3K2-060', wholesaleCostCents: 610 },
  { name: 'Omega-3 Fish Oil 90ct', sku: 'OM3-090', wholesaleCostCents: 1120 },
  { name: 'Iron Bisglycinate 60ct', sku: 'FE-BIS-060', wholesaleCostCents: 780 },
  { name: 'Probiotic 50B CFU 30ct', sku: 'PRO-50B-030', wholesaleCostCents: 2100 },
  { name: 'B-Complex 60ct', sku: 'BCPLX-060', wholesaleCostCents: 850 },
];

const supplementIds = new Map<string, string>();

function supplementId(sku: string): string {
  const id = supplementIds.get(sku);
  if (id === undefined) {
    throw new Error(`seed catalog is missing sku ${sku}`);
  }
  return id;
}

async function main(): Promise<void> {
  // Wipe in foreign-key-safe order so repeated runs stay deterministic.
  await prisma.orderSplit.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.supplement.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.user.deleteMany();
  await prisma.practice.deleteMany();

  const practice = await prisma.practice.create({
    data: { name: 'Northside Integrative Health' },
  });

  // Argon2id with a per-hash salt: the three hashes below differ despite the
  // equal demo password, which is the property §5's verify() relies on.
  const adminHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  const providerHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  const patientHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  const admin = await prisma.user.create({
    data: {
      practiceId: practice.id,
      email: 'admin@northside.example',
      passwordHash: adminHash,
      role: 'ADMIN',
      firstName: 'Dana',
      lastName: 'Okafor',
    },
  });

  const provider = await prisma.user.create({
    data: {
      practiceId: practice.id,
      email: 'j.chen@northside.example',
      passwordHash: providerHash,
      role: 'PROVIDER',
      firstName: 'Julia',
      lastName: 'Chen',
    },
  });

  // §6: PATIENT accounts are never practice staff, so their practiceId is null.
  const patientUser = await prisma.user.create({
    data: {
      practiceId: null,
      email: 'ana.silva@northclinic.example',
      passwordHash: patientHash,
      role: 'PATIENT',
      firstName: 'Ana',
      lastName: 'Silva',
    },
  });

  for (const entry of CATALOG) {
    const created = await prisma.supplement.create({
      data: {
        practiceId: practice.id,
        name: entry.name,
        sku: entry.sku,
        wholesaleCostCents: entry.wholesaleCostCents,
      },
    });
    supplementIds.set(entry.sku, created.id);
  }

  const ana = await prisma.patient.create({
    data: {
      practiceId: practice.id,
      userId: patientUser.id,
      firstName: 'Ana',
      lastName: 'Silva',
      email: 'ana.silva@northclinic.example',
      phone: '+1-555-0100',
      addressLine1: '18 Cedar Loop',
      city: 'Austin',
      state: 'TX',
      postalCode: '78704',
    },
  });

  await prisma.patient.create({
    data: {
      practiceId: practice.id,
      firstName: 'Marcus',
      lastName: 'Webb',
      email: 'marcus.webb@example.com',
      addressLine1: '4 Birch Street',
      city: 'Round Rock',
      state: 'TX',
      postalCode: '78664',
    },
  });

  // One order ready for §8's payment flow: two line items, the total
  // recomputed from the lines exactly the way the order service does it.
  const lines = [
    {
      supplementId: supplementId('MG-GLY-120'),
      quantity: 2,
      unitCostCents: 940,
      unitPriceCents: 2499,
    },
    {
      supplementId: supplementId('D3K2-060'),
      quantity: 1,
      unitCostCents: 610,
      unitPriceCents: 1799,
    },
  ];
  const totalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);

  const order = await prisma.order.create({
    data: {
      practiceId: practice.id,
      providerId: provider.id,
      patientId: ana.id,
      status: 'AWAITING_PAYMENT',
      totalCents,
      items: { create: lines },
    },
    include: { items: true },
  });

  console.log(
    `Seeded practice ${practice.name}: users ${admin.email}, ${provider.email}, ` +
      `${patientUser.email}; ${CATALOG.length} supplements; 2 patients; ` +
      `order ${order.id} (status ${order.status}, total ${totalCents} cents, ${order.items.length} items)`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
```

The seed's login pairs are the ones §5's curl examples use: `ana.silva@northclinic.example` /
`correct-horse-battery-staple` signs in as the patient; `j.chen@northside.example` with the same
password signs in as the provider who owns the seeded order.

### The client singleton: src/shared/db/prisma.ts

One client per process. Prisma maintains its own connection pool, so every extra `new
PrismaClient()` is an extra pool, and a test run or a dev server that re-imports modules can pile
up several before anything times out. The singleton module below is the only place the client is
constructed; it carries the per-environment log configuration — query events in development, where
seeing every statement is the point; warnings and errors everywhere, because query logging in
production doubles log volume for little gain (§11 owns structured logging of the *application*,
and its log level discipline is the same idea one layer up).

The `globalThis` guard exists for §13's Vitest setup: the test runner re-evaluates module graphs
per file, and without the guard each file would construct a fresh pool against the same Postgres.

```ts
// src/shared/db/prisma.ts
import { Prisma, PrismaClient } from '@prisma/client';

// The transaction client Prisma hands to interactive transactions, or the
// process-wide client when no transaction is open. Every repository method
// that can participate in a caller-owned transaction accepts this (§8).
export type Queryable = PrismaClient | Prisma.TransactionClient;

const isProduction = process.env.NODE_ENV === 'production';

// Query events are a development instrument: in production they turn every
// statement into a log line. Warnings and errors stay on everywhere.
const logDefinitions: Prisma.LogDefinition[] = isProduction
  ? [
      { emit: 'stdout', level: 'warn' },
      { emit: 'stdout', level: 'error' },
    ]
  : [
      { emit: 'stdout', level: 'query' },
      { emit: 'stdout', level: 'info' },
      { emit: 'stdout', level: 'warn' },
      { emit: 'stdout', level: 'error' },
    ];

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ log: logDefinitions });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}
```

### The repository layer

Two files and one rule from the layering contract (§2): the repository is the only layer that
imports Prisma's query surface. Services and controllers consume the exported types and interfaces;
none of them import `@prisma/client`.

**The interface is the testability seam.** `OrdersRepository` (interface) describes what the
service needs; `PrismaOrdersRepository` is the implementation §13 integration-tests against real
Postgres and its unit tests replace with a fake. Note what the interface does *not* contain: any
Prisma type in a controller-visible position, and any business rule. Methods are named for intent
(`findByIdForPractice` — tenancy is a data-access concern, and its 404-not-403 semantics live
here), not for their query shape.

**The transaction convention.** Every method that can participate in a caller-owned transaction
takes `tx?: Queryable` and starts with `const db = tx ?? this.prisma`. A service running §8's
payment flow passes its transaction client; a plain controller read passes nothing. The same
convention appears in §5's compact `UsersRepository` — section 5 showed the subset it needed; the
canonical file below is that file, unchanged, because §5's imports must keep resolving.

**Includes are how N+1 dies.** `findById` returns the order with items and supplements in one
query. The mistake of fetching items in a loop is common enough — and expensive enough at list
page sizes — to get its own entry in Common mistakes.

```ts
// src/orders/orders.repository.ts
import { Prisma, PrismaClient } from '@prisma/client';
import type { OrderSplit, Payment } from '@prisma/client';
import { ValidationError } from '../shared/errors/api-errors.js';

// An order with its items and each item's supplement — the read shape of
// GET /v1/orders/:id.
export type OrderWithItems = Prisma.OrderGetPayload<{
  include: { items: { include: { supplement: true } } };
}>;

// The list-page read shape (§9 builds its envelope on top of these rows).
export type OrderListItem = Prisma.OrderGetPayload<{ include: { items: true } }>;

// The read shape the payment flow needs: items for the total recompute and
// the patient for the ownership check (§8).
export type OrderForPayment = Prisma.OrderGetPayload<{
  include: { items: true; patient: true };
}>;

// Re-exported so service-layer files can name these row types without
// importing @prisma/client themselves.
export type { OrderSplit, Payment };

export type OrderSort = 'newest' | 'oldest' | 'total_desc';

export interface OrderListFilters {
  status?: 'DRAFT' | 'AWAITING_PAYMENT' | 'PAID' | 'FULFILLED' | 'CANCELLED';
  patientId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

// The decoded cursor payload: §9's codec turns its versioned token into this
// shape; this repository turns it into a keyset WHERE clause.
export interface OrderListCursor {
  field: 'createdAt' | 'totalCents';
  value: string;
  id: string;
}

export interface OrderListParams {
  practiceId: string;
  filters: OrderListFilters;
  sort: OrderSort;
  // Callers pass pageSize + 1: the extra row is the hasMore probe (§9).
  take: number;
  cursor?: OrderListCursor;
}

export interface CreateOrderData {
  practiceId: string;
  providerId: string;
  patientId: string;
  status: 'DRAFT' | 'AWAITING_PAYMENT';
  totalCents: number;
  items: {
    supplementId: string;
    quantity: number;
    unitCostCents: number;
    unitPriceCents: number;
  }[];
}

export interface OrdersRepository {
  createWithItems(data: CreateOrderData, tx?: Queryable): Promise<OrderWithItems>;
  findById(orderId: string, tx?: Queryable): Promise<OrderWithItems | null>;
  findByIdForPractice(orderId: string, practiceId: string, tx?: Queryable): Promise<OrderWithItems | null>;
  listCursor(params: OrderListParams): Promise<OrderListItem[]>;
  // Transaction-scoped seams for §8's payment flow: the service opens the
  // transaction and calls these with its tx client.
  findForPayment(tx: Queryable, orderId: string): Promise<OrderForPayment | null>;
  transitionToPaid(tx: Queryable, params: { orderId: string; expectedVersion: number }): Promise<number>;
  createPaymentInTx(
    tx: Queryable,
    data: {
      orderId: string;
      amountCents: number;
      method: 'CARD' | 'ACH';
      processorRef: string | null;
      status: string;
    },
  ): Promise<Payment>;
  createSplitInTx(
    tx: Queryable,
    data: {
      orderId: string;
      platformFeeCents: number;
      providerNetCents: number;
      cogsCents: number;
      providerMarginCents: number;
    },
  ): Promise<OrderSplit>;
  lockOrderRowInTx(
    tx: Queryable,
    orderId: string,
  ): Promise<{
    id: string;
    practiceId: string;
    status: string;
    version: number;
    patientUserId: string | null;
  } | null>;
  findItemsInTx(
    tx: Queryable,
    orderId: string,
  ): Promise<Array<{ id: string; quantity: number; unitCostCents: number; unitPriceCents: number }>>;
}

const DETAIL_INCLUDE = { items: { include: { supplement: true } } } satisfies Prisma.OrderInclude;
const PAYMENT_INCLUDE = { items: true, patient: true } satisfies Prisma.OrderInclude;

const ORDER_BY: Record<OrderSort, Prisma.OrderOrderByWithRelationInput[]> = {
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
  total_desc: [{ totalCents: 'desc' }, { id: 'desc' }],
};

// Keyset predicate for one page boundary: strictly before (or after) the
// cursor row, with the id as the tiebreaker for equal sort values.
function keysetWhere(sort: OrderSort, cursor: OrderListCursor): Prisma.OrderWhereInput {
  const tieId = cursor.id;
  if (sort === 'newest' || sort === 'oldest') {
    if (cursor.field !== 'createdAt') {
      throw new ValidationError(`cursor field '${cursor.field}' does not match sort '${sort}'`);
    }
    const at = new Date(cursor.value);
    if (Number.isNaN(at.getTime())) {
      throw new ValidationError('cursor value is not an ISO 8601 timestamp');
    }
    return sort === 'newest'
      ? { OR: [{ createdAt: { lt: at } }, { AND: [{ createdAt: { equals: at } }, { id: { lt: tieId } }] }] }
      : { OR: [{ createdAt: { gt: at } }, { AND: [{ createdAt: { equals: at } }, { id: { gt: tieId } }] }] };
  }
  if (cursor.field !== 'totalCents') {
    throw new ValidationError(`cursor field '${cursor.field}' does not match sort 'total_desc'`);
  }
  const total = Number(cursor.value);
  if (!Number.isInteger(total)) {
    throw new ValidationError('cursor value is not an integer total');
  }
  return {
    OR: [
      { totalCents: { lt: total } },
      { AND: [{ totalCents: { equals: total } }, { id: { lt: tieId } }] },
    ],
  };
}

export class PrismaOrdersRepository implements OrdersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createWithItems(data: CreateOrderData, tx?: Queryable): Promise<OrderWithItems> {
    const db = tx ?? this.prisma;
    return db.order.create({
      data: {
        practiceId: data.practiceId,
        providerId: data.providerId,
        patientId: data.patientId,
        status: data.status,
        totalCents: data.totalCents,
        items: { create: data.items },
      },
      include: DETAIL_INCLUDE,
    });
  }

  async findById(orderId: string, tx?: Queryable): Promise<OrderWithItems | null> {
    const db = tx ?? this.prisma;
    return db.order.findUnique({ where: { id: orderId }, include: DETAIL_INCLUDE });
  }

  // Tenant scoping lives here, not in the controller: a caller who names
  // another practice's order gets the same null a missing id produces, which
  // the route renders as 404 — never 403 for tenant leaks (§6).
  async findByIdForPractice(orderId: string, practiceId: string, tx?: Queryable): Promise<OrderWithItems | null> {
    const db = tx ?? this.prisma;
    return db.order.findFirst({
      where: { id: orderId, practiceId },
      include: DETAIL_INCLUDE,
    });
  }

  async listCursor(params: OrderListParams): Promise<OrderListItem[]> {
    const where: Prisma.OrderWhereInput = { practiceId: params.practiceId };
    if (params.filters.status !== undefined) {
      where.status = params.filters.status;
    }
    if (params.filters.patientId !== undefined) {
      where.patientId = params.filters.patientId;
    }
    if (params.filters.createdAfter !== undefined || params.filters.createdBefore !== undefined) {
      where.createdAt = { gte: params.filters.createdAfter, lte: params.filters.createdBefore };
    }

    const keyset = params.cursor === undefined ? undefined : keysetWhere(params.sort, params.cursor);
    return this.prisma.order.findMany({
      where: keyset === undefined ? where : { AND: [where, keyset] },
      orderBy: ORDER_BY[params.sort],
      take: params.take,
    });
  }

  async findForPayment(tx: Queryable, orderId: string): Promise<OrderForPayment | null> {
    return tx.order.findUnique({ where: { id: orderId }, include: PAYMENT_INCLUDE });
  }

  // The optimistic lock §8 composes: one UPDATE that lands only while the row
  // still shows the state the caller read. count === 0 means another writer
  // moved the row first.
  async transitionToPaid(tx: Queryable, params: { orderId: string; expectedVersion: number }): Promise<number> {
    const result = await tx.order.updateMany({
      where: {
        id: params.orderId,
        status: 'AWAITING_PAYMENT',
        version: params.expectedVersion,
      },
      data: { status: 'PAID', version: { increment: 1 } },
    });
    return result.count;
  }

  async createPaymentInTx(
    tx: Queryable,
    data: {
      orderId: string;
      amountCents: number;
      method: 'CARD' | 'ACH';
      processorRef: string | null;
      status: string;
    },
  ): Promise<Payment> {
    return tx.payment.create({
      data: {
        orderId: data.orderId,
        amountCents: data.amountCents,
        method: data.method,
        processorRef: data.processorRef,
        status: data.status,
      },
    });
  }

  async createSplitInTx(
    tx: Queryable,
    data: {
      orderId: string;
      platformFeeCents: number;
      providerNetCents: number;
      cogsCents: number;
      providerMarginCents: number;
    },
  ): Promise<OrderSplit> {
    return tx.orderSplit.create({
      data: {
        orderId: data.orderId,
        platformFeeCents: data.platformFeeCents,
        providerNetCents: data.providerNetCents,
        cogsCents: data.cogsCents,
        providerMarginCents: data.providerMarginCents,
      },
    });
  }

  // The pessimistic variant (§8): a raw SELECT with FOR UPDATE, run on the
  // transaction's own connection so the row lock is held to commit. The join
  // brings the patient's user id for the ownership check, and FOR UPDATE OF o
  // locks only the Order row, not the patient row.
  async lockOrderRowInTx(
    tx: Queryable,
    orderId: string,
  ): Promise<{
    id: string;
    practiceId: string;
    status: string;
    version: number;
    patientUserId: string | null;
  } | null> {
    const locked = await tx.$queryRaw<
      Array<{ id: string; practiceId: string; status: string; version: number; patientUserId: string | null }>
    >`
      SELECT o."id", o."practiceId", o."status"::text, o."version", p."userId" AS "patientUserId"
      FROM "Order" o
      JOIN "Patient" p ON p."id" = o."patientId"
      WHERE o."id" = ${orderId}::uuid
      FOR UPDATE OF o
    `;
    return locked[0] ?? null;
  }

  async findItemsInTx(
    tx: Queryable,
    orderId: string,
  ): Promise<Array<{ id: string; quantity: number; unitCostCents: number; unitPriceCents: number }>> {
    return tx.orderItem.findMany({
      where: { orderId },
      select: { id: true, quantity: true, unitCostCents: true, unitPriceCents: true },
    });
  }
}
```

§9 builds its full HTTP pagination flow — the shared query-builder, the versioned cursor codec,
and the +1 hasMore probe — on exactly this `listCursor` shape: its codec decodes the token into
the `OrderListCursor` payload this method expects, and its service passes `take = limit + 1` and
slices the result.

The users repository is the canonical file; §5's authentication flow already imports it:

```ts
// src/users/users.repository.ts
import { Prisma, PrismaClient } from '@prisma/client';
import type { Role } from '../auth/types.js';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  role: Role;
  practiceId: string | null;
}

export class UsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return db.user.findUnique({ where: { email } });
  }

  async findById(id: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return db.user.findUnique({ where: { id } });
  }

  async create(data: CreateUserInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return db.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role,
        practiceId: data.practiceId,
      },
    });
  }
}
```

Hashing is *not* here. `findByEmail` returns the row including `passwordHash`; §5's service
compares hashes and decides what persistence needs — the repository executes, the service decides.

### The composition root: src/container.ts

Wiring is a one-time, top-down activity: construct the client, construct repositories with it,
construct services with the repositories. The container is the single file that knows concrete
class names; everything below it depends on interfaces and receives instances.

```ts
// src/container.ts
import type { PrismaClient } from '@prisma/client';
import { prisma } from './shared/db/prisma.js';
import { PrismaOrdersRepository, type OrdersRepository } from './orders/orders.repository.js';
import { UsersRepository } from './users/users.repository.js';
import { OrderService } from './orders/order.service.js';

export interface Container {
  prisma: PrismaClient;
  users: UsersRepository;
  orders: OrdersRepository;
  orderService: OrderService;
}

export function buildContainer(): Container {
  const users = new UsersRepository(prisma);
  const orders = new PrismaOrdersRepository(prisma);
  const orderService = new OrderService(orders);

  return { prisma, users, orders, orderService };
}

export const container: Container = buildContainer();
```

Three notes on what the container is for. First, feature routers receive their dependencies from
it in `src/app.ts` — §5 showed the auth slice of that wiring (`createAuthRouter({ users,
refreshTokens, db })`); those instances come from this container, not from a second `new
PrismaClient()`. Second, `OrderService` is §8's payment flow; it lands here the moment that
section's file exists. Third, tests never import this singleton — §13 builds a fresh container
per run pointed at a throwaway database, which is the whole reason construction is a function
rather than a module-load side effect.

### Common mistakes

- **Business rules leaking into repositories.** The moment a repository method computes the money
  split, or cancels stale orders as a side effect of a read, the rule is untestable without a
  database, invisible at the service layer, and duplicated the second time another caller needs
  the same data differently. *Production failure:* two code paths apply the same rule with
  different constants, and reconciliation finds orders that were "canceled" by one and not the
  other. *Fix:* repositories execute data access — queries, writes, tenancy WHERE clauses;
  every rule lives in a service. A quick review test: a repository file should be readable as a
  list of capabilities, with no policy in it.
- **N+1 via a missing include.** Fetching orders, then looping `order.items` per order issues
  `1 + N` queries per page. *Production failure:* the orders list is fast with seed data and
  degrades linearly with page size and practice size — p99 grows with the customer's success,
  which is the worst kind of scaling law. *Fix:* one `findMany` with the `include` that carries
  items (and supplements where the response needs them); with dev query events on, the N+1 is
  visible in the terminal immediately.
- **Missing composite index for the list query.** `WHERE "practiceId" = $1 ORDER BY "createdAt"
  DESC` without `@@index([practiceId, createdAt])` degrades to a sequence scan plus an explicit
  sort as the orders table grows. *Production failure:* `GET /v1/orders` times out at a hundred
  thousand rows for the biggest practice while every other endpoint stays fast, because only this
  query filters *and* sorts across the whole tenant. *Fix:* the composite index with the equality
  column leftmost; verify with `EXPLAIN ANALYZE` that the plan is an index scan, and remember the
  sort direction of the keyset predicate must match the index (§9).
- **Modeling cents as BigInt.** JavaScript `number` handles cents to 2^53, but a `BigInt` column
  arrives in TypeScript as `bigint`, and `JSON.stringify` throws `Do not know how to serialize a
  BigInt`. *Production failure:* every endpoint that returns the affected row starts returning
  500s the moment the column type flips — the error happens at serialization time, deep in the
  response path, not at the query. *Fix:* `Int` columns (headroom ≈ $21.47M per value); if a
  column must grow to `BigInt`, serialization becomes explicit work — map to string in a
  serializer before anything calls `res.json`.
- **Connection-pool exhaustion under concurrency.** An interactive transaction holds its pool
  connection for the transaction's entire life. Long transactions, external HTTP inside a
  transaction, or one connection_limit shared across many concurrent requests stack into pool
  timeouts (`P2024`). *Production failure:* the API appears frozen — every new request waits
  `pool_timeout` (default 10 seconds) and 500s, while Postgres itself is healthy. *Fix:* keep
  transactions short (§8's is five statements), never call external services inside one, and
  size `connection_limit` explicitly per §15's container sizing.
- **P2025 misuse for control flow.** Wrapping every `update`/`delete` in a try/catch to catch
  P2025 ("record not found") conflates a normal miss with an exceptional one — and since §10's
  mapper renders P2025 as 404, a genuine concurrent-state conflict surfaces as "not found," which
  hides the race from both the client and your dashboards. *Fix:* reads that may miss use
  `findUnique` and check for null; guarded writes use `updateMany` and check the count (§8);
  reserve P2025 handling for the §10 mapper.

### Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `P1001: Can't reach database server` at boot, in every environment | Postgres container down, or `DATABASE_URL` points at the wrong host/port | bring the compose stack up (§15); print the URL's host and port when diagnosing — never the credentials |
| `P2002: Unique constraint failed` on `User.email` during registration | two register requests for the same email raced | expected under concurrency — §10's mapper renders P2002 as 409; the client retries and sees the account exists |
| `P2003: Foreign key constraint failed` while seeding or creating orders | entities created in the wrong order (an order before its patient), or an id from another practice | create in FK order (practice → users → patients → supplements → order → items); validate tenancy in the service before the insert |
| `P2021`/`P2022: table/column does not exist` in production only | migrations were never applied in the release pipeline | run `npx prisma migrate deploy` before the new code serves traffic (§15's pipeline ordering); check `_prisma_migrations` for the missing entry |
| `migrate dev` fails in CI with shadow-database permission errors | the CI database role cannot create databases | grant `CREATEDB` to the CI role, or point `SHADOW_DATABASE_URL` at a disposable database |
| Query logs flood production stdout | query events enabled in every environment | the per-environment log configuration in `src/shared/db/prisma.ts` — warnings and errors only in production |
