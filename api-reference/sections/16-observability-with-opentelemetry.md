## 16. Observability with OpenTelemetry

When a request degrades, logs tell you what each component believed happened; they cannot show you the path. A trace can: it connects the Express handler, the Prisma queries, and the Redis commands from one request into a single tree you read top to bottom. Metrics compress millions of those trees into numbers you can graph and alert on. Logs, metrics, and traces are three views of one story, and OpenTelemetry (OTel) is the instrument layer that produces all three without coupling your code to a vendor: you instrument once, export over OTLP to whatever backend you run — Jaeger, Grafana Tempo, Datadog, Honeycomb — and swapping backends never touches application code.

Tracker wires OTel with three pieces. `src/telemetry/otel.ts` boots `@opentelemetry/sdk-node` with auto-instrumentations that patch Express, Prisma, ioredis, and undici as modules load. `src/telemetry/metrics.ts` declares the business instruments generic tooling cannot know: tasks created per priority, optimistic-lock conflicts, service operation latency, cache outcomes. Manual spans in the service layer mark the operations worth reading as units. Everything ships over OTLP — traces to `/v1/traces`, metrics to `/v1/metrics` — controlled entirely by environment variables, so local development runs telemetry-free and production is a config change.

The chapter closes with the part your orchestrator actually consumes: `GET /health/live` and `GET /health/ready`, plus the shutdown path that keeps them honest. Section 11's correlation ids already thread through every log line; here you bind them to trace ids, so the jump from a log line to its trace is one query.

### 16.1 Installing and bootstrapping the SDK

Install the SDK, the API package, the OTLP exporters, and the runtime instrumentation:

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/sdk-metrics \
  @opentelemetry/resources \
  @opentelemetry/instrumentation-runtime-node
```

`@opentelemetry/api` is the package your application code imports — the SDK registers an implementation behind it at runtime. Keeping the API as your only compile-time surface means the code in §16.3 and §16.4 works identically with telemetry enabled or disabled.

One ordering rule governs everything in this section: **the SDK must start before application modules load.** Auto-instrumentations work by patching modules at import time. Import Express before the SDK starts and requests flow through unpatched code — you get a running SDK with nothing to instrument. Under ESM, static imports hoist, so a top-level `import { createApp } from './app.js'` in `server.ts` would load the entire application before any of your statements run. The fix is to start telemetry first and import the app dynamically afterward.

That is exactly what `src/telemetry/otel.ts` and the bootstrap in `server.ts` implement:

```typescript
// src/telemetry/otel.ts
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { logger } from '../lib/logger.js'

let sdk: NodeSDK | undefined

/**
 * Starts tracing and metrics. Must run before any application module is
 * imported, so the auto-instrumentations can patch them at load time.
 * No-ops when OTEL_EXPORTER_OTLP_ENDPOINT is unset (tests, local runs
 * without a collector).
 */
export function startTelemetry(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint || sdk) return

  if (process.env.OTEL_LOG_LEVEL === 'debug') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG)
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME ?? 'tracker-api',
      'service.version': process.env.npm_package_version ?? '0.0.0',
      'deployment.environment': process.env.NODE_ENV ?? 'development',
    }),
    // Both exporters read OTEL_EXPORTER_OTLP_ENDPOINT from the environment
    // and append the signal-specific path (/v1/traces, /v1/metrics), per the
    // OTel spec. OTEL_EXPORTER_OTLP_HEADERS adds auth headers the same way.
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 15_000,
    }),
    instrumentations: [getNodeAutoInstrumentations(), new RuntimeNodeInstrumentation()],
  })

  sdk.start()
  logger.info({ endpoint }, 'OpenTelemetry SDK started')
}

/**
 * Flushes and shuts down exporters. Await this during graceful shutdown —
 * the batch span processor holds spans for up to a few seconds before
 * exporting, and everything still buffered is lost if the process exits first.
 */
