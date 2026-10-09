## Glossary

Definitions for terms of art used in sections 1–17. Each entry states what the term is and where this document relies on it; section cross-references appear in parentheses.

Entries beginning with a number or symbol are grouped first, then A through Z, alphabetized case-insensitively.

**401 Unauthorized** — The HTTP status for missing, expired, or invalid credentials, where authenticating may fix the request. §10 raises it as the UnauthorizedError class when a bearer token fails verification (see §§5, 10).

**403 Forbidden** — The HTTP status for an authenticated caller who is not allowed the action. §10 raises it as the ForbiddenError class, and §6's engine supplies the denial reason in the detail (see §§6, 10).

**404 Not Found** — The HTTP status for a resource that does not exist or is not visible to the caller. The document pins tenant leaks as 404 rather than 403 so error responses reveal nothing about other practices' data (see §§1, 10).

**409 Conflict** — The HTTP status for a state clash such as a duplicate key, a stale optimistic version, or a payment already in flight. §8 uses it for double submits and in-progress requests, and §10 maps the duplicate-key error code there (see §§8, 10).

**413 Payload Too Large** — The HTTP status returned when a request body exceeds the server's body limit. §3 compares how Express, Fastify, and Hono each set that limit and emit this status (see §3).

**422 Unprocessable Content** — The HTTP status for a body that parses but fails validation rules. §10 raises it through its typed error hierarchy, folding validation issues into an errors array with dotted paths (see §§4, 10).

**429 Too Many Requests** — The HTTP status for a caller that exceeded a rate limit. §12 returns it with the RateLimit headers and a Retry-After value clients are expected to honor (see §§10, 12).

**500 Internal Server Error** — The HTTP status for unexpected server-side failure. §10's mapper converts anything uncaught into a problem document that leaks no internals (see §10).

**.dockerignore** — A file listing the paths Docker excludes from the build context. §15 uses it to keep node_modules and .git out of builds so context uploads and cache misses stay small (see §15).

**--env-file** — A Node CLI flag that loads environment variables from a file before the process starts. §1 uses it to feed the validated src/config/env.ts module in development (see §1).

**$executeRawUnsafe** — Prisma's method for executing a raw SQL string with no parameter binding. §13 uses it to reset test tables between integration tests, where the SQL is fixed and fully controlled (see §13).

**/health/live** — The liveness endpoint that answers whether the process itself is fit to keep running. §16 implements it with no dependency checks so a stalled database cannot get the pod killed (see §16).

**/health/ready** — The readiness endpoint that answers whether the service can take traffic right now, returning 503 when it cannot. §16 checks Postgres and Redis there with results cached briefly (see §16).

**@hono/node-server** — The adapter package that runs a Hono application on Node.js by translating its fetch-style handlers. §3 uses it so the same Hono code executes on the Node runtime (see §3).

**$ref** — An OpenAPI and JSON Schema keyword that points to a named schema in a shared dictionary of reusable definitions instead of inlining it. §14 uses it to keep generated documents small and single-sourced (see §14).


### A–Z

**ABAC (attribute-based access control)** — An authorization model that decides from attributes of the actor, action, and resource instead of role membership alone. §6 expresses each rule as a small self-contained function and registers every rule in one central engine (see §6).

**AbortSignal.timeout** — The helper that creates an abort signal which fires after a deadline. §16 bounds every dependency check with one so probes cannot hang (see §16).

**Access log** — One log line per HTTP request recording method, path, status, latency, and request id. §11 produces it as structured JSON through the request-logging middleware so it can be queried like any other log (see §11).

**Access token** — The short-lived credential presented on every API call, carried as a bearer token, meaning whoever holds the string can use it. §5 sets its lifetime to 15 minutes and §13 asserts its claims in tests (see §§5, 13).

**ACID** — The transaction guarantees of atomicity, consistency, isolation, and durability. §8 relies on them for the payment-plus-split write while calling out what the default isolation level still leaves open (see §8).

**Action** — The operation a caller attempts, one of the three inputs every authorization decision is computed from alongside the actor and the resource. §6's policies match on action strings such as order creation or patient read (see §6).

**Active context** — OpenTelemetry's per-request storage of the current span chain. §16 backs it with the Node API that keeps values available across await points, so nested spans and logs join the right trace (see §16).

**Actor** — The authenticated principal whose attributes policies evaluate, carrying role and practice in this document. §6 builds it from the verified access token's claims (see §6).

**alg: none attack** — A token exploit where a forged credential declares the "none" algorithm to skip signature verification entirely. §5 blocks it by pinning the allowed algorithm at verification time (see §5).

**Algorithm confusion attack** — A token exploit that makes a verifier expecting an asymmetric algorithm accept tokens signed as a keyed hash using the public key as the secret. §5 prevents it by pinning the signing algorithm and its key type together (see §5).

**Allow-list** — A fixed list of permitted values where everything not listed is rejected. §6 allow-lists roles in middleware and §9 allow-lists sort keys through the closed map of sortable columns (see §§6, 9).

**Alpine (musl)** — A minimal Linux base image family that uses the musl C library instead of the more common GNU variant. §15 weighs it against Debian slim for the runtime stage because native binaries such as the database driver's compiled engine complicate the build (see §15).

**ApiError** — The base class of this document's error hierarchy, carrying code, status, and detail. §10 defines it once so every layer throws typed subclasses the error mapper already understands (see §10).

**Append-mostly workload** — A data pattern where rows are almost always inserted and rarely updated or deleted. §9 uses it to argue that continuation cursors over orders stay stable between pages (see §9).

**Append-only** — A storage property where records are written once and never modified or deleted in place. §17 requires the money record for payments and splits to have this property so it stays provable (see §§8, 17).

**application/problem+json** — The media type marking a response body as an RFC 7807 problem document. §10 sets it on every error response and §13's tests assert it (see §§3, 10, 13).

**Argon2id** — A memory-hard password hashing algorithm with configurable memory, time, and parallelism costs. §5 hashes passwords with it and §13's fixtures rely on its verification path (see §§5, 13).

**Assert-and-hope** — The anti-pattern of trusting input because compiled types say it should be right. §4 names it the failure mode that runtime validation at the trust boundary exists to remove (see §4).

**asyncHandler wrapper** — A small helper that wraps an async route handler so a rejection is forwarded to the error path instead of hanging the request. §10 shows it for Express 4 code, noting Express 5 forwards rejections natively (see §§3, 10).

**AsyncLocalStorage** — The Node API that keeps per-request values available across await points without threading them through every function. §10 and §11 use it for the per-request logger and correlation ids, and §16 for trace context storage (see §§10, 11, 16).

**At-least-once delivery** — A messaging guarantee that an event arrives one or more times, never zero. §8 explains why consumers that treat repeats as no-ops survive such retries without double effects (see §8).

**At-most-once semantics** — A guarantee that an operation takes effect zero or one times, never twice. §8's idempotency keys give the payments endpoint this property under client retries and network replays (see §8).

**Atomicity** — The guarantee that all writes in an operation commit together or none of them do. §8 gets it from database transactions for the split write and §12 from Redis scripts for counters (see §§8, 12).

**Attribute contract** — The documented fields each policy expects the resource-fetching loader to project into the resource's data. §6 tabulates it so changing a loader's projection cannot silently break policy evaluation (see §6).

**Audit trail** — An append-only record of who did what, kept so money movements can be reconstructed and proven. §17 requires order and payment events to persist to the cent (see §§8, 17).

**Auto-instrumentation** — OpenTelemetry libraries that create spans for HTTP, database, and cache calls without application code changes. §16 wires it through the SDK entry point and then adds domain spans on top (see §16).

**Backfill** — A one-time data migration that fills values for existing rows after a schema change. §7 pairs it with expand/contract migrations so old and new code both work during rollout (see §7).

**Backpressure** — The condition where a downstream consumer such as a log transport cannot keep up and upstream must buffer or slow down. §11 manages it with the logging worker thread and §16 with batched exporters (see §§11, 16).

**Barrel file** — An index file that re-exports a folder's modules in one place. §2 bans barrels and requires deep imports because re-export cycles produce load-order bugs (see §2).

**Base64url** — The URL-safe Base64 variant that swaps plus and slash for dash and underscore and drops padding. §5's token segments and §9's cursor tokens are encoded with it (see §§5, 9).

**Base image** — The Docker image a build starts from in its FROM instruction. §15 pins exact tags for it instead of trusting a moving latest alias (see §15).

**Base path** — The leading URL segment every endpoint shares, which is /v1 in this API. §3 wires it into routing and §14 keeps it in the declared server root address rather than in every path (see §§3, 14).

**Basis points (bps)** — Hundredths of one percent, so 75 bps is three quarters of one percent. SupplementDirect's platform fee is 75 bps of the order total, computed in integer cents (see §§1, 8).

**Batch processor** — An OpenTelemetry Collector pipeline component that groups telemetry before sending it onward. §16 uses one so collector exports absorb burst load (see §16).

**BatchSpanProcessor** — The OpenTelemetry SDK component that queues finished spans in the background and exports them in batches. §16 configures it so span export never blocks request handling (see §16).

**Bearer token** — A credential that is valid for whoever holds it, presented as the Authorization header's Bearer value. §5 issues access tokens this way and §13 sends them in tests (see §§5, 13).

**binaryTargets** — The Prisma generator setting listing the platforms whose native query engine binaries to bundle. §15 sets it during the Docker build so the slim runtime image can run the database client (see §15).

**Bind mount** — A Docker Compose mount that maps a host directory into a container. §15 uses one for live source edits in development while Docker-managed storage volumes hold stateful data (see §15).

**Blast radius** — How much damage a compromised or misused component can cause. §5 shrinks the refresh token's blast radius by scoping its cookie to the auth path (see §5).

**Body limit** — The maximum request body size a server accepts before rejecting with 413. §3 compares the setting across Express, Fastify, and Hono (see §3).

**Body parser** — Middleware that reads the request stream into a parsed body object for handlers. §3 shows each framework's parser and where the body limit applies (see §3).

