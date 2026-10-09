## 17. Production Readiness Checklist

Everything before this chapter made Tracker work. This chapter is about the gap between *works* and *is ready to be depended on* — the failures that do not show up in a demo, a happy-path test suite, or a staging environment with three users and warm caches. The thirty items below are the gate between the two. Each one names what specifically breaks without it, because a checklist item you cannot attach a failure to is a slogan, and slogans do not survive a launch week.

Three rules govern how to use it. Run it twice by default — before the first production launch, and again a quarter later — plus after every incident and every major architectural change, because readiness decays as code and teams change. Give each item an owner and a verdict with evidence; "probably fine" is how outages ship. And treat every skipped item as a written bet: name it, record who made it, and set the date when the bet gets re-examined.

The items cross-reference the sections that implement each practice, so a failed check has a fix location, not just a complaint.

### Security

**1. Secrets never enter the repository.** `DATABASE_URL` and the JWT signing secret are functionally the keys to every organization in Tracker: anyone holding the signing secret can mint access tokens that §5's middleware will happily accept. Keep secrets in a manager (AWS Secrets Manager, Vault, Doppler), inject them at deploy time, rotate them on a schedule and on every departure, and keep `.env` out of git from the first commit (§1). What breaks without it: one leaked `.env` in a forked or mirrored repository, and every token in your `RefreshToken` table is forgeable — along with the audit trail that would have told you.

**2. Access tokens stay short-lived; refresh tokens rotate with reuse detection.** The 15-minute access token expiry bounds the value of any stolen token to minutes; refresh rotation with family revocation (§5) converts token replay — the signal that a token was stolen — into automatic revocation of the entire chain. What breaks without it: a long-lived access token turns a single XSS or leaked log line into weeks of undetectable access, and without reuse detection the replay of a rotated token is just another authenticated session nobody is watching.

**3. Every write path is policy-checked at the resource level, not just the role level.** RBAC answers what a `MEMBER` may do in the abstract; ABAC answers whether *this* member belongs to *this* project (§6). A route that checks the role claim but skips the project-membership check passes exactly the person the role matrix never intended. What breaks without it: reference scenario 6 — a `MEMBER` creating tasks in any project they can name, in any organization whose id they can guess, with valid credentials and a 200 to show for it.

**4. All external input — body, query, and params — passes a Zod schema, with allowlists for anything that reaches the query layer.** §4's `validate` middleware catches malformed bodies, but the quieter failure is §9's surface: sort fields and filter keys that flow into Prisma queries without a whitelist. What breaks without it: mass assignment of fields you never meant to be writable, unindexed client-chosen sort columns driving sequential scans, and query-shaped injection through crafted parameter names.

**5. Security headers, body limits, and CORS are explicit configuration.** Helmet's defaults, an `express.json({ limit })` cap sized to your largest legitimate payload, and a CORS allowlist of exact origins are thirty lines that close the most common web-platform holes. What breaks without it: multi-megabyte JSON bodies exhausting memory, `Access-Control-Allow-Origin: *` handing any origin a workable XSS target, and missing `Strict-Transport-Security` letting a downgrade attack strip TLS from your bearer tokens.

**6. Dependencies and container images are scanned in CI, and updates are routine.** `pnpm audit` in the pipeline, automated dependency updates on a cadence, and a scanner (Trivy, Grype) on the image §15 builds turn known CVEs into tickets instead of incidents. What breaks without it: a vulnerability with a public exploit rides along for six months because nobody had "time this sprint," and the fix, when finally applied, lands as an emergency upgrade under attack conditions.

### Reliability

**7. Graceful shutdown drains before the process exits.** The full sequence in §16.1 — flip readiness, drop idle connections, finish in-flight requests, disconnect dependencies, flush telemetry — is what separates a rolling deploy from a rolling outage. What breaks without it: every deploy drops every in-flight request (including the POST the user just clicked twice), and the last seconds of traces and metrics vanish precisely when something was going wrong during the deploy.

**8. Liveness and readiness are separate, and each tells the truth.** Liveness answers "is the process up" and triggers restarts; readiness answers "can this instance serve traffic" and triggers only traffic removal (§16). What breaks without it: dependency checks wired into liveness turn one Redis blip into a synchronized restart of every instance — a self-inflicted outage from a five-second hiccup — while a missing readiness check routes production traffic to instances that cannot serve it.

**9. Unsafe operations accept an `Idempotency-Key` and replay the cached response.** Clients retry on network flaps, proxy timeouts, and double-clicks, regardless of how confident you are in your UI (§8). The Redis claim plus 24-hour response cache makes the retry harmless. What breaks without it: duplicate tasks from every mobile client on a subway, duplicate webhook deliveries, doubled audit rows — and users who learn to fear your "submit" button.