export async function shutdownTelemetry(timeoutMs = 5_000): Promise<void> {
  if (!sdk) return
  const current = sdk
  sdk = undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      current.shutdown(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('telemetry shutdown timed out')), timeoutMs)
      }),
    ])
    logger.info('OpenTelemetry SDK shut down cleanly')
  } catch (err) {
    logger.warn({ err }, 'OpenTelemetry shutdown incomplete; some spans or metrics may be lost')
  } finally {
    clearTimeout(timer)
  }
}
```

Walk through the choices. The **resource** describes who is emitting: service name, version, and environment. These three attributes are how a backend separates staging from production, so get them from the environment rather than hard-coding. The **trace exporter** and **metric reader** ship over OTLP/HTTP; the reader batches metrics and flushes every 15 seconds, which is a good balance between backend load and dashboard freshness. The **auto-instrumentations** meta-package patches Express, Prisma (with tracing enabled — below), ioredis, and undici's `fetch`. The **runtime instrumentation** adds the process gauges you want on every dashboard: event loop delay, GC pauses, heap usage.

The gating is deliberate. `startTelemetry()` returns immediately when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, which means tests and collector-less local runs get zero overhead and zero exporter noise. Other behavior comes from standard OTel environment variables the SDK reads without any custom code: `OTEL_SERVICE_NAME` (if you prefer it over the resource attribute), `OTEL_TRACES_SAMPLER`, and `OTEL_TRACES_SAMPLER_ARG` (covered in §16.7).

`server.ts` is the bootstrap the file layout in §2 promises: env → telemetry → listen → graceful shutdown.

```typescript
// src/server.ts
import { config } from './config/env.js'
import { setServerDraining } from './features/health/router.js'
import { logger } from './lib/logger.js'
import { prisma } from './lib/prisma.js'
import { redis } from './lib/redis.js'
import { initBusinessMetrics } from './telemetry/metrics.js'
import { shutdownTelemetry, startTelemetry } from './telemetry/otel.js'

const SHUTDOWN_TIMEOUT_MS = 15_000 // surface this through config/env.ts if you prefer

async function bootstrap(): Promise<void> {
  startTelemetry()
  initBusinessMetrics()

  // Dynamic import: the app and every module it loads must initialize after
  // the SDK, or the auto-instrumentations miss them entirely (see §16.1).
  const { createApp } = await import('./app.js')
  const server = createApp().listen(config.PORT, () => {
    logger.info({ port: config.PORT }, `tracker-api listening on :${config.PORT}`)
  })

  let shuttingDown = false
  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'shutdown signal received; draining')

    // Flip readiness first: the load balancer stops routing to this instance
    // while in-flight requests finish on their existing connections.
    setServerDraining()
    server.closeIdleConnections()

    const forceExit = setTimeout(() => {
      logger.error('graceful shutdown timed out; forcing exit')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)

    server.close(async () => {
      clearTimeout(forceExit)
      try {
        await Promise.all([prisma.$disconnect(), redis.quit()])
        await shutdownTelemetry()
        logger.info('shutdown complete')
        process.exit(0)
      } catch (err) {
        logger.error({ err }, 'error during shutdown')
        process.exit(1)
      }
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection')
  })
}