**Boot race** — A failure where a container starts against a dependency that is not ready yet. §15 prevents it with startup-order health conditions rather than sleep delays (see §15).

**Bounded context** — A domain area with its own vocabulary and models that other areas treat opaquely. §2 keeps each feature folder a bounded context so the word order means one thing inside it (see §2).

**Branch protection** — The GitHub setting that blocks direct pushes and requires checks and reviews on a protected branch. §15 pairs it with required status checks so only green code merges (see §15).

**Build context** — The set of files Docker uploads to build an image. §15 trims it with .dockerignore for faster and more cache-friendly builds (see §15).

**Build stage** — The multi-stage Docker stage that compiles TypeScript and installs development dependencies. §15 runs the compiler and generates the database client there, copying only artifacts onward (see §15).

**Burst capacity** — The maximum tokens a rate-limit bucket can hold, allowing short spikes above the steady refill rate. §12 sizes it per route class so login and normal API traffic differ (see §12).

**Cache-aside** — The pattern where application code checks the cache first, falls back to the database on a miss, and populates the cache from that result. §12 implements it for the supplements catalog (see §§5, 12).

**Cache hit ratio** — The fraction of reads served from cache rather than from the origin database. §12 uses it to judge whether the catalog cache is pulling its weight (see §12).

**Cache key namespace** — The prefix scoping every cache key to a tenant and feature, such as catalog:v7:practice-42. §12 namespaces keys with the tenant id so cross-tenant reads are impossible (see §§6, 12).

**Cache penetration** — Repeated queries for keys that do not exist, which can never hit the cache and keep reaching the database. §12 lists it among the failure modes cache-aside designs must plan for (see §12).

**Cache stampede** — The pile-up that occurs when a hot key expires and many concurrent requests all rebuild it from the database at once, also called the dogpile effect or thundering herd. §12 prevents it with request coalescing and randomized expiries (see §12).

**camelCase** — The mixed-case naming convention Prisma fields use in this document. §7 makes it a deliberate choice so TypeScript and database names map without renaming directives (see §7).

**Canonical serialization** — A deterministic JSON form with sorted keys and fixed value formats, so the same logical request always serializes to the same bytes. §8 hashes it into the idempotency request hash (see §8).

**Cardinality** — The number of distinct values a metric label can take. §16 bounds it by using path patterns instead of raw URLs so metric series stay finite (see §16).

**Caret range** — A semver range such as ^5.0.0 that accepts compatible minor and patch updates within one major version. §1 pins dependencies at majors with caret ranges and never fabricates minors (see §1).

**Cascade delete** — A foreign-key behavior where deleting a parent row deletes its children automatically. §7 enables it for rows that cannot exist alone and restricts it where history must survive (see §7).

**Catchall** — A Zod object mode that validates unrecognized keys against a fallback schema instead of dropping or rejecting them. §4 contrasts it with unknown-key stripping and passthrough objects (see §4).

**CGNAT** — Carrier-grade NAT, the arrangement where many subscribers of a mobile network share one public IP address. §12 uses it to warn against keying rate limits by IP alone (see §12).

**Chargeback** — A payment dispute a cardholder raises with their card issuer, reversing the charge at the merchant's cost. §17 cites it as the business damage a double-charge bug eventually causes (see §17).

**Child logger** — A logger derived with fixed bindings such as requestId so every line it emits carries those fields. §11 builds one per request instead of threading ids through every call (see §11).

**CI gate** — A check that must pass before merge, enforced through branch protection. §15's required status checks act as this document's CI gates (see §§15, 17).

**Circular import** — A module cycle where two files require each other, leaving one of them half-initialized at load time. §2 forbids cycles across features and traces boot failures like undefined services back to them (see §2).

**Claim** — A named statement inside a JSON Web Token (JWT), the signed credential envelope this API uses, such as sub, iss, aud, exp, iat, or jti. §5's access tokens carry sub, role, practiceId, jti, iat, exp, iss, and aud (see §§5, 13).

**Client SDK generation** — Producing typed client libraries straight from the API's published description. §14 positions it as the payoff of keeping that description generated from validation schemas (see §14).

**Clock tolerance** — The small time skew accepted when validating token timestamps so slightly different server clocks do not reject fresh tokens. §5 configures leeway when checking the issued-at and expiry claims (see §5).

**Closed vocabulary** — The fixed set of values a feature accepts for a parameter, defined in exactly one place, everything else being invalid. §9 implements sort keys and filter fields as closed vocabularies (see §9).

**Coarse-grained check** — An authorization test at the boundary level, such as requiring the PROVIDER role before touching business logic. §6 runs these in middleware before fine-grained policies execute (see §6).

**Code-first design** — Deriving API documentation from the code that implements it rather than writing a spec by hand. §14 contrasts it with spec-first design and avoids drift by generating the document from validation schemas (see §14).

**Coercion** — Converting input to the expected type before validating it, as z.coerce.number() does for query strings arriving as text. §1 applies it in environment validation and §9 in query parameter validation (see §§1, 4, 9).

**COGS (cost of goods sold)** — The wholesale cost of the supplements on an order. §7 snapshots it per line item and §8 subtracts it from the provider's net to get margin (see §§7, 8).

**COGS snapshot** — Copying each item's unitCostCents onto the order at creation time so later wholesale price changes cannot rewrite history. §2 names the pattern and §7 persists it in OrderItem (see §§2, 7).

**CommonJS** — The older Node module system built on require and module.exports. §1 contrasts it with ESM and pins module resolution so TypeScript emits the correct syntax for each (see §1).

**Compare-and-swap** — An atomic update that succeeds only if the stored value still matches what was read. §8 implements it by updating a row only when its change-counter value still matches the value that was read (see §8).

**Compose profile** — A Docker Compose grouping that starts only the services a profile selects. §15 uses profiles to keep the telemetry stack optional during development (see §15).

**Composite index** — A database index over multiple columns in a declared column order. §7 and §9 design them to match continuation sorts on columns like createdAt then id (see §§7, 9).

**Composition root** — The single place where an application constructs its dependencies and wires them together. §7 instantiates the database client once there and passes it down, which is what makes repositories testable (see §§7, 13).

**Concurrency group** — The GitHub Actions setting that queues or cancels overlapping runs of the same workflow, with cancel-in-progress discarding superseded runs. §15 uses it so outdated CI runs stop wasting runners (see §15).

**Connection pool** — The set of open database connections an application reuses instead of connecting per query. §7 sizes Prisma's pool with connection_limit and reads pool_timeout errors as saturation (see §§7, 17).

**Constant-time comparison** — A comparison whose runtime does not depend on where two byte strings first differ. §5 uses it for token checks and §9 for cursor signature verification, denying attackers timing signals (see §§5, 9).

**Content-Type negotiation** — Deciding how to interpret a request body and which response format to emit based on headers. §10 checks it so API clients always receive application/problem+json errors (see §10).

**Context propagation** — Carrying trace context across async boundaries within a process and across service calls. §16 does it in-process via request-scoped storage and across services via the traceparent header (see §16).

**Contract test** — A test that asserts the running API matches its published interface description in routes, status codes, and payload shapes. §13 runs one against the real app and §17 keeps it as a merge gate (see §§13, 14, 17).

**Controller** — The thin layer that reads the validated request, calls the service, and returns the response, holding no business logic. §2 gives every feature one file for it (see §2).

**cookie path scoping** — Restricting a cookie to a URL path prefix so it is not sent to every endpoint. §5 scopes the refresh token to /v1/auth to shrink its exposure (see §5).

**core.hooksPath** — The git configuration pointing at a directory of repository hooks. §1 uses it so Husky 9 installs hooks without copied shims (see §1).

**Correlation ID** — An identifier attached to a request and echoed in its logs and error payloads so its trail can be followed end to end. §11 honors the inbound x-request-id header and §10 surfaces the value as the traceId field in problem details (see §§3, 10, 11).

**COUNT(*) aggregation** — The full scan Postgres performs to total matching rows, which this document's list endpoints avoid. §9 derives hasMore from a one-row overfetch instead of a count (see §9).

**Counter** — A metric that only increases, such as request or error totals. §16 builds the rate and error signals of operational dashboards from counters (see §§16, 17).

**Coverage artifact** — The saved coverage report a CI job uploads, in formats like LCOV. §15 uploads it on every run so reviewers can see what a pull request actually tests (see §§13, 15).

**Coverage threshold** — The minimum coverage level a test runner enforces as a failure condition. §13 sets Vitest thresholds so coverage cannot silently regress (see §13).

**Crash loop** — A container repeatedly starting and dying, often hiding the original error behind restart noise. §15 and §16 treat boot races and probe storms as its usual causes (see §§15, 16).

**Credential stuffing** — An attack that replays username and password pairs stolen from other services' breaches against your login endpoint. §17 motivates login rate limits and §5's user-enumeration defenses (see §§5, 12, 17).

**Cross-cutting concern** — Logic many features need, such as logging, error mapping, or authentication. §2 centralizes these in shared modules and middleware instead of duplicating them per feature (see §§2, 3).

**Cross-tenant leak** — A defect where one practice's data is returned, cached, or modified on behalf of another. §2, §6, §7, and §12 each add a layer against it: scoping, policies, query filters, and key namespaces (see §§2, 6, 7, 12).

**Cursor** — An opaque token that records the last-seen position of a list so the next page can continue from there. §9 encodes it as base64url JSON with a version tag and a signature (see §9).

**Cursor drift** — The distortion that occurs when rows are inserted or deleted between page fetches, shifting which rows a position refers to. §9 argues continuation cursors drift far less than offsets on append-mostly data (see §9).

**Cursor envelope** — The list response shape carrying data plus pagination metadata of limit, nextCursor, and hasMore. §9 defines it once and §13 asserts it in tests, with nextCursor null on the final page (see §§8, 9, 13).

**Cursor pagination** — Paging by continuing after the last seen row instead of counting skipped rows, also called keyset pagination. §9 makes it the default for list endpoints because per-page cost stays constant at any depth (see §§2, 9).

**Cursor version tag** — An explicit version field inside a cursor token recording which cursor shape it uses. §9's v1 tag lets a second shape ship later without breaking clients holding saved positions (see §9).

