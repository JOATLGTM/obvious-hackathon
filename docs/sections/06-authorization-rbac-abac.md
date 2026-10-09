## 6. Authorization: RBAC, ABAC, and a Policy Engine

Authentication (section 5) establishes *who* is calling. Authorization answers a different
question about a different object: *may this caller do this thing to this particular resource?*
SupplementDirect's answer has two layers — role checks (RBAC) and attribute checks (ABAC) — wired
through one policy engine so the answer to "who may read order `ord_9f2`?" lives in exactly one
place, is testable as a pure function, and fails closed.

### RBAC and ABAC are layers, not rivals

Treating "RBAC vs ABAC" as an either/or is the wrong frame. They answer different questions and
stagger in cost:

**RBAC** checks a static property of the caller — the `role` claim the access token already
carries. It needs no database access and no knowledge of any particular resource. It answers
"*what kind of actor is this?*" and protects whole classes of endpoints: patients do not get to
touch order-creation routes at all, whatever the attributes say. It is the coarse gate.

**ABAC** checks attributes of the actor and of *the specific resource being touched* — is this
provider the one who wrote this order? Does this patient belong to this practice? It answers "*the
relationship between this actor and this row?*" and requires loading the resource first. It is the
fine-grained gate.

Each layer alone fails in a characteristic way. RBAC alone either over-grants (every PROVIDER may
read every order in the practice — including orders another provider assembled for a patient who
has since complained about privacy) or metastasizes into hand-rolled `if` statements per endpoint
that drift apart over time. ABAC alone forces every policy to re-encode role logic internally
("if actor is a patient, the actor must be the patient on the order; if a provider, the writer; if
an admin, the admin of the owning practice") — so your cheap, cacheable role knowledge gets
re-evaluated with a database load
behind it even for routes that should have been rejected before touching anything.

Together they compose cleanly: the role gate rejects the wrong *kind* of actor before any I/O;
the attribute policies then decide the rest, on the resource, with data.

**Deny by default** is the organizing rule at every level of this design, not a slogan:

- an unauthenticated request gets 401 before any route logic runs (section 5's `authenticate`);
- a role not on the route's allow-list gets 403, even if deeper checks would have passed;
- a `resourceType:action` pair with no registered policy gets denied by the engine — an
  unregistered pair is a programming error to surface loudly, not an implicit grant;
- a loader that cannot find the resource yields 404 — the visibility pin from the shared
  contract: "missing" and "exists but not visible to you" are deliberately indistinguishable, so
  probing IDs from another tenant reveals nothing.

### Where decisions live

Three places, all running the same engine, on purpose:

1. **Coarse role gate in the router** — `requireRole(['PROVIDER'])` style checks. Cheap, no I/O,
   rejects the wrong kind of actor immediately.
2. **Resource permission check per route** — `requirePermission('order', 'read', loadOrder)`
   loads the row via a repository loader, runs the engine's policies against it, and attaches the
   loaded resource for downstream handlers.
3. **Service-layer re-check for sensitive writes** — money-moving operations (payment, in
   section 8) re-run the decision inside the service with freshly loaded data. Reasons: by the
   time the service executes, state may have changed since the middleware loaded the row
   (time-of-check to time-of-use); and services are also invoked from jobs and other services
   where no HTTP middleware ran. The service check is the last line of defense, not a duplicate.

What is deliberately *not* a place decisions live: controllers. They stay thin (the shared
layering pin) — an authorization rule scattered in a controller cannot be audited or tested as a
unit, and it will drift from the same rule pasted into its sibling endpoint. Every rule below is a
pure function in one file, registered in one table.

### The types: src/authz/types.ts

```ts
// src/authz/types.ts
import type { ReqUser } from '../auth/types';

export type Action = 'read' | 'create' | 'pay' | 'cancel' | 'manage';

export type ResourceType = 'order' | 'patient' | 'supplement' | 'user';

export interface AuthzContext {
  actor: ReqUser;
  resource: {
    type: ResourceType;
    data?: Record<string, unknown>;
  };
}

export interface Decision {
  allow: boolean;
  reason: string;
}

export type Policy = (ctx: AuthzContext) => Decision;
```

`ReqUser` comes from section 5 (`{ id, role, practiceId }` — exactly the claims the authenticate
middleware attaches). The `resource.data` bag is where loaders place the resource's attributes;
the attribute contract each policy expects is documented in the table below. Every policy is a
pure function of the context — no I/O, no Prisma, no clock reads — which is what makes them
table-testable and immune to the "policies that secretly query" trap.

### The policies: src/authz/policies.ts

Policies are conditions, not grants: each inspects the context and either passes or names a
specific reason it did not. Reasons matter twice — they become the `ForbiddenError` detail the
client sees (section 10), and they are what you grep when someone reports a mysterious 403. Keep
them free of anything you would not return to that client anyway; log details server-side
(section 11).

```ts
// src/authz/policies.ts
import type { Action, AuthzContext, Decision, Policy, ResourceType } from './types';
import { register } from './engine';

function attr(ctx: AuthzContext, key: string): unknown {
  return ctx.resource.data === undefined ? undefined : ctx.resource.data[key];
}

function deny(reason: string): Decision {
  return { allow: false, reason };
}

function allow(reason: string): Decision {
  return { allow: true, reason };
}

// Staff of the same practice: the actor must be an ADMIN or PROVIDER whose practiceId matches
// the resource's practiceId. PATIENT accounts are never practice staff (their practiceId is
// null — section 5), so they fail the first branch even if they somehow match on practice.
export const samePractice: Policy = (ctx) => {
  const { actor } = ctx;
  if (actor.role !== 'ADMIN' && actor.role !== 'PROVIDER') {
    return deny('requires practice staff (ADMIN or PROVIDER)');
  }
  if (actor.practiceId === null) {
    return deny('actor does not belong to a practice');
  }
  const resourcePracticeId = attr(ctx, 'practiceId');
  if (typeof resourcePracticeId !== 'string') {
    return deny('resource carries no practice attribute');
  }
  if (resourcePracticeId !== actor.practiceId) {
    return deny('resource belongs to a different practice');
  }
  return allow(`actor is ${actor.role} of the practice that owns this resource`);
};

// Order visibility, per the shared contract: the order's provider, the order's patient, or an
// ADMIN of the practice that owns the order. The loader must resolve patientUserId (the user
// account linked to the patient row) because policies are pure and cannot query.
export const orderVisible: Policy = (ctx) => {
  const { actor } = ctx;
  if (actor.id === attr(ctx, 'providerId')) {
    return allow('actor is the provider who created this order');
  }
  if (actor.id === attr(ctx, 'patientUserId')) {
    return allow('actor is the patient on this order');
  }
  if (actor.role === 'ADMIN' && actor.practiceId === attr(ctx, 'practiceId')) {
    return allow('actor is an admin of the practice that owns this order');
  }
  return deny('requires the order provider, the patient on the order, or an admin of the owning practice');
};

// Payments: only the patient on the order pays it. The domain contract says the patient pays
// SupplementDirect directly — a provider or admin must never be able to trigger a charge.
export const orderPatient: Policy = (ctx) => {
  if (ctx.actor.role !== 'PATIENT') {
    return deny('payments are made by the patient');
  }
  if (ctx.actor.id === attr(ctx, 'patientUserId')) {
    return allow('actor is the patient on this order');
  }
  return deny('only the patient on this order can pay it');
};

// Self-service on a patient record: the actor is the human the record belongs to.
export const patientSelf: Policy = (ctx) => {
  if (ctx.actor.id === attr(ctx, 'userId')) {
    return allow('actor is this patient');
  }
  return deny('requires the patient record owner');
};

// Self-service on a user record (the row's id is the actor's id).
export const selfUser: Policy = (ctx) => {
  if (ctx.actor.id === attr(ctx, 'id')) {
    return allow('actor is this user');
  }
  return deny('requires the record owner');
};

export const adminOnly: Policy = (ctx) => {
  if (ctx.actor.role === 'ADMIN') {
    return allow('actor is an admin');
  }
  return deny('requires the ADMIN role');
};

// Catalog reads: any authenticated caller. Registered explicitly so the pair is never mistaken
// for an unregistered (deny-by-default) one.
export const allowAuthenticated: Policy = () => {
  return allow('any authenticated caller');
};

// The registry population — one glance shows the whole permission surface. The composition
// root calls this once at startup (section 2).
export function registerDefaultPolicies(): void {
  register('order', 'read', [orderVisible]);
  register('order', 'create', [samePractice]);
  register('order', 'pay', [orderPatient]);
  register('order', 'cancel', [orderVisible]);
  register('order', 'manage', [adminOnly, samePractice]);
  register('patient', 'read', [patientSelf]);
  register('patient', 'create', [samePractice]);
  register('supplement', 'read', [allowAuthenticated]);
  register('user', 'read', [selfUser]);
}
```

Note the deliberate narrowness of the patient table: `patient:read` is self-only. Staff do not
read raw patient records through this API — they work through orders, which `orderVisible`
governs. That is a least-privilege choice for PII, not an oversight, and it is the kind of choice
that is impossible to audit when policies live in controllers.

The attribute contract — what each loader must project into `resource.data`:

| Policy | Required `resource.data` attributes |
|---|---|
| `samePractice` | `practiceId` |
| `orderVisible` | `providerId`, `patientUserId`, `practiceId` |
| `orderPatient` | `patientUserId` |
| `patientSelf` | `userId` |
| `selfUser` | `id` |
| `adminOnly`, `allowAuthenticated` | none |

If the schema in section 7 lands differently than expected (say, `Patient` links to its user
account under another name), the loader adapts — the policy and its contract stay untouched.

### The engine: src/authz/engine.ts

The registry maps `${resourceType}:${action}` to the list of policies that must all pass.
`authorize` denies unless **every** applicable policy allows.

```ts
// src/authz/engine.ts
import type { ReqUser } from '../auth/types';
import type { Action, AuthzContext, Decision, Policy, ResourceType } from './types';

const RESOURCE_TYPES: readonly ResourceType[] = ['order', 'patient', 'supplement', 'user'];
const ACTIONS: readonly Action[] = ['read', 'create', 'pay', 'cancel', 'manage'];

const registry = new Map<string, Policy[]>();

function pairKey(resourceType: ResourceType, action: Action): string {
  return `${resourceType}:${action}`;
}

export function register(resourceType: ResourceType, action: Action, policies: Policy[]): void {
  // Typo defense: 'orde:read' registered by mistake would silently deny everything for that
  // pair. Validate against the unions and fail at startup, not in production.
  if (!RESOURCE_TYPES.includes(resourceType)) {
    throw new Error(`Unknown resource type: ${resourceType}`);
  }
  if (!ACTIONS.includes(action)) {
    throw new Error(`Unknown action: ${action}`);
  }
  registry.set(pairKey(resourceType, action), policies);
}

export function authorize(action: Action, ctx: AuthzContext): Decision {
  const applicable = registry.get(pairKey(ctx.resource.type, action));
  if (applicable === undefined || applicable.length === 0) {
    // Deny by default: an unregistered pair is a bug to surface, never an implicit grant.
    return { allow: false, reason: `no policy registered for ${ctx.resource.type}:${action}` };
  }
  for (const policy of applicable) {
    const decision = policy(ctx);
    if (!decision.allow) {
      return decision; // AND semantics: the first failing condition wins, with its reason
    }
  }
  return { allow: true, reason: `all ${applicable.length} condition(s) passed` };
}

// Service-layer helper for re-checks (see the payOrder pattern below). Returns a boolean for
// ergonomics; use authorize directly when the reason matters.
export function can(
  actor: ReqUser,
  resourceType: ResourceType,
  action: Action,
  data?: Record<string, unknown>,
): boolean {
  return authorize(action, { actor, resource: { type: resourceType, data } }).allow;
}

// For startup self-tests and the integration-test matrix (section 13): assert that every
// route's pair is registered.
export function registeredPairs(): string[] {
  return Array.from(registry.keys()).sort();
}
```

**Why AND and not OR.** This is the load-bearing design decision in the engine, so it deserves
its reasoning in the open. The registered policies are *conditions* — constraints that must all
hold — not *grants*, any one of which would suffice. With AND, adding a policy to a pair can only
shrink the allowed set: the system fails safe, and `register('order', 'manage', [adminOnly,
samePractice])` means exactly "an admin *of that practice*" — two conditions, one intersection.
With OR (any policy that allows wins), adding a policy can only *widen* access: every addition
becomes a potential privilege escalation, a forgotten registration becomes an implicit grant, and
"deny" becomes unstateable. OR-flavored "any of these roles may act" logic still exists — but it
lives *inside* one policy (see `orderVisible`, which internally branches over provider, patient,
and admin), keeping the registry itself purely conjunctive. One registry, one semantic, no
exceptions to memorize.

### The middleware: src/authz/middleware.ts

```ts
// src/authz/middleware.ts
import type { Request, RequestHandler } from 'express';
import type { Role } from '../auth/types';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../errors';
import { authorize } from './engine';
import type { Action, ResourceType } from './types';

// A loader fetches the resource's attributes for the policy engine. It returns null for
// "does not exist OR is not visible to this caller" — both become 404 (the visibility pin).
export type ResourceLoader = (req: Request) => Promise<Record<string, unknown> | null>;

export function requirePermission(
  resourceType: ResourceType,
  action: Action,
  loader: ResourceLoader,
): RequestHandler {
  return async (req, res, next) => {
    try {
      if (req.user === undefined) {
        throw new UnauthorizedError('Authentication required');
      }
      const data = await loader(req);
      if (data === null) {
        // Absent or not visible: 404, never 403, so probing IDs across tenants reveals nothing.
        throw new NotFoundError('Resource not found');
      }
      const decision = authorize(action, {
        actor: req.user,
        resource: { type: resourceType, data },
      });
      if (!decision.allow) {
        throw new ForbiddenError(decision.reason);
      }
      res.locals.resource = data; // downstream handlers reuse the row instead of re-querying
      next();
    } catch (err) {
      next(err); // ApiError subclasses reach the section 10 handler
    }
  };
}

// The coarse gate: role checks with no resource I/O. Takes an array rather than rest params so
// call sites read requireRole(['PROVIDER']).
export function requireRole(roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (req.user === undefined) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError(`requires role: ${roles.join(' or ')}`));
      return;
    }
    next();
  };
}
```

### Wiring: the orders router

The full orders feature (controllers, the service, the repository) is section 7 and section 8's
deliverable; what this section contributes is the authorization wiring, shown in full, plus the
two contracts it imposes on section 7: a visibility-scoped repository read and a projection that
satisfies the policy attribute table.

```ts
// src/orders/orders.router.ts
import { Router } from 'express';
import { patientsRepository } from '../patients/patients.repository';
import { ordersController } from './orders.controller';
import { ordersRepository } from './orders.repository';
import { requirePermission, requireRole, type ResourceLoader } from '../authz/middleware';

// For reads, the loader is visibility-scoped: it queries "this order, visible to this actor"
// and returns null when that fails. Section 7's repository gains the method shown after this
// file. Absence and cross-tenant presence both become null — and both become 404.
const loadVisibleOrder: ResourceLoader = async (req) => {
  const actor = req.user;
  if (actor === undefined) {
    return null; // requirePermission 401s before loaders run; this keeps the type honest
  }
  const row = await ordersRepository.findVisibleWithPatientUser(actor, req.params.id);
  if (row === null) {
    return null;
  }
  return {
    id: row.id,
    practiceId: row.practiceId,
    providerId: row.providerId,
    patientId: row.patientId,
    patientUserId: row.patient.userId,
    status: row.status,
    totalCents: row.totalCents,
    version: row.version,
  };
};

// For creation, the resource being authorized is the PATIENT the order targets: a provider may
// assemble an order for a patient of their own practice (samePractice on the patient row).
const loadCreateTargetPatient: ResourceLoader = async (req) => {
  const patientId = req.body === undefined ? undefined : (req.body as Record<string, unknown>).patientId;
  if (typeof patientId !== 'string') {
    return null; // validation middleware (section 4) rejects malformed bodies earlier
  }
  const patient = await patientsRepository.findById(patientId);
  if (patient === null) {
    return null;
  }
  return {
    id: patient.id,
    practiceId: patient.practiceId,
    userId: patient.userId,
  };
};

export const ordersRouter = Router();

ordersRouter.post(
  '/',
  requireRole(['PROVIDER']),
  requirePermission('order', 'create', loadCreateTargetPatient),
  ordersController.create,
);

ordersRouter.get(
  '/:id',
  requirePermission('order', 'read', loadVisibleOrder),
  ordersController.getById,
);

// Lists cannot run an item-level policy — there is no single resource to check. Enforcement
// moves into the repository's WHERE clause: the list query filters by the actor's practiceId.
// The role gate stays here. A list query without the tenant filter is the classic
// cross-tenant leak; see Common mistakes.
ordersRouter.get(
  '/',
  requireRole(['ADMIN', 'PROVIDER']),
  ordersController.list,
);
```

The section 7 repository method the loader depends on — the tenant filter made concrete:

```ts
// src/orders/orders.repository.ts — the one method section 6 depends on, in full. The visibility
// conditions live in the query itself, so a cross-tenant id simply does not match any row.
import { PrismaClient, Prisma } from '@prisma/client';
import type { ReqUser } from '../auth/types';

export class OrdersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findVisibleWithPatientUser(actor: ReqUser, id: string) {
    const clauses: Prisma.OrderWhereInput[] = [
      { providerId: actor.id },
      { patient: { userId: actor.id } },
    ];
    if (actor.role === 'ADMIN' && actor.practiceId !== null) {
      clauses.push({ practiceId: actor.practiceId });
    }
    return this.prisma.order.findFirst({
      where: {
        id,
        OR: clauses,
      },
      include: {
        patient: { select: { id: true, userId: true } },
      },
    });
  }
}
```

And the service-layer re-check pattern for the money path — the section 8 service carries the
full payment logic; this is the authorization slice it must include:

```ts
// src/orders/orders.service.ts — the re-check pattern; the complete service is section 8.
import { ForbiddenError, NotFoundError } from '../errors';
import type { ReqUser } from '../auth/types';
import { can } from '../authz/engine';
import { ordersRepository } from './orders.repository';

export async function payOrder(actor: ReqUser, orderId: string): Promise<void> {
  // Fresh load inside the service: the row the middleware loaded may be stale by the time the
  // money moves, and services also run from jobs where no middleware ran at all.
  const order = await ordersRepository.findVisibleWithPatientUser(actor, orderId);
  if (order === null) {
    throw new NotFoundError('Order not found');
  }
  if (!can(actor, 'order', 'pay', order)) {
    throw new ForbiddenError('Only the patient on this order can pay it');
  }
  // The payment transaction, the optimistic lock, and the idempotency key are section 8's
  // subject. The authorization decision above is the part this section contributes to it.
}
```

### The permission matrix

What the registry above means, per role, for the order resource:

| Action | PATIENT | PROVIDER | ADMIN |
|---|---|---|---|
| `order:read` | own orders | the ones they wrote | all orders of their practice |
| `order:create` | — | for patients of their own practice | — |
| `order:pay` | own orders | — | — |
| `order:cancel` | own orders | the ones they wrote | all orders of their practice |
| `order:manage` | — | — | all orders of their practice |

Two clarifications the matrix cannot carry. First, `order:cancel` says nothing about *which
statuses* permit cancellation — "may this actor cancel a paid order" is domain logic in the
section 8 service; authorization answers only "may this actor cancel an order they can see."
Second, other resource types follow the registry directly: `patient:read` is self-only (staff work
through orders), `patient:create` is practice staff, `supplement:read` is any authenticated
caller, `user:read` is self.

### Common mistakes

- **Trusting client-sent role.** Reading `role` from the request body or an `x-role` header means
  any caller can self-promote to ADMIN with one extra JSON field — complete privilege escalation,
  audit trail intact, because the logs faithfully record the attacker's claimed role. The fix:
  role exists in exactly one place — the signed access token's claims (section 5) — and the
  registration schema deliberately offers only PROVIDER and PATIENT; ADMIN accounts are
  provisioned internally, never through public self-service.
- **Allow-by-default engines.** An engine that returns "allow" when it finds no policies (or an
  endpoint that forgets its middleware) turns every future omission into an open door; the failure
  is invisible because nothing errors — data just leaks. The fix: deny unregistered pairs (the
  engine above does), and add an integration test (section 13) that walks every route and asserts
  its `resourceType:action` pair is registered, via `registeredPairs()`.
- **Policies scattered across controllers.** "Is this your order?" pasted into five handlers
  drifts into five different answers, cannot be unit-tested in isolation, and makes an audit
  ("who can read an order?") a multi-file archaeology project. The fix: pure functions in
  `policies.ts`, registered in one table; controllers stay thin; policies get table-driven unit
  tests with no HTTP or database involved.
- **Missing tenant filter in the repository.** The subtle one. A policy that checks `practiceId`
  on a row the repository happily fetched across tenants is not wrong — it is *vacuous* where it
  matters: list endpoints return other practices' rows and no item-level policy ever runs on
  them, so the API leaks by construction. The fix: tenant and visibility conditions belong in the
  repository's `WHERE` clause (the only Prisma-aware layer), with policies as the second gate —
  and integration tests that assert cross-tenant IDs get 404 on both item and list routes.
- **Caching decisions across tenants.** Memoizing `allow` under a key like `order:read:9f2`
  (missing the actor's id, role, and practice) serves practice A's affirmative decision to
  practice B's identical request. The fix: authorization decisions here are cheap pure functions
  over an already-loaded row — do not cache them at all. If a genuinely expensive loader ever
  forces caching, the key must include the full context (actor id, role, practiceId, resource id
  and version) and the entry must die on role change.
- **Returning 403 for cross-tenant lookups.** "Forbidden" confirms the resource exists — a
  directory-discovery oracle handed to anyone who can iterate IDs. The fix, per the visibility
  pin: loaders scope visibility into the query and return null, so absence and invisibility are
  both 404; 403 with a reason is reserved for same-tenant, wrong-relationship denies where the
  caller already knew the resource existed.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Everything 403s with "no policy registered for order:read" | `registerDefaultPolicies()` was never called in the composition root, or the route uses a different action string than the registry | Call the registrar once at startup; add a test asserting every routed pair appears in `registeredPairs()` |
| `orderVisible` denies the provider who created the order | The loader projected different attribute names (or types) than the policy reads — `providerId` mismatch makes every branch fail | Check the attribute contract table; log the context (server-side) when a deny happens; fix the loader's projection, not the policy |
| Deny reason says "resource carries no practice attribute" | The loader returned a projection that omits `practiceId`, or the row genuinely has none | Include `practiceId` in the loader's projection; verify the underlying row's tenant column is populated |
| `GET /v1/orders/:id` returns 403 for another practice's order id (should be 404) | The loader is a bare `findById` without visibility scoping, so the engine's deny surfaces as ForbiddenError | Use the visibility-scoped `findVisibleWithPatientUser` in the loader; the policy remains the second gate |
| A PATIENT reads the practice's order list | The list route lacks the role gate, or the repository's list query lacks the `practiceId` filter | Add `requireRole` and the tenant filter to the list query; add a cross-tenant list test |
| Authorization works in dev, leaks "sometimes" in staging | A decision or row cache keyed without the actor's practice/id — different tenants hit the same entry | Remove the decision cache (decisions are cheap); if a loader cache exists, key on the full context and version |