bootstrap().catch((err: unknown) => {
  logger.error({ err }, 'tracker-api failed to start')
  process.exit(1)
})
```

The shutdown sequence earns the comment on each step. Flipping readiness before closing the listener means the orchestrator stops sending traffic while existing requests finish — a 503 on `/health/ready` during drain is correct behavior, not an incident. `closeIdleConnections()` drops keep-alive sockets that would otherwise hold `server.close()` open until the client gives up. Disconnecting Prisma and Redis comes before flushing telemetry so spans recording the shutdown itself are included in the flush.

### 16.2 What the auto-instrumentations capture

With the SDK started first, every HTTP request creates a server span named after its matched route — `POST /api/v1/tasks`, never the URL. Route names, not URLs, matter: URLs contain identifiers, and identifier-bearing span names fragment your aggregations into uselessness. Express middleware spans nest inside the server span; Prisma emits one span per query once tracing is enabled in the generator block; ioredis emits one span per command; undici emits client spans for outbound `fetch` and injects the W3C `traceparent` header on the way out.

Prisma needs one line in §7's generator block to participate:

```prisma
// prisma/schema.prisma — §7's generator block gains one line
generator client {
  provider        = "prisma-client"
  output          = "../src/generated/prisma"
  previewFeatures = ["tracing"]
}
```

Run `pnpm prisma generate` after adding it. From then on, every query, transaction, and connection acquisition appears as a span with the Prisma operation name.

Put together, a task creation reads as a tree:

    POST /api/v1/tasks                                 41.3 ms
    ├── middleware: jsonParser
    ├── middleware: authenticate                       (§5 — jose verify)
    ├── tasks.create                                   (manual span, §16.4)
    │   ├── Prisma: project.findFirst                  (membership lookup)
    │   └── Prisma: $transaction
    │       ├── Prisma: task.create
    │       └── Prisma: auditLog.create
    └── redis: set nx ex                               (§8 idempotency claim)

This tree answers the questions a log timeline cannot: the request was slow because the membership lookup and the transaction were two separate round trips to Postgres, and the idempotency claim added a Redis hop. You do not write any of this instrumentation — the auto-instrumentations produce it because the modules were loaded after `startTelemetry()`.

### 16.3 Business metrics

Auto-instrumentation answers "is the machinery healthy." Only you can name the business events worth waking someone for: tasks are being created, updates are conflicting, cache reads are hitting. Those belong in a dedicated meter with a dedicated module:

```typescript
// src/telemetry/metrics.ts
import {
  metrics,
  type Counter,
  type Histogram,
  type Meter,
} from '@opentelemetry/api'

let tasksCreated: Counter | undefined
let taskConflicts: Counter | undefined
let operationDuration: Histogram | undefined
let cacheLookups: Counter | undefined

/**
 * Creates the business instruments against the SDK's meter provider.
 * Call once from server.ts, immediately after startTelemetry().
 */
export function initBusinessMetrics(): void {
  const meter: Meter = metrics.getMeter('tracker.business', '1.0.0')

  tasksCreated = meter.createCounter('tracker.tasks.created', {
    description: 'Tasks created, by priority',
  })
  taskConflicts = meter.createCounter('tracker.tasks.update.conflicts', {
    description: 'Optimistic-lock conflicts on task update (§8)',
  })
  operationDuration = meter.createHistogram('tracker.service.operation.duration', {
    description: 'Service-layer operation latency',
    unit: 'ms',
  })
  cacheLookups = meter.createCounter('tracker.cache.lookups', {
    description: 'Cache lookups by outcome (§12)',
  })
}

export function recordTaskCreated(priority: string): void {
  tasksCreated?.add(1, { priority })
}

export function recordTaskConflict(): void {
  taskConflicts?.add(1)
}

export function recordOperation(name: string, durationMs: number): void {
  operationDuration?.record(durationMs, { operation: name })
}