**CVE scanner** — A tool that checks container images and dependencies against published vulnerability databases. §15 adds a scanning stage so known vulnerabilities fail the build (see §15).

**Cycles (z.toJSONSchema option)** — The schema-converter setting controlling how self-referencing schemas are emitted, since JSON Schemas cannot inline themselves forever. §14 uses it when converting recursive schemas for the OpenAPI document (see §14).

**Data access layer** — The part of the system that talks to the database, isolated from business logic. §2 implements it as per-feature repositories so database imports stay in one layer (see §§2, 7).

**Deadlock** — A standstill where two transactions each hold a lock the other needs, so neither can proceed. §8 shows Postgres resolving it by aborting one transaction and explains consistent lock ordering as the fix (see §8).

**Debian slim** — The trimmed Debian variant this document picks for the runtime Docker stage. §15 prefers it over Alpine because native binaries built against the common GNU C library behave predictably on it (see §15).

**Decision** — The result object an authorization evaluation returns, carrying allow and a reason. §6's engine returns one decision per request so middleware can deny with a useful message (see §6).

**decodeJwt** — The token library helper that reads a token's claims without verifying its signature. §13 uses it in tests to inspect what a token actually contains (see §§5, 13).

**Defense in depth** — Stacking multiple independent safeguards so a single failure or bypass is not fatal. §8 layers idempotency keys, unique constraints, and version checks around the payment write (see §§8, 17).

**Degraded state (503)** — A readiness answer where the process is alive but a dependency is down, so the service reports 503 and leaves the rotation. §16's readiness endpoint returns it from failed dependency checks (see §16).

**Deny by default** — The authorization stance where access is refused unless a rule explicitly allows it. §6's engine treats silence as denial so an unwritten permission can never leak data (see §§6, 17).

**Dependency injection** — Passing an object its dependencies as parameters instead of constructing them internally. §7 injects the database client through the composition root so tests can substitute doubles (see §§7, 13).

**Dependency rule** — §2's one-direction constraint that outer layers may import inward but never the reverse, with repositories as the only database importers. §2 draws the layer arrows once and enforces them by file layout (see §2).

**Dependency scanning** — Automated checking of dependencies and images for known vulnerabilities. §17 lists it among the CI gates every merge must pass (see §§15, 17).

**depends_on (condition: service_healthy)** — The Docker Compose form that delays a container until a dependency's health check passes. §15 wires Postgres and Redis health into the API container's startup order with it (see §15).

**Deprecation policy** — The documented process for retiring an API version, including notice periods and signals. §17 pairs URL versioning with a Sunset header so clients get warning before removal (see §17).

**Deps stage** — The first stage of the multi-stage Docker build, which installs production dependencies only. §15 keeps it separate so its layer cache survives source changes (see §15).

**Detail (problem details)** — The RFC 7807 member holding a human-readable explanation of this specific occurrence of a problem. §10 fills it from the error, including the policy reason for denials (see §10).

**Digest pinning** — Referencing container images by their content-addressable digest instead of a mutable tag. §15 pins base images and §17 publishes digests so deploys are reproducible (see §§15, 17).

**Directed acyclic graph (DAG)** — A graph with directed edges and no cycles, which the document uses both as the general term and for the feature import graph. §2 requires the feature graph to stay a DAG so dependencies resolve in a stable order (see §2).

**Discriminated union** — A union type whose variants share one literal tag field that switches validation and code paths. §4 uses it for variant payloads and §9 for sort and filter decoding (see §§4, 9, 13).

**Disjunctive normal form** — A boolean expression written as an OR of AND clauses. §9 expands tuple comparisons into this shape so Postgres and Prisma both accept them (see §9).

**Distributed lock** — A mutual-exclusion flag held in a shared store such as Redis so only one worker proceeds. §12 builds it from a set-only-if-absent command with an expiry so crashed holders cannot deadlock the system (see §12).

**Distributed tracing** — Following one request across processes by linking recorded spans that share a trace id. §16 exports spans through the collector so a slow payment can be walked across services (see §§16, 17).

**Docker Buildx** — Docker's extended builder with exportable layer caches and advanced build features. §15 uses it in CI with a GHA cache so rebuilds reuse unchanged layers (see §15).

**Docker layer cache** — Docker's reuse of previously built layers when instructions and inputs are unchanged. §15 orders the Dockerfile so dependency layers cache independently of source changes (see §15).

**Dotted path** — The error path format that locates a failing field inside nested input, such as items.0.quantity. §4 builds it from validation-issue paths and §10 carries it in the errors array (see §§4, 10, 13).

**Double-click problem** — The user behavior of submitting the same action twice because nothing visually responded yet. §8 treats the second identical payment request as a replay of the first instead of a second charge (see §8).

**Dummy hash** — A precomputed password hash verified against even when the account does not exist. §5 spends hashing time on it so unknown-email and wrong-password logins are indistinguishable (see §5).

**ECMAScript Modules (ESM)** — The standardized JavaScript module system using import and export. §1 configures it with NodeNext resolution and §2 explains its live bindings and load-order rules (see §§1, 2).

**Encapsulation** — The scoping of plugins and hooks so decorators and options stay local to their subtree. §3 uses Fastify's encapsulation model to isolate each feature's registrations (see §§2, 3).

**Engines field** — The package.json section declaring which Node version a package requires. §1 pins the LTS major there so installs fail loudly on the wrong runtime (see §1).

**env_file** — The Docker Compose option loading a file of variables into a container. §15 feeds local configuration this way while CI injects real secrets (see §15).

**Environment validation** — Parsing and validating all configuration at process start with a schema, failing the boot if anything is missing. §1's src/config/env.ts is the canonical module every later section imports (see §§1, 17).

**Environment variable override** — Compose's precedence rule letting shell-provided variables replace env_file values. §15 relies on it so CI secrets override local defaults (see §15).

**Ephemeral port** — A temporary port the operating system assigns on the fly to a short-lived connection. §13 avoids needing any listening port in tests by dispatching requests in-process (see §13).

**ERR_HTTP_HEADERS_SENT** — The Node error thrown when response headers are written twice, which crashes handlers that respond after streaming began. §10's headers-sent check prevents it in the error path (see §10).

**Error code** — The short machine-readable string in this document's problem payloads that clients and dashboards branch on, such as validation_error. §10 pairs it with the RFC 7807 type URI as the stable programmatic identity of a failure (see §10).

**Error-handling middleware** — The middleware registered last whose only job is converting anything thrown into a response, identified by its four-argument signature. §3 shows each framework's equivalent hook and §10 makes it the single writer of error responses (see §§3, 10).

**Error swallowing** — Catching an exception without rethrowing or logging it, so failures vanish silently. §10 names it the cardinal bug of error paths and forwards everything to the mapper instead (see §§10, 11).

**Error tracking** — Aggregating exceptions in a dedicated system so frequency, freshness, and ownership are visible. §17 lists it as the operations counterpart to structured logs (see §§11, 17).

**ESLint** — The linting tool this document configures for TypeScript with type-checked rules. §1 enables no-floating-promises and no-misused-promises through its flat config (see §1).

**eslint-config-prettier** — The ESLint configuration that disables stylistic rules conflicting with Prettier. §1 layers it last so formatting belongs to Prettier alone (see §1).

**EVAL** — The Redis command that runs a Lua script server-side as one atomic operation. §12 uses it for token-bucket math that must not interleave (see §12).

**exactOptionalPropertyTypes** — The TypeScript flag that stops undefined from being assignable to optional properties, so absence and explicit undefined differ. §1 enables it to keep optionality honest at the type level (see §1).

**Exec-form CMD** — The Dockerfile instruction form written as a JSON array, which runs the process directly as PID 1 so signals reach it. §15 requires it so SIGTERM actually triggers graceful shutdown (see §§15, 17).

**Expand/contract migration** — The schema-change discipline of adding new columns first, migrating data and code, then removing the old ones in a later release. §7 and §17 use it to make schema changes rollback-safe (see §§7, 17).

**Explicit bucket boundaries** — The configured bucket edges of a histogram, chosen to match latency targets. §16 sets them so percentile readings land in meaningful buckets (see §§16, 17).

**Exporter** — The pipeline component sending telemetry out of the SDK or collector. §16 pairs its OTLP exporters with batch processing (see §16).

**EXPOSE** — The Dockerfile instruction documenting which port the container listens on. §15 uses it as metadata for humans and tooling, distinct from runtime publishing (see §15).

**Express 5** — The major of the Node web framework this document pins, whose router forwards async rejections to its error path. §3 compares it against Fastify and Hono on the same endpoints (see §§3, 4).

**Extension member** — An extra field added to an RFC 7807 problem document beyond the standard five. §10 defines traceId, code, errors, and retryAfterSeconds as this API's extension members (see §§8, 10).

**Factory function (test factory)** — A helper that builds a valid domain entity with sensible defaults and per-test overrides. §13 uses factories so fixtures stay valid when the schema grows (see §13).

**Fail-closed** — The behavior of refusing service when the protection mechanism itself errors out. §6 makes authorization behave this way, and §12 documents the deliberate contrast for rate limiting (see §§6, 12).

**Fail-fast** — Crashing at process start when configuration or invariants are wrong instead of limping on. §1 validates environment variables this way and §11 applies the same stance to logging setup (see §§1, 11).

**Fail-open** — The behavior of allowing traffic when the protection mechanism itself errors out, favoring availability. §12 chooses it for the rate limiter during Redis outages and states the accepted risk (see §§6, 12).

**Fake timers** — The test ability to replace the system clock and advance it manually. §13 uses Vitest's fake timers to test token expiry and TTL behavior deterministically (see §§5, 13).

**FastifyError** — The Fastify error class carrying a code and status that its error hook receives. §3 shows mapping it into the shared error family (see §§3, 10).

**FastifyPluginAsync** — The TypeScript signature for an async Fastify plugin, this document's unit of route registration. §3 registers each feature's routes through it with encapsulated options (see §§2, 3).