**10. Every dependency call has a timeout shorter than your patience.** Prisma's pool timeout, ioredis command timeouts, and an `AbortSignal` on every outbound `fetch` bound how long any single slow dependency can hold your resources hostage. What breaks without it: one slow query or partitioned Redis converts a dependency blip into pool exhaustion, then into 500s on every route — the classic cascade where the failing dependency takes down the parts that no longer need it.

**11. Auth and mutation endpoints are rate limited per identity, not just per IP.** §12's Redis sliding window protects the service; a tighter, identity-keyed limit on `/auth/login` protects the credentials. IP-only limits fail in both directions: one attacker behind one address out-runs them, while a NAT'd office shares a single bucket. What breaks without it: credential stuffing at industrial scale, and one noisy tenant degrading every other tenant's latency (scenario 12's 429 exists so this never gets to the database).

### Data

**12. Migrations are reviewed artifacts applied by the pipeline, never by application boot.** `prisma migrate deploy` runs once per deploy from the migration history (§7); two application instances racing `migrate` at boot is a corruption lottery with schema-level stakes. What breaks without it: schema drift between environments that no test catches, a hotfix deploy that "repairs" the schema in ways the next deploy silently undoes, and nobody able to say which version of the schema production is actually running.

**13. Backups exist, and restores are rehearsed.** Point-in-time recovery with a defined schedule and retention is the plan; the drill — actually restoring into a scratch environment and verifying the data — is the part everyone skips and everyone regrets. What breaks without it: the first real restore attempt happening during the outage, and backups that cannot be restored are the same as no backups, with better paperwork.

**14. Deletes are designed, not incidental.** Cascading deletes are reviewed line by line in §7's schema, history-bearing entities like `AuditLog` are append-only, and a documented path exists for exporting and erasing a user's data. What breaks without it: an unreviewed `onDelete: Cascade` wipes an organization's audit history along with it, and the first GDPR-style erasure request arrives with no procedure to answer it.

**15. Concurrent edits resolve with versions, not luck.** Optimistic locking on `Task.version` (§8) means two admins editing the same task produce one clean 409 that names the current version (scenario 9), not one silent lost update. What breaks without it: a user's carefully written description disappears because a colleague had the edit screen open — data loss with no error, no log line, and no way to explain it afterward.

### Performance

**16. Every list endpoint has indexes that match its real filters and sorts.** §9's whitelist defines the query shapes; §7's schema must back each one with an index — a composite on `(projectId, status, createdAt)` for the tasks list, not three single-column indexes the planner will ignore. Verified with `EXPLAIN` under realistic data volume, not an empty dev database. What breaks without it: a list that returns in 12 ms at ten thousand rows and takes four seconds at ten million, arriving precisely when your biggest customer is growing into you.

**17. Unbounded feeds paginate by cursor.** Offset pagination shifts rows when inserts land between pages (scenario 10) and degrades linearly with page depth; §9's cursor scheme is stable under concurrent writes and constant-time at any depth. What breaks without it: integrations that skip or duplicate records on every insert storm, mobile clients with deep-scroll lists that get slower every week, and "the API lost my data" tickets that were pagination all along.

**18. Hot reads are cached with stampede protection and invalidated on write.** §12's cache-aside helper, single-flight lock, and write-through invalidation deliver the freshness contract of scenario 13: update a task, and the next list read is fresh. What breaks without it: the thundering herd when a hot key expires under load — a thousand requests all miss and all hit Postgres at once — and stale lists that read as data-loss bugs in every support channel.

**19. Connection pools are sized deliberately, end to end.** Prisma's pool size times your instance count must fit under Postgres's `max_connections` with headroom for deploys that temporarily double the fleet; Redis sockets get the same arithmetic. What breaks without it: pool exhaustion 500s in the middle of every rolling deploy, or `max_connections` rejections during an incident when you scale out to fix the incident.

### Observability

**20. Logs are structured, correlated, and redacted.** §11's Pino configuration — JSON lines, the `x-request-id` correlation id on every entry, redaction of `authorization`, `cookie`, `password`, and `token` fields — is the difference between querying logs and grepping them. What breaks without it: an incident investigated with `grep` across `kubectl logs`, and bearer tokens leaking from your logs into every system that aggregates them.

**21. Traces cover the write path end to end, sampled on purpose.** §16's auto-instrumentation plus manual service spans, with an environment-controlled sampling ratio, make "it's slow somewhere" answerable in minutes. What breaks without it: latency regressions located by bisecting code with deploys, and — when cost pressure later forces sampling to be configured in a hurry — the sampling policy is chosen by the incident instead of by you.

**22. Dashboards and alerts exist before the first incident.** RED metrics per route, saturation (event loop delay, pool utilization), and business counters like `tracker.tasks.created` (§16), thresholded against a measured baseline. What breaks without it: your users become the monitoring system — the first alert fires during the incident instead of before it, and its threshold is guessed because the baseline was never measured.