export function recordCacheLookup(outcome: 'hit' | 'miss' | 'error'): void {
  cacheLookups?.add(1, { outcome })
}
```

The optional chaining in every recorder is the testing contract. Tests import `app.ts` directly without starting telemetry, so `metrics.getMeter()` returns the no-op provider and every instrument stays `undefined` — the recorders become free calls. Production calls `initBusinessMetrics()` after `startTelemetry()`, and the same functions emit real data.

The attribute discipline is not optional. Every unique attribute-value combination is a separate time series in the backend, forever. `priority` takes four values — four series. `priority` plus `operation` plus `outcome` — still bounded. The moment you put `userId`, `taskId`, or `organizationId` on a metric, series count scales with your user base and the backend's memory bill follows it. Identifiers belong on **span attributes**, where they cost one value per request instead of one series forever; bounded enums and route names belong on metrics.

Note what each instrument type is for: **counters** go up only — events, never levels; **histograms** record distributions — the operation-duration histogram gives you p50/p95/p99 without storing individual values; **gauges** (like the event loop delay from the runtime instrumentation) report a current value. §12's cache helpers call `recordCacheLookup('hit' | 'miss' | 'error')`, and §8's update path calls `recordTaskConflict()` where it throws `ConflictError` — the metrics module is the single point where cross-section behavior becomes visible on a dashboard.

### 16.4 Manual spans in the service layer

Auto-instrumentation spans name frameworks, not intentions. A span per service operation gives every trace a readable unit of work — `tasks.create`, not a pile of middleware — and everything awaited inside it (Prisma queries, Redis commands, outbound calls) nests underneath automatically because the context flows through the async chain. That nesting is §16.5's subject; here is the instrumented operation:

```typescript
// src/features/tasks/service.ts — createTask, with column names per §7's schema
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { performance } from 'node:perf_hooks'
import { ForbiddenError, NotFoundError } from '../../errors.js'
import { prisma } from '../../lib/prisma.js'
import type { AuthedUser } from '../../middleware/auth.js'
import { can } from '../../policies/can.js'
import { recordOperation, recordTaskCreated } from '../../telemetry/metrics.js'
import type { Task } from '../../generated/prisma/client.js'
import { projectRepo } from './repo.js'
import type { CreateTaskInput } from './schemas.js'

const tracer = trace.getTracer('tracker.tasks', '1.0.0')

export async function createTask(actor: AuthedUser, input: CreateTaskInput): Promise<Task> {
  return tracer.startActiveSpan('tasks.create', async (span) => {
    try {
      span.setAttribute('tracker.project_id', input.projectId)
      span.setAttribute('tracker.priority', input.priority)

      const project = await projectRepo.findById(input.projectId)
      if (!project) throw new NotFoundError('Project not found')
      if (!can(actor, 'task:create', project)) {
        throw new ForbiddenError('Not a member of this project')
      }

      const started = performance.now()
      const task = await prisma.$transaction(async (tx) => {
        const created = await tx.task.create({
          data: {
            projectId: project.id,
            title: input.title,
            description: input.description,
            priority: input.priority,
            status: 'TODO',
            version: 1,
            assigneeId: input.assigneeId,
            dueDate: input.dueDate,
          },
        })
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            organizationId: project.organizationId,
            action: 'task.create',
            entityType: 'Task',
            entityId: created.id,
          },
        })
        return created
      })

      recordTaskCreated(task.priority)
      recordOperation('tasks.create', performance.now() - started)
      span.setStatus({ code: SpanStatusCode.OK })
      return task
    } catch (err) {
      span.recordException(err as Error)
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message })
      throw err
    } finally {
      span.end()
    }
  })
}
```

The rules this function follows, in the order you will be tempted to break them. The span name `tasks.create` is stable and low-cardinality; the identifiers live in `tracker.project_id` as attributes. `startActiveSpan` makes the span current for the whole callback, so the Prisma and Redis spans underneath become its children with no extra wiring. `recordException` plus the `ERROR` status is what makes failed traces searchable — without the status, the trace shows a successful-shaped tree that happens to end in a throw. And `span.end()` in `finally` is what makes any of this visible: an unended span never exports, no matter how the block exits.

Do not go further than the service boundary. Wrapping every repository call in a manual span duplicates what the Prisma instrumentation already emits and buries the tree you are trying to read. One span per service operation, attributes for identifiers, and let the auto-instrumentations narrate the internals.

### 16.5 Context propagation

A trace hangs together because context — the active span — travels with the work. In-process, Node's `AsyncLocalStorage`-based context propagation moves it through `await`, callbacks, and Promise chains without your involvement: the span activated by `startActiveSpan` in §16.4 is still active three awaits deeper. Across process boundaries, propagation is the W3C Trace Context format: the `traceparent` header. Inbound requests have it extracted automatically, so a client — or another instance of Tracker — can hand you its trace id and your spans continue its trace. Outbound `fetch` calls have it injected automatically, so your client spans link into the downstream service's trace. Nothing to write; just do not strip the header at your ingress.

Two integrations are worth writing. First, bridging logs and traces — the single highest-value line of observability glue you will add. Merge this mixin into the Pino options object that §11 builds in `src/lib/logger.ts`:

```typescript
// src/lib/logger.ts — merge into the Pino options built in §11
import { context, trace } from '@opentelemetry/api'