**Feature-first architecture** — Organizing code by feature folder, each holding its routes, controller, service, and repository. §2 picks it over layer-first folders so a feature's logic is findable in one place (see §2).

**Fetch handler** — The Hono application entry point that receives a Web-standard Request and returns a Response. §3 runs it on Node through the node-server adapter (see §3).

**Filter drift** — The inconsistency that occurs when a saved cursor is reused against different filters, so pages no longer describe the same query. §9 treats it as a cursor hazard and keeps filters and cursors consistent (see §9).

**Filter schema** — The Zod schema declaring which query parameters a list endpoint accepts and their types. §9 generates it from the feature's closed vocabulary and feeds it to the function that assembles queries (see §9).

**Fine-grained check** — An authorization test over specific resource attributes, such as whether a provider may see a particular order. §6 runs these as attribute-based policies after role checks pass (see §6).

**Fixed-window counter** — A rate-limiting scheme counting requests per fixed time window and rejecting once a limit is hit. §12 implements it with Redis INCR plus an expiry and compares it with token buckets (see §12).

**Flaky test** — A test that passes and fails without relevant code changes, usually from timing, ordering, or shared state. §13's harness rules exist to make flakiness impossible (see §13).

**Flat config** — The ESLint configuration format of eslint.config.js exporting an array of config objects. §1 uses it because ESLint 9 dropped the older rc format (see §1).

**Foreign key** — A column referencing another table's key, which the database keeps consistent. §7 relies on foreign keys for order and payment relations (see §7).

**Forks pool (Vitest)** — Vitest's execution mode running test files in separate worker processes, with singleFork collapsing them into one. §13 picks it for isolation between test files (see §13).

**genReqId** — The Fastify server option that assigns each request its id. §3 uses it to honor an inbound x-request-id or mint a UUID so correlation starts at the edge (see §§3, 11).

**GHA cache (type=gha)** — The GitHub Actions cache backend Docker Buildx can export layers to. §15 wires it into CI so image builds reuse layers across runs (see §15).

**GitHub Actions** — The CI platform this document uses for linting, typechecking, testing, coverage, and image builds. §15 defines the workflow and §17 treats its required checks as merge gates (see §§15, 17).

**GitHub Container Registry (GHCR)** — GitHub's container image registry, where this document's CI pushes built images. §15 authenticates the push with the workflow's GITHUB_TOKEN (see §15).

**GITHUB_TOKEN** — The credential GitHub Actions injects automatically for the repository's own workflows. §15 scopes it to what the push to GHCR needs (see §15).

**glibc** — The GNU C library that most Linux distributions and native binaries build against. §15 keeps the runtime image on it so the database driver's binaries match the base image (see §15).

**globalSetup (Vitest)** — The Vitest option naming a module run once before the whole test run. §13 uses it to start the test database and apply migrations before any file runs (see §13).

**god file** — A single file absorbing many responsibilities until it cannot be safely changed. §2 prevents god files with the per-feature file layout (see §2).

**Graceful shutdown** — The shutdown sequence of stopping intake, finishing in-flight work, flushing buffers, then exiting. §11, §16, and §17 each own a piece: logs, telemetry, and the termination-signal handler (see §§11, 16, 17).

**hasMore probe** — The technique of fetching one extra row beyond the page limit to detect whether a next page exists. §9 uses it so list endpoints avoid a count query entirely (see §9).

**Headers-sent check** — The guard in error middleware that tests whether the response already started streaming. §10 uses it to avoid the ERR_HTTP_HEADERS_SENT crash when errors arrive mid-response (see §10).

**HEALTHCHECK** — The Dockerfile instruction declaring how to test a running container's fitness. §15 points it at the readiness endpoint with a tuned start period (see §15).

**Health check** — A probe endpoint or mechanism reporting service fitness to orchestrators and load balancers. §16 splits it into liveness and readiness with different semantics (see §§15, 16).

**Health options** — The GitHub Actions container settings declaring a health command and retry window for service containers. §15 uses them so Postgres and Redis are provably ready before tests run (see §15).

**Histogram** — A metric recording a value distribution across configured buckets, enabling averages and percentiles. §16 uses it for request durations with explicit bucket boundaries (see §§16, 17).

**HMAC** — Hash-based message authentication code, a keyed hash proving content integrity and origin. §5 uses it over refresh token hashes and §9 over cursor payloads (see §§5, 9).

**Hono zValidator** — The Hono middleware factory that validates request parts against a Zod schema. §4 wires validated inputs into Hono handlers the same way Fastify does with schemas (see §§3, 4).

**HS256** — The signing algorithm combining a keyed hash with the SHA-256 digest, which this document pins for access tokens. §5 verifies with the algorithm pinned so confusion attacks fail (see §5).

**HSTS** — HTTP Strict Transport Security, the response header telling browsers to refuse plain HTTP for the domain. §17 lists enabling it as a termination-layer task (see §17).

**http-errors** — The npm helper package for creating HTTP error objects with status codes. §3 mentions it as a convenience for throwing typed errors in framework-agnostic code (see §3).

**HttpOnly cookie flag** — The cookie attribute that hides it from JavaScript, so cross-site scripting cannot exfiltrate it. §5 stores the refresh token with HttpOnly, Secure, SameSite, and a scoped path (see §§5, 13).

**HTTP status code** — The three-digit classification of every HTTP response, such as 200, 401, or 503. §10 maps each error family to one and §13 asserts the mapping in tests (see §§3, 10, 13).

**Husky** — The git hooks manager this document uses to wire lint and format checks into git. §1 installs it via the prepare script and points core.hooksPath at its directory (see §1).

**Idempotency** — The property that performing an operation again with the same key produces no additional effect. §8 builds the payments endpoint around it end to end (see §§8, 12).

**Idempotency key** — The client-supplied unique token, sent in the Idempotency-Key header, that makes a retried request a replay rather than a repeat. §8 requires it on payments and stores it in a dedicated table (see §§8, 12, 13).

**Idempotent replay** — The response behavior of returning the stored original result for a repeated idempotency key instead of executing again. §8 and §13 verify the replayed 201 carries the Idempotent-Replayed marker (see §§8, 13).

**Idempotent-Replayed** — This document's response header, set to true, when a request returned a stored result rather than executing. §8 introduces it so clients and tests can distinguish replays (see §§8, 13).

**Image tag (sha and latest)** — The practice of tagging built images with both the commit sha and the moving latest alias. §15 uses the sha tag for deployable specificity and latest for convenience (see §§15, 17).

**Include** — The Prisma query option that eager-loads related records in one round trip. §7 uses it to avoid one query per row when orders need their items (see §7).

**INCR** — The Redis command that atomically adds one to a counter value. §12 builds fixed-window counters on it (see §12).

**Index scan discard** — The work a database does walking index entries it will throw away, as offset pagination deepens. §9 quantifies it to argue for continuation paging on hot paths (see §§7, 9).

**Information disclosure** — The security failure of leaking internal facts such as stack traces or schema details through error responses. §10's mapper keeps 500s generic while details live in logs (see §§10, 11).

**In-process dispatch** — Sending test HTTP requests straight into the app object without opening a network socket. §13's Supertest harness works this way for speed and port safety (see §13).

**Input type vs output type** — The distinction between the type a schema accepts and the parsed type it produces, which differ under coercion and defaults. §4 tracks it so handlers trust the parsed output type (see §4).

**Instance (problem details)** — The RFC 7807 member identifying where the problem occurred, which this document fills with the request path. §10 sets it on every error document (see §10).

**Integer cents** — The rule that all monetary values are whole-number cents, never floats. §1 through §17 keep money in unitPriceCents-style fields so arithmetic is exact (see §§1, 7, 8).

**Integration test** — A test exercising the assembled application against real dependencies such as Postgres and Redis. §13 runs Supertest suites against the full middleware stack (see §13).

**Interactive transaction** — A block of dependent writes executed as one unit through a dedicated client handed to a callback. §8 wraps the payment, split, and order updates in one such block (see §§7, 8).

**ioredis** — The Redis client library this document pins. §12 configures its retry strategy, offline queue, and connection behavior (see §§1, 12).

**io (z.toJSONSchema option)** — The schema-converter setting choosing whether schemas describe input or parsed output types. §14 emits input schemas for request bodies so client types match what senders provide (see §§4, 14).

**ISO 8601** — The international timestamp standard this document uses for serialized dates. §4 validates formats with z.iso.datetime() and §11 sees it in the logger's default time output (see §§4, 9, 11).

**Isolation level** — The database setting determining how concurrent transactions see each other's uncommitted work. §8 works against Postgres's read committed default, a level that permits some cross-statement anomalies, and documents what it closes with version checks (see §8).

**Jaeger** — The open-source tracing backend this document runs in development to visualize traces. §16 receives exported spans from the OpenTelemetry Collector (see §16).

**Job** — A GitHub Actions unit of work running a set of steps on one runner. §15 splits lint, typecheck, test, and build into separate jobs with a service container for databases (see §15).

**JSONC** — JSON with comments and trailing commas, the format tsconfig files actually accept. §1 notes editors treat tsconfig.json as JSONC (see §1).

**JSON Lines** — The format of one JSON object per line, which the pinned logger emits natively. §11 ships it to log backends that index each line as an event (see §11).

**JSON Schema** — The vocabulary for describing the shape of JSON documents, which OpenAPI builds upon. §3 and §4 connect it to Fastify's compiled validators (see §§3, 4, 14).

**JSON Schema 2020-12** — The JSON Schema dialect OpenAPI 3.1 aligns with. §14 emits it from Zod so schemas express nullable and other 3.1-era constructs (see §14).

**JWS** — The JSON Web Signature standard that defines how tokens are signed and their segments encoded. §5 treats every access token as a JWS with HS256 (see §5).

**JWT (JSON Web Token)** — The signed token format carrying claims in a compact, verifiable envelope. §5 issues access tokens as JWTs and §13 asserts their claims (see §§5, 13).

**Keep-alive connection** — A TCP connection reused for many requests instead of reopening per request. §17 notes it must drain cleanly during graceful shutdown (see §§15, 17).