**23. Every state change writes an `AuditLog` row with who, what, and when.** §7's audit trail is a security control wearing a feature's clothing: it is the forensic record after a compromise, the evidence in a "who deleted this project" dispute, and the compliance answer an enterprise customer asks for before signing. What breaks without it: the one endpoint someone forgot to instrument becomes the one action nobody can attribute — a question that is always asked after the fact, never before.

### Delivery

**24. CI blocks merges on lint, types, and the full test matrix — including integration tests against real Postgres and Redis.** §13's unit, testcontainer-backed integration, and contract suites, enforced by §15's pipeline, are the difference between "tests exist" and "tests gate." What breaks without it: a regression that only manifests with a real database — a transaction isolation quirk, a Prisma dialect detail — lands on main because unit tests against mocks passed, and production finds it before CI does.

**25. The wire contract is asserted, not assumed.** §13's contract tests pin the problem+json shape, the correlation and rate-limit headers, and the pagination envelope; §14 generates the OpenAPI document from the same Zod schemas the routes validate with. What breaks without it: a renamed response field ships green because nothing asserted it, every client breaks at once, and the published spec quietly drifts until it is fiction that everyone ignores.

**26. Images are built once in CI, pinned by digest, and promoted — never rebuilt on the host.** §15's multi-stage, non-root, alpine-based image, built in the pipeline and promoted by digest, means the artifact you tested is the artifact you ship. What breaks without it: "works in staging" drift from a rebuild against a moved base tag, containers running as root that turn a container escape into a host compromise, and three environments running three different builds of the same version number.

**27. Deploys stay backward-compatible with the previous schema — and the one before it.** Expand-migrate-contract ordering (§7, §15): ship new columns before the code that reads them, migrate data explicitly, and drop old columns only after no running version references them. What breaks without it: a rollback that bricks against a newer schema — the safety net you built for deploy day is the thing that fails on deploy day.

### Operations

**28. Configuration is validated at boot and injected at deploy — never baked into images.** §1's Zod-validated environment fails fast with a named missing variable; images built once (item 26) move between environments by configuration alone. What breaks without it: a typo'd variable discovered forty minutes into an incident because the silent default finally mattered, and "rebuild the image for staging" as a standing workaround for what should be a config change.

**29. Every alert links to a runbook, and someone owns the rotation.** A runbook — what the alert means, the two or three checks that localize it, the escalation path, the rollback — turns a page into a procedure; a rotation makes the procedure survivable. What breaks without it: alerts nobody acts on until someone disables them, and an operation style that depends on one person's tenure and disappears into their PTO.

**30. Capacity is measured, not guessed.** A load profile — realistic request mix, realistic data volume — run against Tracker before launch and before seasonal peaks (k6 or autocannon against a production-shaped environment), results recorded as the baseline that §16's alert thresholds and §22's dashboards reference, re-run after every architectural change. What breaks without it: your first traffic spike doubles as your load test, executed against paying customers, with the fix requiring the one thing you no longer have — time.

### Common mistakes

- **Treating the checklist as a one-time launch gate.** Readiness decays as code, dependencies, and team members change, and an audit from launch day is a historical document. Fix: re-run quarterly and after every incident, with dated runs you can diff.
- **Marking items "N/A" without recorded evidence.** An unsupported skip hides an unpriced risk behind administrative shorthand. Fix: every skip names an owner, the reason, and a date the decision is revisited.
- **Assigning the whole list to one person.** Thirty items spanning secrets, pools, and on-call design do not have one honest owner, and unowned items rot silently. Fix: assign items to the person on call for each surface.
- **Copy-pasting the list between services.** Tracker's items — cursor pagination, idempotency keys, optimistic locking — do not all transfer to a service with different failure modes, and inherited items become box-checking. Fix: prune to what applies; add what the service uniquely needs.
- **Letting the checklist replace tests and metrics.** A checklist verifies that decisions and controls exist, not that code works this week. Fix: link each item to its enforcement point — the CI job, the probe, the dashboard — so drift is detected by machinery, not memory.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 500 spike in the first minutes after every deploy | Item 7 — no graceful drain; in-flight requests die with the old process | Wire the full SIGTERM sequence (§16.1) and verify readiness flips first |
| Pods restart in a loop during a brief Redis blip | Item 8 — dependency checks on the liveness probe | Move dependency checks to readiness; liveness reports process state only |
| Same task created twice after a client retry | Item 9 — no idempotency key on task creation | Require `Idempotency-Key` on unsafe routes and cache responses (§8) |
| p95 on the tasks list grows with page number | Items 16–17 — deep-offset pagination over an unindexed sort | Switch to cursor pagination and add the composite index (§9, §7) |
| A response contains another organization's project | Item 3 — role checked, project membership not | Add the ABAC membership check on the route (§6) and a failing test (§13) |
| Bearer tokens found in the log aggregator | Item 20 — redaction paths missing from the logger config | Add `authorization`, `cookie`, and `token` to Pino's `redact` paths (§11) |