mixin() {
  const span = trace.getSpan(context.active())
  if (!span) return {}
  const { traceId, spanId } = span.spanContext()
  return { trace_id: traceId, span_id: spanId }
}
```

Every log line now carries the trace id of the request it belongs to. In a backend that links the two (most do), "find the log line, click through to the trace" is one hop instead of a correlation query.

Second, deferred work. Context does not cross `setTimeout` on its own — a callback scheduled from a request handler runs on a fresh context, and its spans detach from the request's trace. Capture the context explicitly and restore it when the work runs:

```typescript
// Pattern for any deferred continuation: webhook dispatch, email sends,
// post-commit enrichment. Keep it in src/utils/ if you defer work in
// more than one place.
import { context, type Context } from '@opentelemetry/api'

export function runWithCapturedContext<T>(ctx: Context, work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    setTimeout(() => {
      context.with(ctx, () => work()).then(resolve, reject)
    }, 0)
  })
}
```

The caller captures before deferring: `runWithCapturedContext(context.active(), () => dispatchNotification(channel))`. Everything the continuation emits — its own spans, its metric context, the log mixin's `trace_id` — lands under the original request's trace instead of orphaned at the trace root.

One more bridge, one line: §11's request-id middleware can stamp the correlation id onto the current server span — `trace.getSpan(context.active())?.setAttribute('tracker.correlation_id', correlationId)` — so the trace carries the same handle every log line does. Between `trace_id` on logs and `correlation_id` on traces, the two systems share a key in both directions.

### 16.6 Health and readiness endpoints

Orchestrators and load balancers consume two different questions, and conflating them is the most common health-check failure in production. **Liveness** asks "is the process up" — if it fails, the orchestrator restarts the container. **Readiness** asks "can this instance serve traffic right now" — if it fails, traffic stops but nothing restarts. A liveness check that verifies dependencies turns every Redis blip into a simultaneous restart of every instance: a five-second cache outage becomes a full-service outage. Dependency checks belong in readiness, exclusively.

Both endpoints are unauthenticated and excluded from rate limiting — probes cannot carry bearer tokens, and a rate limiter that throttles the orchestrator will mark healthy instances dead exactly when they are busiest. The mechanism is mount order in `app.ts`, shown after the router.

```typescript
// src/features/health/router.ts
import { Router, type Response } from 'express'
import { prisma } from '../../lib/prisma.js'
import { redis } from '../../lib/redis.js'

const CHECK_TIMEOUT_MS = 500

/** Flipped during graceful shutdown so readiness fails while connections drain. */
let serving = true