**Keep-in-sync check** — The test asserting the API description matches the routes actually registered. §13 fails the build when the spec drifts from the implementation (see §§13, 14).

**keyPrefix** — The ioredis option that transparently prepends a string to every key the client touches. §12 advises leaving it unset so commands and scripts agree on key names (see §12).

**KEYS** — The Redis command that scans the entire keyspace in one blocking pass. §12 bans it in production paths and uses the batched SCAN iterator instead (see §12).

**Keyset predicate** — The WHERE clause that continues a listing after a position, expressed over the sort columns. §9 compiles row-value comparisons into OR and AND clauses for compound sorts (see §9).

**Layer-first architecture** — Organizing code by technical layer, with all controllers in one folder and all services in another. §2 rejects it for this service in favor of feature-first folders (see §2).

**Lazy connection** — The client behavior of opening the socket on first use rather than at construction. §12 notes it so app boot never races Redis readiness (see §12).

**LCOV** — The coverage report format CI uploads as an artifact. §13 emits it from Vitest's v8 provider (see §§13, 15).

**Least privilege** — Granting each actor the minimum permission needed, nothing more. §6's role matrix and §17's checklist both operationalize it (see §§6, 17).

**lint-staged** — The tool that runs linters only on files staged for commit. §1 pairs it with Husky so pre-commit checks stay fast (see §1).

**Literal type** — A type accepting exactly one value, used as the tag that picks a variant in a union. §4 builds discriminated unions on literal tag fields (see §4).

**Live binding** — The ESM behavior where an import reflects later changes to the exported binding. §2 explains why circular imports with live bindings fail confusingly at boot (see §2).

**Liveness probe** — The orchestrator check whose failure means the process is unrecoverable and should be restarted. §16 keeps /health/live free of dependency checks for exactly that reason (see §§15, 16).

**Live-set semantics** — Query results that reflect the current rows at execution time, moving as data changes. §9 contrasts them with snapshot semantics when designing listings (see §9).

**Loader** — The §6 function that fetches a resource by id within tenant scope and projects its attributes for policies. A loader that cannot find the resource yields 404 rather than a denial (see §6).

**Lock contention** — The queueing that occurs when many transactions compete for the same row locks. §8 measures it against payment rows and orders writes to minimize it (see §8).

**Log injection** — An attack that smuggles newlines or structured syntax into log input to forge entries, also called log forging. §11 neutralizes it by logging JSON, where newlines cannot fake record boundaries (see §11).

**Log level** — The severity classification of a log record, such as debug, info, warn, or error. §11 gates verbosity with it and §17 ties alerts to error levels (see §§11, 17).

**Log shipper** — The external agent that collects a process's stdout and forwards it to a log platform. §11 keeps the app's contract to stdout so any shipper works (see §11).

**Lost update** — The anomaly where two reads of the same value both write, and one overwrite silently discards the other. §8 prevents it on order totals with version checks (see §§7, 8).

**Lua scripting** — Running server-side Redis scripts whose whole body executes atomically. §12 uses it for check-and-set rate-limit math (see §12).

**Mass assignment** — The vulnerability of binding client input directly onto persistent objects, letting attackers set fields they should not. §4 prevents it by validating with strict schemas and explicit fields only (see §§4, 7).

**Max-Age** — The cookie attribute setting its lifetime in seconds. §5 gives the refresh token a 30-day Max-Age to match the token's lifetime (see §5).

**Memory cost** — The Argon2id parameter sizing how much memory each hash computation requires. §5 tunes it so hashing stays affordable per login yet expensive to attack at scale (see §5).

**Meter** — The OpenTelemetry object a module obtains to create instruments such as counters and histograms. §16 keeps one per feature area for domain metrics (see §16).

**Metric** — A numeric measurement aggregated over time, such as request counts or durations. §16 distinguishes metrics from traces and logs as the three telemetry signals (see §§16, 17).

**Metric label** — The key-value dimension attached to a metric series, such as method or route. §16 bounds its cardinality by using path patterns (see §16).

**Middleware** — Request-processing functions that run before or after handlers and can short-circuit. §2 and §3 use it for auth, correlation, and errors across all three frameworks (see §§2, 3).

**Middleware factory** — A function returning configured middleware, so one implementation serves many schemas or options. §4 uses the pattern for validators across frameworks (see §§3, 4).

**Migrate deploy** — The Prisma command applying pending migrations in order, designed for production. §13 and §15 run it in test and CI pipelines, and §17 gates deploys on it (see §§7, 13, 15).

**Migrate dev** — The Prisma command that generates and applies migrations in development using a shadow database. §7 walks its workflow for schema changes (see §7).

**Migrate diff** — The Prisma command computing the SQL difference between schema states. §7 uses it to inspect what a migration will do (see §7).

**Migrate resolve** — The Prisma command marking a failed or stuck migration as applied or rolled back. §7 covers it in troubleshooting for interrupted migrations (see §7).

**Migration** — A versioned, ordered change to the database schema applied the same way everywhere. §2, §7, and §17 treat migrations as code with their own review and rollback story (see §§2, 7, 17).

**Mock** — A test double whose interactions are asserted, such as expecting a repository call with exact arguments. §13 contrasts mocks with stubs and prefers real dependencies for integration tests (see §13).

**moduleResolution** — The TypeScript setting deciding how import specifiers resolve to files. §1 pins NodeNext to match ESM semantics (see §1).

**Multi-stage build** — The Dockerfile structure copying only build artifacts into a lean final image. §15 splits deps, build, and runtime stages so development tools never ship (see §15).

**Multi-tenancy** — Serving many practices from one deployment while their data stays separate. §2 makes per-practice data separation a structural concern rather than an afterthought (see §§2, 6).

**N+1 problem** — The query pattern where listing N rows triggers N additional queries for related data. §7 avoids it with include and §9 with keyed batches (see §§7, 9).

**Named volume** — A Docker-managed storage area that persists across container recreations. §15 keeps Postgres and Redis data in named volumes (see §15).

**Namespace version** — The version number embedded in a cache key family, such as catalog:v7. §12 bumps it atomically on writes so stale entries die without deletion sweeps (see §12).

**NAT** — Network address translation, which hides many devices behind shared public IPs. §12 cites it with CGNAT as why IP-based rate limiting misfires (see §12).

**node --import** — The Node flag preloading a module before the application runs. §16 boots the OpenTelemetry SDK with it so instrumentation wraps every import (see §16).

**Node.js LTS** — The long-term-support release line this document pins, Node 24. §1 records its support window and §15 matches the Docker base image to it (see §§1, 15).

**NodeNext** — The TypeScript module resolution matching Node's ESM rules. §1 pairs it with syntax-preserving emits (see §1).

**NodeSDK** — The OpenTelemetry SDK entry point configuring tracing and metrics in one place. §16 boots it via node --import before application code loads (see §16).

**no-floating-promises** — The type-checked ESLint rule flagging promises nobody awaits or returns. §1 enables it so forgotten awaits fail lint instead of failing production (see §§1, 3).

**noImplicitOverride** — The TypeScript flag requiring the override keyword on shadowed members. §1 enables it to catch accidental overwrites (see §1).

**no-misused-promises** — The type-checked ESLint rule catching promises passed where they are invalid, such as in conditionals. §1 pairs it with no-floating-promises (see §1).

**Non-root user** — The container user without elevated privileges that the runtime stage switches to. §15 and §17 require it so a compromised process cannot own the host (see §§15, 17).

**not-found handler** — The catch-all route or hook returning a proper 404 problem document for unmatched paths. §3 wires one per framework and §10 formats its body (see §§3, 10).

**noUncheckedIndexedAccess** — The TypeScript flag making index access return the value or undefined. §1 enables it so array and record reads are guarded (see §1).

**npm ci** — The npm install mode that builds exactly from the lockfile, failing if they disagree. §15 uses it in Docker and CI for reproducible installs, with --omit=dev for the runtime image (see §15).

**npm lifecycle scripts** — The package.json hooks npm runs at defined moments, such as prepare or pretest. §1 uses the prepare script to install git hooks (see §1).

**Nullable** — The older OpenAPI 3.0 keyword for null-able fields, replaced in 3.1 by type arrays. §14 emits the 3.1 form from Zod (see §14).

**OAuth 2.0** — The standard authorization framework whose token flows this API borrows, with password and refresh grants done properly. §5 issues first-party tokens directly rather than delegating to an external identity provider (see §§5, 17).

**Obfuscation** — The deceptive practice of making something harder to read instead of safer, which security work rejects as a substitute for control. §5 warns against treating Base64-encoded secrets or hashes of weak inputs as protection (see §5).

**Object storage** — The blob store, such as S3, holding binary artifacts. §17 mentions it as the offsite home for database backups (see §17).

**Offline queue** — The ioredis behavior of queuing commands issued while disconnected and replaying them on reconnect. §12 deliberately configures it off so limiter calls fail fast into the fail-open path (see §12).

**Offset pagination** — Paging by a numeric count of skipped rows, such as page=3. §9 bounds it to admin screens where deep pages never happen (see §§2, 9).

**Oj schema (prisma-json-types-generator)** — The generator convention attaching Zod-derived types to Prisma JSON columns. §7 keeps untyped JSON columns out of the codebase by pairing JSON fields with Zod schemas (see §7).

**onRequest** — The Fastify lifecycle hook running before the routing decision, where auth and correlation middleware live. §3 and §5 register token checks there (see §§3, 5).

**Opaque token** — A credential whose meaning is only resolvable by checking with the issuing system. §5 stores refresh tokens as opaque strings so their hashes alone appear in the database (see §5).

**OpenAPI 3.1** — The API description standard this document generates from validation schemas. §14 publishes one document including reusable schema components (see §§3, 13, 14).

**OpenAPI document generation** — Producing the machine-readable API description programmatically from the code's schemas. §14 derives it from Zod via JSON Schema conversion so it cannot drift (see §§4, 14).

**OpenTelemetry Collector** — The receiving-and-forwarding proxy between the SDK and backends. §16 batches, samples, and reroutes telemetry there so apps stay decoupled from vendors (see §16).

**OpenTelemetry (OTel)** — The telemetry standard and SDK this document uses for traces and metrics. §16 wires the SDK, collector, and exporters, and §17 lists its health as an on-call check (see §§16, 17).

**Operational dashboard** — The Grafana boards this document builds over metrics and traces. §16 and §17 treat them as the front page for on-call engineers (see §§16, 17).

**Optimistic locking** — The concurrency strategy of checking a version counter at write time instead of holding a lock. §8 applies it to order updates and retries on conflict (see §§7, 8).

**Ordered dictionary** — The JavaScript object behavior of preserving insertion order for string keys, which §8 relies on for deterministic serialization. §8 hashes the canonical form so byte order is stable (see §8).

**Order of magnitude** — A rough tenfold comparison the document uses to explain why Argon2id outruns naive hashing by design. §5 uses it to tune work factors (see §5).

**OR expansion** — The query rewrite turning a row-value tuple comparison into an OR of AND clauses. §9 does it so Postgres and Prisma can both use indexes (see §9).

**OTEL_EXPORTER_OTLP_ENDPOINT** — The environment variable pointing the SDK at its collector. §16 sets it for the app container in Compose (see §§1, 16).

**OTLP** — The OpenTelemetry line protocol carrying traces and metrics to a collector. §16 uses it over gRPC from the SDK and HTTP from the collector's exporter (see §16).

**Outage playbook** — The on-call runbook for a failing dependency, with detection and escalation steps. §17 references the Redis and database playbooks that §12 and §7 inform (see §§7, 12, 17).

**Output limit** — The maximum bytes a log pipeline handles per record before truncation. §11 keeps payloads out of logs partly to respect it (see §11).

**Package exports** — The package.json map declaring what a package's import specifiers resolve to. §1 uses deep imports instead of index barrels, so exports stay explicit (see §§1, 2).

**Package-lock pinned CI** — The practice of committing the lockfile and running npm ci in every pipeline. §1 and §15 treat it as the reproducibility contract (see §§1, 15).

**Package manager corepack** — The Node-bundled tool pinning the package manager version per repository. §1 pins npm and §17 notes corepack as the alternative (see §§1, 15).

**Page size bound** — The maximum allowed limit value on a list endpoint. §9 clamps it at 100 so one request cannot fetch the world (see §§9, 12).

**Page state** — The extra query parameters that cursor payloads may embed to keep pages consistent. §9 embeds sort and filter state in the cursor so drift cannot occur (see §9).

**Parallel test isolation** — Running test files concurrently without them sharing state. §13 achieves it with per-file databases and forked workers (see §13).

**Parameterized query** — A database query whose values pass as parameters rather than string concatenation. §7 and §17 count on Prisma to produce them, closing the injection door (see §§7, 17).

**Partial failure** — The state where some writes in a group succeeded and others did not. §8 and §17 ban it inside transactions and idempotent handlers (see §§8, 17).

**Password hashing** — The one-way transformation of passwords before storage. §5 uses Argon2id with tuned cost parameters (see §§5, 17).

**Path pattern** — The route template used as a metric label, such as /v1/orders/{id}. §16 replaces raw paths with it to cap label cardinality (see §§3, 16).

**Payload capture** — The practice of logging request or response bodies, which §11 forbids because of PII risk. §11 logs shape metadata instead, never contents (see §§11, 17).

**Percentage-of-traffic control** — The capability to gate a feature to a fraction of requests. §17 mentions it as a rollout safety tool, out of scope for v1 (see §17).

**Persistence phase** — The idempotency lifecycle step storing the result after the business write succeeds. §8 and §12 both build it: database rows and cache entries (see §§8, 12).

**PID 1** — The first process in a container, which must forward signals to children. §15's exec-form CMD keeps Node there so SIGTERM works (see §§15, 17).

**PII (personally identifiable information)** — Data identifying a person, such as email or health-adjacent supplement orders. §2, §10, and §11 all handle it conservatively: scope it, mask it, and never log it (see §§2, 10, 11).

**Pino** — The structured logger this document pins. §11 configures redaction, serializers, and the pretty transport (see §§1, 11).

**pino-http** — The Pino request-logging wrapper emitting one line per HTTP request. §11 prefers manual child-loggers for richer context over it (see §11).

**pino-pretty** — The development-only Pino transport rendering pretty-colored lines. §11 keeps it out of production dependency trees (see §11).

**Pipeline** — The connected series of CI jobs from push to published image. §15 defines it in one workflow file with dependencies between jobs (see §15).

**Plain-old object** — The simple object shape services exchange, without framework classes or inheritance. §2 prefers it so layers stay decoupled (see §2).

**Plugin** — The Fastify unit of encapsulated registration for routes, hooks, and decorators. §3 builds the app as a tree of plugins, one per feature (see §§2, 3).

**Plugin options** — The typed settings object passed into a Fastify plugin. §3 uses them to keep feature configuration explicit and testable (see §3).

**Point-in-time recovery** — The backup capability of restoring the database to a specific moment. §17 pairs it with scheduled snapshots for a practical recovery objective (see §17).

**Pool sizing** — Choosing how many database connections a service may open at once. §7 computes it against Postgres max_connections and instance counts (see §§7, 17).

**Pool timeout** — The error thrown when a request waits longer than the pool allows for a free database connection. §7 sizes the pool so it never fires under normal load (see §§7, 17).

**PostgreSQL 17** — The database version this document pins. §1 and §15 match application and test images to it (see §§1, 15).

**Post-mortem** — The blameless document written after an incident, with timeline, causes, and actions. §17 names it as the follow-up to major incidents (see §17).

**Prepared statement** — The database feature caching a parsed and planned query for reuse with different parameters. §7 notes Prisma uses them automatically, so repeated queries save planning time (see §7).

**Pre-probe failure** — The Kubernetes event where the startup probe times out before the app finishes booting. §16's startPeriod tuning prevents the crash-loop cascade (see §§15, 16).

**Probe endpoint** — The HTTP route an orchestrator polls for health. §16 exposes two, liveness and readiness, with different dependencies checked (see §§15, 16).

**Probe storm** — The overload caused when orchestrators, load balancers, and monitoring all poll health endpoints concurrently. §16 keeps probes cheap so the storm never matters (see §16).

**Problem details** — The RFC 7807 JSON error document this API returns for every failure. §10 defines the family and §13 asserts exact shapes in tests (see §§3, 8, 10, 13).

**problem+json** — The media type application/problem+json that RFC 7807 error documents are served as. §10 sets it on every error response (see §§3, 10).

**Production parity** — The principle that development, test, and production environments run the same software and configuration shape. §15 achieves it with Compose and §17 lists it as a security requirement (see §§13, 15, 17).

**Provider margin** — The share of an order total paid to the prescribing provider. §7 stores it in cents and §8 recomputes it transactionally with version checks (see §§7, 8).

**Public route** — An endpoint reachable without authentication, such as login or health. §3 and §5 register them outside the auth hook (see §§3, 5).

**Pull request check** — The CI result a branch protection rule requires before merge. §15 and §17 define the full set (see §§15, 17).

**pyramid** — The test-shape model of many fast unit tests, fewer integration tests, and a small contract-test surface. §13 follows it deliberately over a top-heavy suite (see §13).

**Query hint** — A directive telling the database which plan to use, such as a Postgres index hint comment. §9 avoids needing them by designing sort-key indexes to match filters (see §§7, 9).

**Query parameter** — A key-value pair in the URL after the question mark, always arriving as text. §9 validates and coerces every one before use (see §§4, 9).

**Query plan** — The database's chosen execution strategy for a query, visible with EXPLAIN. §7 and §9 inspect plans to confirm indexes are used (see §§7, 9).

**Queue depth** — The number of items waiting in a processing queue. §16 exports it as a domain metric for background workers (see §16).

**Random jitter** — A small randomized amount added to timings, expiries, or retries to prevent synchronized behavior. §12 and §17 use it to break stampedes and retry alignment (see §§12, 17).

**Rate limit** — The per-subject ceiling on request rates, enforced with a 429 response when exceeded. §12's implementation is Redis-based, and §10 returns 429s with a Retry-After hint (see §§8, 10, 12).

**Rate limiter** — The middleware rejecting requests exceeding policy, whose failure mode this document makes fail-open. §12 implements it in Redis with a Lua script (see §§3, 12).

**Rate limit headers** — The optional response headers RateLimit-Limit, RateLimit-Remaining, and RateLimit-Reset describing quota state. §12 emits them so clients can self-throttle (see §§10, 12).

**RBAC (role-based access control)** — The authorization model granting permissions to roles such as PROVIDER, ADMIN, or STAFF. §6 pairs it with attribute rules, and §13 tests each role's matrix (see §§5, 6, 13).

**Read committed** — PostgreSQL's default isolation level, where each statement sees only committed data. §8 closes its residual lost-update window with version checks (see §8).

**Read-only transaction** — A transaction declared to never write, which the database can optimize. §17 mentions read replicas serving such traffic (see §§7, 17).

**Read replica** — A database copy serving reads so the primary handles writes. §17 mentions it as a scaling lever (see §17).

**Read-through cache** — The cache pattern where a miss triggers the store to load from origin transparently. §12 contrasts it with cache-aside, choosing the latter for explicit control (see §12).

**Reason (authorization)** — The machine-readable explanation returned with a denial. §6's engine returns it so 403 responses and logs say why (see §§6, 10).

**Reconnect strategy** — The client configuration for retrying a lost connection, such as ioredis retryStrategy. §12 sets capped exponential backoff with a max attempt count (see §12).

**Recovery point objective (RPO)** — The maximum acceptable data loss measured in time for a disaster. §17 derives backup schedules from it (see §17).

**Recovery time objective (RTO)** — The maximum acceptable time to restore service after an outage. §17 pairs it with restore drills (see §17).

**Recursive schema** — A schema referencing itself, such as a nested comment tree. §4 and §14 handle it via z.lazy() and the cycles option (see §§4, 14).

**Redaction** — The structured removal of sensitive fields from logs before they leave the process. §11 configures Pino's redact paths for email, tokens, and payment details (see §§5, 11).