export function setServerDraining(): void {
  serving = false
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`check timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function checkPostgres(): Promise<boolean> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS)
    return true
  } catch {
    return false
  }
}

async function checkRedis(): Promise<boolean> {
  try {
    await withTimeout(redis.ping(), CHECK_TIMEOUT_MS)
    return true
  } catch {
    return false
  }
}

export const healthRouter = Router()

healthRouter.get('/live', (_req, res) => {
  // Liveness answers one question: is the process up? It must never check
  // dependencies — a dependency blip here restarts every instance at once.
  res.status(200).json({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()) })
})

healthRouter.get('/ready', async (_req, res) => {
  if (!serving) {
    return respondUnready(res, ['process is draining'])
  }

  const [postgres, redisUp] = await Promise.all([checkPostgres(), checkRedis()])

  if (postgres && redisUp) {
    return res.status(200).json({
      status: 'ok',
      checks: { postgres: 'up', redis: 'up' },
    })
  }
  return respondUnready(res, [
    ...(postgres ? [] : ['postgres check failed']),
    ...(redisUp ? [] : ['redis check failed']),
  ])
})

function respondUnready(res: Response, detail: string[]): Response {
  // Built by hand rather than thrown: readiness is operational state, not a
  // domain error, and §10's hierarchy has no 503 class. The body still
  // conforms to the problem+json shape every other error response uses.
  return res.status(503).type('application/problem+json').json({
    type: 'https://tracker-api.dev/problems/unready',
    title: 'Service Unavailable',
    status: 503,
    detail: detail.join('; '),
    instance: '/health/ready',
    correlationId: res.locals.correlationId ?? null,
  })
}
```

Three details do the production work. The `withTimeout` wrapper bounds each check at 500 ms — without it, a hung TCP connection to a dead Redis holds the probe open until the orchestrator's own timeout, which is a slow, mysterious failure mode. The checks run in `Promise.all`, so readiness costs one Postgres round trip and one Redis round trip, in parallel, per probe. And `setServerDraining` — called first thing in §16.1's shutdown sequence — makes readiness fail during drain, so the load balancer stops routing to a dying instance while its in-flight requests finish.

The 503 body is hand-built rather than thrown. §10's `AppError` hierarchy maps thrown domain errors to problem details, but it has no 503 class, and readiness is operational state rather than a domain failure. The response keeps the contract's shape — `type`, `title`, `status`, `detail`, `instance`, `correlationId` — plus a `checks` extension member, which RFC 7807 explicitly permits. Wire consumers get a machine-readable body; humans debugging get the failing dependency named in `detail`.

Where the router mounts is the exclusion mechanism:

```typescript
// src/app.ts — mount order is the exclusion mechanism (relevant excerpt;
// the full createApp listing is §3's)
export function createApp(): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(requestId)               // §11: correlation id on every request
  app.use('/health', healthRouter) // §16: probes never authenticate, never hit the limiter
  app.use(rateLimiter)             // §12: everything mounted below is rate limited
  app.use(authenticate)            // §5: everything mounted below requires a bearer token
  // feature routers (§4), then error handler and not-found (§10)
  return app
}
```

Because `/health` mounts before the rate limiter and the auth middleware, those layers never see probe traffic. That is scenario 14's contract: with Redis down, `GET /health/ready` returns 503 with the failing check named, while `/health/live` keeps returning 200 — and the orchestrator drains traffic instead of restarting a process that is fine.

### 16.7 Shipping to a backend

The exporters need somewhere to send. For local development, Jaeger accepts OTLP directly and renders traces in a UI you can read:

```yaml
# docker-compose.yml — add next to the postgres and redis services from §15
  jaeger:
    image: jaegertracing/all-in-one:latest # pin an immutable tag or digest in production
    ports:
      - "16686:16686" # Jaeger UI
      - "4318:4318"   # OTLP over HTTP/protobuf
      - "4317:4317"   # OTLP over gRPC (unused by these exporters; listed for completeness)
```

and the application service's environment gains:

```yaml
  app:
    environment:
      OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4318
      OTEL_SERVICE_NAME: tracker-api
      OTEL_TRACES_SAMPLER: parentbased_traceidratio
      OTEL_TRACES_SAMPLER_ARG: "0.1"
```

Point `OTEL_EXPORTER_OTLP_ENDPOINT` at the base URL — the exporters append `/v1/traces` and `/v1/metrics` themselves. Getting this wrong is the most common first-day failure: `http://jaeger:4318/v1/traces` as the endpoint produces requests to `/v1/traces/v1/traces`.

The two sampler lines are head sampling: each trace's root decides once — `parentbased_traceidratio` with `OTEL_TRACES_SAMPLER_ARG=0.1` keeps 10% of traces, and every child span follows the root's decision. Ten percent is a reasonable production default; the full 100% is a cost decision you should make consciously, and 0.1% is a lottery that will not contain the one failed request you need. When you eventually need error-biased retention — keep all failures, sample successes — that is tail sampling, a collector-side policy, and it requires no application change because the SDK already ships everything OTLP.

Metrics need a backend that stores them — Jaeger is traces-only. Point the same SDK at a metrics-capable OTLP receiver: an OpenTelemetry Collector configured with a Prometheus exporter, or a hosted platform's OTLP endpoint. The exporter code does not change; the endpoint and any auth headers (`OTEL_EXPORTER_OTLP_HEADERS`) do.

What to alert on, in order of how often it saves you. **RED per route** — request rate, error rate (5xx share), and duration p95/p99 from the auto-instrumented server spans — catches "the API is degraded" minutes before a human would. **Saturation** — event loop delay and GC from the runtime instrumentation, Postgres pool and Redis socket utilization — explains it. **Business counters** catch what RED cannot: `tracker.tasks.created` flatlining while every request returns 200 means the feature is silently broken, and that alert has no infrastructure symptom to hide behind. Threshold each alert against a measured baseline, not a guessed number — §17's item 30 covers how the baseline gets measured.

### Common mistakes

- **Starting telemetry after the application modules load.** Auto-instrumentations patch modules at import time, so anything imported before `startTelemetry()` runs uninstrumented and emits no spans. Fix: keep the dynamic import in `server.ts` (or load the SDK via `node --import`), so the SDK is always first.
- **High-cardinality attributes on metrics.** User ids, task ids, or free-text labels on a metric create one time series per unique value and exhaust backend memory and budget. Fix: bounded enums and route names on metrics; identifiers go on span attributes.
- **Skipping the telemetry flush on shutdown.** The batch span processor holds spans for a few seconds before exporting, and a container that exits without `shutdownTelemetry()` loses everything still buffered — always the last moments before a crash, which are exactly the moments you wanted. Fix: await `shutdownTelemetry()` in the SIGTERM path.
- **Wrapping every repository call in a manual span.** Hand-rolled spans around Prisma calls duplicate the auto-instrumented ones and bury the tree under noise. Fix: one manual span per service operation; let auto-instrumentation narrate internals.
- **Checking dependencies in the liveness probe.** A dependency blip then fails liveness, the orchestrator restarts every instance simultaneously, and a five-second hiccup becomes an outage. Fix: liveness answers "is the process up"; dependencies belong in readiness only.
- **Shipping with the default sampler configuration.** The SDK defaults to sampling 100% of traces, which is a cost decision you will discover on an invoice rather than in review. Fix: set `OTEL_TRACES_SAMPLER=parentbased_traceidratio` and a deliberate `OTEL_TRACES_SAMPLER_ARG` per environment.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Backend shows no traces despite live traffic | Telemetry started after app modules imported, or `OTEL_EXPORTER_OTLP_ENDPOINT` unset so `startTelemetry` no-oped | Confirm the "OpenTelemetry SDK started" log line; keep the dynamic import order in `server.ts` |
| Exporter logs "connection refused" against port 4317 | gRPC port targeted by the OTLP/HTTP exporters | Point `OTEL_EXPORTER_OTLP_ENDPOINT` at port 4318; exporters append `/v1/traces` and `/v1/metrics` |
| Trace tree has no Prisma spans | Tracing not enabled in the Prisma generator block | Add `previewFeatures = ["tracing"]` and run `pnpm prisma generate` |
| `GET /health/ready` returns 503 while `psql` to the same database works | 500 ms check timeout too tight for a loaded database, or Redis auth failing | Raise `CHECK_TIMEOUT_MS` toward 1000–2000; verify Redis credentials and ACLs |
| Metrics stop exporting under load while traces continue | Metric exporter queue overflowing; default queue is small | Increase the exporter's queue/timeout options or lengthen `exportIntervalMillis` |
| Traces visible in Jaeger but no metrics anywhere | Jaeger stores traces only; metric reader has no receiver | Point the metric reader at an OTLP-capable metrics backend (Collector with Prometheus export, or a hosted endpoint) |