**Redis 7** — The in-memory data store version this document pins for caching and rate limiting. §1 and §15 match application, test, and Compose versions (see §§1, 12, 15).

**Redis SCAN iterator** — The cursor-based command iterating keyspace in batches without blocking. §12 uses it for inspection tasks instead of KEYS (see §12).

**Refresh token** — The long-lived credential exchanged for new access tokens, stored hashed and rotated on use. §5 builds rotation and reuse detection around it (see §§5, 13).

**Refresh token rotation** — The practice of issuing a new refresh token on every use and retiring the old one. §5 and §13 test the rotation chain (see §§5, 13).

**Refuse-to-log pattern** — The logging discipline of failing loudly in review if a payload might contain PII, rather than logging then redacting. §11's serializer design embodies it (see §11).

**Region failover** — The disaster-recovery move of serving traffic from another geographic region. §17 mentions it as the highest-cost resilience lever (see §17).

**Register route** — The act of adding an endpoint to a router with its method, path, and schema. §3 shows the three frameworks' registration forms side by side (see §§2, 3).

**Regression test** — A test added after a bug to prove it fixed and keep it from returning. §13 and §17 require one for every production incident (see §§13, 17).

**Release tag** — The git tag marking a deployable version, tied to a commit sha. §15 and §17 use them for traceable deploys (see §§15, 17).

**Request coalescing** — The in-flight map that collapses concurrent requests for the same missing cache key into one database read. §12 builds it to prevent stampedes on hot keys (see §12).

**Request hash** — The canonical-serialization digest stored alongside an idempotency key, proving a replay carries the same payload. §8 compares it on every replay and rejects mismatches as a conflict (see §8).

**Retry-After** — The response header telling clients how long to wait before trying again. §10 sets it on 429 and 503 responses, seconds or a date (see §§8, 10, 12).

**Retry budget** — The maximum retry attempts or fraction of traffic retries may add before giving up. §17 pairs it with exponential backoff to avoid retry storms (see §§12, 17).

**Reuse detection** — The security mechanism flagging a refresh token that was already rotated and used again, implying theft. §5 revokes the whole token family when it fires (see §§5, 13).

**RFC 7807** — The "Problem Details for HTTP APIs" specification defining a small JSON error document with type, title, status, detail, and instance members. §10 pins it as the shape of every error response, carried as application/problem+json and extended with traceId, code, errors, and retryAfterSeconds (see §§3, 10).

**Rollback** — Returning a system to a previous known-good state. §7 keeps migrations rollback-safe and §17 defines the deploy rollback runbook (see §§7, 15, 17).

**Rotate on use** — The refresh-token property that every redemption also invalidates and replaces the token. §5 and §13 make it observable in tests (see §§5, 13).

**Routing** — Mapping an HTTP method and path to a handler. §2 puts registration in route files and §3 shows each framework's router (see §§2, 3).

**Row-value comparison** — The SQL form (a, b) > (x, y) expressing a lexicographic tuple comparison. §9 compiles continuation cursors into it (see §9).

**Rule engine** — The authorization component evaluating policies against attributes to produce decisions. §6's deny-by-default engine answers every check (see §§6, 17).

**Runbook** — The step-by-step operational document an on-call engineer follows during incidents. §17 defines the backup-restore and dependency-outage runbooks (see §§7, 12, 17).

**Runtime stage** — The final Docker stage containing only the compiled output and production dependencies. §15 builds it on Debian slim with a non-root user (see §15).

**SameSite** — The cookie attribute controlling cross-site sending, set to Lax here. §5 combines it with HttpOnly and Secure for the refresh token (see §§5, 13).

**Sampling** — The telemetry policy of recording only a fraction of traces to bound cost. §16 configures head sampling with a deterministic rule and mentions tail sampling (see §§16, 17).

**Schema components** — The OpenAPI reusable schema definitions generated once and referenced by operations. §14 names them after their Zod schemas so names stay stable (see §14).

**Schema (database)** — The declared structure of tables and relations in Postgres. §7 defines it through Prisma and migrations (see §§2, 7).

**Schema-first vs code-first** — The two API-documentation philosophies: write the spec by hand versus derive it from code. §14 picks code-first because the schema and the code cannot drift (see §14).

**Schemaless column** — A database column, typed JSON, whose internal structure the schema does not constrain. §7 avoids bare ones by pairing them with Zod at the application boundary (see §7).

**Schema (validation)** — The Zod declaration of accepted data shapes, single source of truth for types and docs. §4 builds every layer's trust on it (see §§1, 4, 14).

**Secret rotation** — The operational practice of replacing credentials on a schedule without downtime. §17 and §12 list JWT signing keys and Redis passwords as rotation candidates (see §§5, 12, 17).

**Secure flag** — The cookie attribute restricting it to HTTPS. §5 sets it in production so tokens never ride plain HTTP (see §§5, 17).

**SELECT ... FOR UPDATE** — The SQL clause locking selected rows until the transaction ends, so concurrent payers queue instead of racing. §8 locks the idempotency row with it inside the payment transaction (see §§7, 8).

**Semantic versioning (semver)** — The MAJOR.MINOR.PATCH versioning scheme governing dependency compatibility. §1 pins majors with caret ranges so minors and patches update freely (see §§1, 15).

**Sensitive data** — Any information whose exposure causes harm, including credentials, tokens, and personal details. §2, §10, and §11 route it through scoping, masking, and redaction respectively (see §§5, 10, 11).

**Serializer** — A Pino function that reshapes an object, such as the request or error, before logging. §11 attaches them so only safe fields of wide objects are emitted (see §§11, 17).

**Service container** — The GitHub Actions sidecar providing Postgres or Redis to a job. §15 provisions them with health options (see §§13, 15).

**Service layer** — The middle tier holding business rules, above controllers and below repositories. §2 gives every feature a service file, and §8's transaction orchestration lives there (see §§2, 8).

**Session revocation** — The ability to invalidate all tokens for a user immediately. §5 implements it via the token family's revokedAt column and jti denylist checks (see §§5, 12).

**Shadow database** — The temporary database Prisma uses to compute migrations safely. §7 configures it for migrate dev (see §7).

**Shared memory** — The container-level resource constraint that limits heap and buffers together. §15 sizes it so Node and the database never fight the host (see §15).

**Shared module** — The cross-feature code under src/shared that every feature may import. §2 places the error, auth, and logging utilities there rather than duplicating them (see §2).

**Shell form CMD** — The Dockerfile instruction form written as a plain string, which wraps the process in a shell that swallows signals. §15 rejects it in favor of exec-form so SIGTERM reaches Node (see §§15, 17).

**Short-circuit** — A middleware's ability to end the request immediately, as when authorization fails before the handler runs. §3, §5, and §6 rely on it so denials never touch business logic (see §§3, 5, 6).

**Sidecar** — A supporting container running alongside the application container, such as the OpenTelemetry Collector. §16 runs Jaeger and the collector as Compose sidecars (see §§15, 16).

**Signal handler** — The process code catching SIGTERM and SIGINT to trigger graceful shutdown. §17 requires it in every service (see §§15, 16, 17).

**Signed cursor** — A continuation token whose payload carries an HMAC so clients cannot forge positions. §9 signs it with a server-held key (see §§9, 17).

**SIGTERM** — The termination signal orchestrators send before stopping a container. §17's signal handler catches it to drain in-flight requests (see §§15, 16, 17).

**Single source of truth** — The one file or system where a fact is defined, referenced everywhere else. §1 (env), §4 (schemas), and §14 (OpenAPI) each designate one (see §§1, 4, 14).

**Singleton** — The single shared instance, such as the one Prisma client, guarded against duplicates in development. §7 implements the guard on globalThis so hot reloads never fork the pool (see §§7, 13).

**Snapshot semantics** — Query results frozen at a moment, so repeated reads see the same data. §9 contrasts it with live-set semantics for listing design (see §9).

**Span** — A single timed operation within a trace, with attributes and status. §16 creates spans per request, per query, and per external call (see §§16, 17).

**Span attributes** — The key-value metadata on a span, such as db.statement or http.route. §16 redacts parameter values and bounds attribute count (see §11).

**Split ledger** — The per-order record of how the total divides into platform fee, COGS, and provider margin. §8 writes it inside the payment transaction so the sum always equals the total (see §§7, 8).

**Spy (test double)** — A wrapper recording calls over a real or stubbed implementation. §13 uses spies to assert repository arguments without replacing behavior (see §13).

**SQL injection** — The attack of injecting SQL through unescaped input. §7 closes it with parameterized queries and §17 lists it as a review check (see §§7, 17).

**sqlite (test alternative)** — The lightweight database some teams use in tests, which this document rejects. §13 requires the real Postgres so behavior matches production (see §§7, 13).

**SRP (single responsibility principle)** — The design rule that a module should have one reason to change. §2 applies it to files and §13 to tests (see §§2, 13).

**Stable sort** — A sort preserving the relative order of equal keys. §9 adds the unique id tie-breaker so pagination order is stable across queries (see §§7, 9).

**Stack trace** — The report of active function calls at an error, logged server-side but never returned to clients. §11 logs it and §10 replaces it with a trace id in responses (see §§10, 11).

**Standard library** — The runtime's built-in modules, preferred over third-party dependencies when adequate. §1 and §2 list crypto, path, and url as such cases (see §§1, 2).

**Startup probe** — The orchestrator check giving slow-starting apps time before liveness enforcement begins. §16 configures its period and failure threshold for boot tolerance (see §§15, 16).

**Stateless** — The property of requiring no server-side memory between requests, which JSON Web Token access tokens give this API. §5 chooses stateless verification so any instance can serve any request (see §§5, 12).

**Static analysis** — Checking code without running it, through the compiler and linters. §1 and §15 treat typecheck and lint as static analysis gates (see §§1, 15, 17).

**stdout contract** — The rule that applications write logs and errors to standard output and let the platform handle the rest. §11 and §15 both treat it as the app's only output side effect (see §§11, 15).

**Sticky routing** — A load balancer's behavior sending a client's requests consistently to the same instance. §12 notes rate limits must survive without it because Redis state is shared (see §§12, 17).

**Stop-the-world pause** — A garbage-collection or process event freezing all work briefly. §11 mentions it when sizing log buffers and §17 when reading latency percentiles (see §§11, 16).

**Streaming response** — A response sent incrementally rather than buffered whole. §9 and §17 note export endpoints as the rare case where it applies (see §17).

**Strict mode (Zod)** — The object-parsing behavior rejecting unrecognized keys. §4 and §10 rely on it so typos and mass assignment fail validation (see §§4, 10).

**Structured logging** — Emitting logs as machine-readable JSON events rather than formatted prose. §11 makes it the default so dashboards can query fields like requestId and route (see §§11, 17).

**Stub** — A test double replacing behavior without assertion on its calls. §13 contrasts stubs with mocks and prefers them for peripheral dependencies (see §13).

**Sub-millisecond overhead** — The performance budget middleware must fit within. §3 quotes it for validation and correlation layers (see §§3, 16).

**Supertest** — The HTTP assertion library driving in-process requests against an app instance. §13 builds the harness on it (see §§3, 13).

**Tail sampling** — The telemetry policy deciding after a trace completes whether to keep it, based on its content. §16 mentions it as the collector-side upgrade over head sampling (see §16).

**Tenant ID** — The practice identifier embedded in tokens, rows, and cache keys. §5 claims practiceId in the JWT and §12 namespaces keys with it (see §§5, 6, 12).

**Tenant isolation** — The guarantee that one practice's data is invisible to another, enforced at every layer. §2's scoping rule and §6's tenant filter make it structural (see §§2, 6, 7).

**Test database** — The isolated Postgres instance per test file, created and torn down by the harness. §13 uses template databases to clone them quickly (see §§7, 13).

**Test double** — The generic term for mocks, stubs, spies, and fakes substituting real dependencies. §13 picks the right double per dependency (see §13).

**throughput** — The requests or work completed per unit time, this document's core capacity signal. §16 measures it via request counters (see §§12, 16).

**Throw site** — The location in code where an error is raised, which the mapper needs for classification. §10 throws AppErrors from services and maps them centrally (see §§2, 10).

**Time provider** — The injectable clock abstraction so tests can control time. §13 uses it with fake timers for token expiry tests (see §§5, 13).

**Timestamp** — The instant of an event, serialized in ISO 8601. §4 and §11 standardize it across payloads and logs (see §§4, 11).

**Token bucket** — The rate-limiting scheme holding tokens that refill over time, allowing short bursts. §12 implements it atomically in Redis Lua (see §§12, 17).

**Token endpoint** — The /v1/auth/refresh route exchanging refresh tokens for new token pairs. §5 and §13 treat it as the rotation heart (see §§5, 13).

**Token family** — The chain of refresh tokens descending from one login, all revoked together on reuse detection. §5 links them by a family id column (see §§5, 13).

**TOML** — The configuration format some tools prefer, which this document avoids in favor of JSON and TS configs. §1 mentions it only as a rejected alternative (see §1).

**Trace** — The end-to-end record of one request through the system, composed of spans. §16 exports it to the collector and §17 uses it in incident response (see §§16, 17).

**Trace ID** — The unique identifier shared by all spans of one request. §10 includes it in problem details and §11 in log lines, so logs and errors join traces (see §§10, 11, 16).

**Traceparent header** — The W3C header propagating trace context between services. §16 reads and re-emits it on outbound calls (see §§12, 16).

**Transport** — The Pino output mechanism, such as pino-pretty in development. §11 runs workers out-of-thread so app latency never depends on formatting (see §11).

**TTL (time to live)** — The lifespan of cached or rate-limit state before expiry. §12 sets it per key family and §13 tests expiry with fake timers (see §§12, 13).

**Tuple comparison** — The multi-column comparison that advances a composite sort past a position. §9 expands it to disjunctive normal form for Prisma compatibility (see §9).

**Type annotation** — The explicit type marking on a declaration. §1 minimizes them because inference covers most variables (see §1).

**typecheck job** — The CI job running tsc with no emit, catching errors tests might miss. §15's workflow gates merges on it (see §§15, 17).

**Typed error class** — The application error base carrying code, status, and details. §10's AppError hierarchy and §6's AuthorizationError derive from it (see §§6, 10).

**Type guard** — A function whose return type narrows its argument's type. §2 and §10 use them for safe discriminations (see §§4, 10).

**Type inference** — The compiler's derivation of types from usage, minimizing annotations. §1 relies on it heavily under strict settings (see §1).

**Type predicate** — The return-type annotation that makes a function a type guard. §2 and §10 use them on narrowing helpers (see §§4, 10).

**Type-safe SQL** — The Prisma approach giving typed results for validated queries. §7 prefers it over raw SQL, raw being the documented escape hatch (see §§7, 9).

**Types as contracts** — The philosophy that types document and enforce the interface between layers. §2 and §4 treat Zod output types as the only handler-visible shape (see §§2, 4).

**TypeScript 5** — The language version this document pins. §1 enables strict family flags and §15 matches the compiler to the Node runtime (see §§1, 15).

**TypeScript type generation** — Producing TypeScript types from the OpenAPI document or Zod schemas for client SDKs. §14 mentions it as the SDK story for consumers (see §§4, 14).

**typo tolerance** — The forgiving validation style that accepts misspelled keys, which strict schemas reject here. §4's strict mode makes typos loud in development instead of silent in production (see §§4, 13).

**Uniqueness constraint** — The database rule enforcing at most one row per key combination. §7 uses it for idempotency keys and email addresses (see §§7, 8).

**Unit test** — A test of one module in isolation with doubles for collaborators. §13 keeps them fast and plentiful under the pyramid model (see §§2, 13).

**Unix domain socket** — The local inter-process socket some deployments use instead of TCP. §15 mentions it as a Compose-only option for the database (see §15).

**Unknown-key handling** — The decision about unrecognized input keys: reject, strip, or pass through. §4's strict schemas reject them, surfacing client bugs early (see §§4, 10).

**Unprocessable entity (422)** — The HTTP status for well-formed but semantically invalid requests, distinct from 400. §10 maps Zod failures to 422 and reserves 400 for malformed JSON (see §§4, 10).

**Upstream** — The service a client calls, from the dependency's point of view, or the dependency itself. §12 and §16 use it for cache and trace topology (see §§12, 16).

**URL versioning** — The API evolution strategy of /v1/ prefixes in paths. §2 bakes it into the route prefix and §17 pairs it with a Sunset header (see §§2, 17).

**UUID** — The 128-bit identifier format this document uses for primary keys, stored as uuid columns. §7 and §13 use uuid v7 for time-ordered ids (see §§7, 13).

**UUID v7** — The UUID variant encoding a millisecond timestamp in its high bits, keeping ids roughly ordered. §7 prefers it so B-tree indexes stay compact (see §§7, 9).

**Validation error (400/422)** — The error family for rejected input, carrying the errors array with dotted paths. §4 and §10 build it from Zod issues (see §§4, 10).

**Validation pipeline** — The ordered steps of parsing, coercing, and validating input before handlers run. §4 composes it per request part (see §§3, 4).

**Validator middleware** — The framework-specific wrapper running a Zod schema over a request part. §4 implements it for all three frameworks (see §§3, 4).

**Versioned API** — The practice of maintaining multiple API versions simultaneously, here just /v1. §2 and §17 define the upgrade and sunset path (see §§2, 17).

**Versioned cache namespace** — The cache key family prefix including a version number for atomic invalidation. §12's catalog:v7 example shows the pattern (see §§7, 12).

**Version (optimistic)** — The change counter column checked on update. §7 adds a version int to mutable tables and §8 bumps it in the WHERE clause (see §§7, 8).

**Version pinning** — Locking dependency versions so builds reproduce. §1 pins majors with caret ranges and a lockfile (see §§1, 15).

**Warm-up** — The period after boot when caches and JIT compilation reach steady state. §16's startup probe tolerates it before enforcing liveness (see §§12, 16).

**Whitelist** — The older name for allowlist, used once in §12's cache discussion then replaced. §12 uses allowlist terminology elsewhere for consistency (see §§6, 12).

**Worker threads** — Node's parallel execution threads, which Pino's transport uses for formatting. §11 keeps them off the request path (see §11).

**Workspace (npm)** — The monorepo package grouping, mentioned only as a rejected layout. §1 prefers a single-package repository for this service (see §1).

**Write-ahead log (WAL)** — The Postgres journal ensuring durability before commits return. §17 archives it for point-in-time recovery (see §17).

**x-request-id header** — The inbound HTTP header this API accepts as an external correlation identifier. §3's genReqId honors it or mints a UUID, and §10 echoes the value as traceId (see §§3, 10, 11).

**YAML** — The configuration format GitHub Actions workflow files use. §15 defines the CI pipeline as a YAML file under .github/workflows (see §15).

**z.coerce.number()** — The Zod 4 helper that converts input to a number before validating it. §1 and §9 use it for numeric environment variables and query parameters arriving as strings (see §§1, 9).

**Zero-downtime deploy** — The deployment goal that no request fails during rollout. §15 and §17 achieve it with graceful shutdown and health-gated rotation (see §§15, 16, 17).

**z.iso.datetime()** — The Zod 4 validator for ISO 8601 timestamp strings. §9 uses it for since/until query parameters (see §§4, 9).

**z.lazy()** — The Zod helper deferring schema evaluation, enabling recursive definitions. §4 and §14 use it for tree-shaped payloads and their OpenAPI output (see §§4, 14).

**Zod 4** — The validation library version this document pins. §1, §4, and §14 all build on its parse API and JSON Schema conversion (see §§1, 4, 14).

**zod-validation-error** — The library mapping Zod failures to typed errors, mentioned as an alternative this document passes on. §4 builds its own mapping to control the errors array shape (see §§4, 10).

**z.toJSONSchema()** — The Zod 4 function converting schemas to JSON Schema for OpenAPI generation. §14 configures its io, cycles, and unrepresentable options (see §§4, 14).

