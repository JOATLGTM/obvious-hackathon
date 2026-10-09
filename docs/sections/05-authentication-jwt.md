## 5. Authentication: JWT Access and Refresh Tokens

Authentication answers "who is calling?" before any business logic runs. SupplementDirect issues
every caller two credentials at login: a **short-lived access token** — a JWT the API verifies
statelessly on every request — and a **long-lived refresh token** — an opaque random string stored
in the database, sent to the client in an `HttpOnly` cookie, and redeemed when the access token
expires. This section builds both halves end to end: token signing and verification with `jose`
(HS256), the `RefreshToken` table and its migration, the refresh-token repository, the auth service
with rotation and reuse detection, the `authenticate` middleware, and the four `/v1/auth` routes.
Section 6 then decides "what is this caller allowed to do?" on top of the identity established here.

### Why two tokens instead of one

Three forces pull credential design in different directions, and no single token satisfies all
three at once.

**Blast radius.** A bearer credential proves nothing except possession: whoever holds the token
*is* the user, as far as the API is concerned. Tokens get stolen — from logs, proxies, browser
extensions, stolen laptops, referer headers. When that happens the damage window is exactly the
remaining lifetime of the token. A 15-minute access token is usually worthless to a thief by the
time anyone notices; a 30-day token gives the thief a month. Short access tokens exist to cap that
window at minutes.

**Revocation.** Stateless verification is the entire performance argument for JWTs — no database
hit per request — but it makes a token impossible to revoke. The signature stays valid until `exp`
no matter what you do to the database afterward. Real systems need to kill sessions: the user logs
out, is deactivated, changes password after a phishing email, or reports a stolen device. The
refresh token is the stateful half that makes revocation possible, because it lives in a table you
can write to. Revoking a session is one `UPDATE`.

**Friction.** A 15-minute credential with no renewal mechanism means logging in every quarter
hour, which no one would tolerate. The refresh token renews the access token silently: the user
authenticates once per month (per device, really), while the API keeps handing out 15-minute
access tokens.

Put together: the access token is small and stateless and dies fast; the refresh token is the
durable, revocable root of the session. Neither credential alone gives you all three properties.

### Why the refresh token is an opaque random in the database, not a second JWT

A tempting shortcut is a second JWT — a "session token" with a 30-day expiry. It is easier to
build and worse to operate:

1. **You need server-side state anyway.** The requirements — revoke on logout, revoke on
   compromise, rotate on every use — are all database writes. A stateless refresh token cannot be
   revoked without a server-side denylist of token IDs, and a denylist is strictly more machinery
   than a token table: you maintain both issuance and revocation state, and correctness now
   depends on every replica consulting the denylist before honoring the token.
2. **A JWT refresh token leaks claims for 30 days.** Anything that lives a month should carry as
   little information as possible. An opaque token leaks nothing. A second JWT repeats the user's
   role, practice ID, and user ID to anyone who reads the cookie value in a log or a memory dump.
3. **Two JWTs double the cryptographic attack surface.** Every JWT is its own algorithm
   negotiation — `alg` header, key selection, claim validation — and each is a chance for the
   algorithm-confusion bugs described in Common mistakes below. An opaque token has no parser and
   no algorithm: the only operation it supports is an indexed lookup of its SHA-256 hash.
4. **Size.** A 256-bit random value is 43 characters of base64url. A claims-bearing JWT is several
   hundred characters and rides in every refresh request's cookie.

The lookup costs one indexed `WHERE token_hash = ?` query per refresh — once per 15 minutes per
active session, against the per-request database hit the stateless access token saves.

### Rotation and reuse detection

**Rotation** means every successful refresh exchanges the presented token for a brand-new one and
records the old one as revoked with a pointer to its replacement (`replacedById`). Tokens
therefore form a linked chain, and all tokens exchanged since one login share a `familyId` — a
token family.

Under normal operation each refresh token is presented exactly once. **Reuse detection** is the
inverse tripwire: if a token arrives that is *already revoked*, the chain has forked — two parties
presented the same credential, and they cannot both be legitimate.

The honest framing of the response: when a revoked token reappears, the server cannot distinguish
a legitimate client that crashed after receiving a response but before persisting the new token
from an attacker who stole the token and used it first. We choose to assume theft, because the
cost of being wrong in each direction is asymmetric. Assuming theft costs a legitimate user a
re-login. Ignoring it costs a 30-day session hijack. So on reuse, the service revokes the entire
family — every token descended from that login — and forces a fresh login. This is also the
response the OAuth threat-model literature (RFC 6819 and the OAuth Security Best Current Practice)
recommends for refresh-token replay; that background is general knowledge, not something fetched
for this section, but it matches the failure mode exactly.

What rotation plus reuse detection buys you, concretely:

- A stolen refresh token is worth at most one exchange. The moment both thief and victim use the
  chain, the fork is detected and the whole family dies.
- Compromise response is a single write (revoke the family), not "wait for expiry" and not a
  denylist rollout across replicas.
- Every rotation is also the point where fresh claims are minted — role or practice changes take
  effect within one refresh instead of after a 30-day expiry.

### The RefreshToken model

The `RefreshToken` table is deliberately tiny. The raw token never touches the database — only its
SHA-256 hash — so a SQL dump, a backup, or a log line containing table contents does not leak
usable credentials.

```prisma
// prisma/schema.prisma — excerpt. Section 7 carries the full schema with the 8 domain models;
// this auxiliary model and the matching back-relation on User are added here.

model RefreshToken {
  id           String    @id @default(uuid())
  userId       String
  tokenHash    String    @unique @db.VarChar(64) // hex sha256 of the opaque token; never the raw token
  familyId     String                            // all rotations since one login share this
  expiresAt    DateTime
  revokedAt    DateTime?                         // set when rotated, logged out, or family-revoked
  replacedById String?                           // the child token this one was rotated into
  createdAt    DateTime  @default(now())

  user User @relation(fields: [userId], references: [id])

  @@index([familyId])
  @@index([userId])
  @@index([expiresAt])
}
```

Section 7's `User` model gains the matching back-relation: `refreshTokens RefreshToken[]`.
`familyId` is a plain UUID string (generated with `crypto.randomUUID()` at login), not a foreign
key — the family is a query grouping, not an entity. The `expiresAt` index exists for the
housekeeping sweeper.

Apply it with a migration:

```bash
$ npx prisma migrate dev --name add_refresh_token

# in production pipelines:
$ npx prisma migrate deploy
```

Dependencies for this section:

```bash
$ npm install jose argon2 cookie-parser
$ npm install -D @types/cookie-parser
```

`JWT_SECRET` must be at least 32 bytes — `src/config/env.ts` (section 1) validates that at boot.
Generate one with `openssl rand -base64 48` and store it in your secret manager, never in the
repository.

### Access tokens: src/auth/tokens.ts

The access token is an HS256 JWT with exactly the claims pinned in the shared contract:
`sub` (user id), `role`, `practiceId` (null for PATIENT accounts — patients are not practice
staff), `jti` (a unique token id, useful in audit logs), `iat`, `exp`, `iss`, and `aud`.

```ts
// src/auth/tokens.ts
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { UnauthorizedError } from '../errors';
import type { Role } from './types';

const TOKEN_ISSUER = 'supplementdirect-api';
const TOKEN_AUDIENCE = 'supplementdirect-clients';
const ALLOWED_ALGORITHMS = ['HS256'];

// Section 1 validates at boot that JWT_SECRET exists and is at least 32 bytes.
const secretKey = new TextEncoder().encode(env.JWT_SECRET);

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  role: Role;
  practiceId: string | null;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface AccessTokenSubject {
  id: string;
  role: Role;
  practiceId: string | null;
}

export async function signAccessToken(subject: AccessTokenSubject): Promise<string> {
  return new SignJWT({ role: subject.role, practiceId: subject.practiceId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(subject.id)
    .setJti(randomUUID())
    .setIssuedAt()
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setExpirationTime(env.ACCESS_TOKEN_TTL) // e.g. '15m' (section 1's env default)
    .sign(secretKey);
}

function isAccessTokenClaims(payload: JWTPayload): payload is AccessTokenClaims {
  return (
    typeof payload.sub === 'string' &&
    (payload.role === 'ADMIN' || payload.role === 'PROVIDER' || payload.role === 'PATIENT') &&
    (payload.practiceId === null || typeof payload.practiceId === 'string') &&
    typeof payload.jti === 'string' &&
    typeof payload.iat === 'number' &&
    typeof payload.exp === 'number' &&
    typeof payload.iss === 'string' &&
    typeof payload.aud === 'string'
  );
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, secretKey, {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      algorithms: ALLOWED_ALGORITHMS,
      clockTolerance: 5, // seconds; servers' clocks drift
    });
    payload = result.payload;
  } catch {
    // One uniform message on purpose: never tell the caller whether the token was expired,
    // tampered with, or malformed — that distinction is an oracle. Log the underlying jose
    // error server-side (section 11's request logger) if you need the specifics.
    throw new UnauthorizedError('Invalid or expired access token');
  }
  if (!isAccessTokenClaims(payload)) {
    throw new UnauthorizedError('Access token is missing required claims');
  }
  return payload;
}
```

Two deliberate details. First, `algorithms: ['HS256']` is pinned explicitly — the `alg` header of
an incoming token is attacker-controlled input, and "accept whatever the header claims" is the
root of both the `alg: none` and algorithm-confusion attack classes. Second, verification failures
map to `UnauthorizedError` with a single generic detail; the RFC 7807 rendering (status 401,
`code: 'unauthorized'`, problem+json body) is the error hierarchy's job, shown fully in section 10.

### The refresh-token repository

Repositories are the only layer that imports Prisma (the layering pin from the shared contract).
Every method accepts an optional transaction client so the service can compose them inside one
transaction; the `DbTx` alias is the canonical type other files import.

```ts
// src/auth/refresh.repository.ts
import { PrismaClient, Prisma } from '@prisma/client';

export type DbTx = Prisma.TransactionClient;

export interface CreateRefreshTokenInput {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateRefreshTokenInput, tx?: DbTx) {
    const db = tx ?? this.prisma;
    return db.refreshToken.create({ data: input });
  }

  async findByHash(tokenHash: string, tx?: DbTx) {
    const db = tx ?? this.prisma;
    return db.refreshToken.findUnique({ where: { tokenHash } });
  }

  async revoke(tokenId: string, replacedById: string | null, tx?: DbTx) {
    const db = tx ?? this.prisma;
    return db.refreshToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date(), replacedById },
    });
  }

  async revokeFamily(familyId: string, tx?: DbTx): Promise<number> {
    const db = tx ?? this.prisma;
    const result = await db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async deleteExpired(): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
```

`deleteExpired` is the sweeper a scheduled job calls (daily is plenty); expired rows are dead
weight. It deletes revoked-and-expired rows too — if your incident-response process needs the
family history for longer, add a retention window to the `where` clause rather than skipping the
sweeper.

### A minimal user repository

The auth service needs exactly two reads/writes on `User`. Section 7 owns the full `User` schema
and the repository pattern; this compact version is everything section 5 depends on.

```ts
// src/users/users.repository.ts
import { PrismaClient, Prisma } from '@prisma/client';
import type { Role } from '../auth/types';

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

### The auth service

Four operations, each with its security decisions visible in the code:

- **register** hashes with Argon2id. The parameters below (19 MiB of memory, 2 iterations,
  parallelism 1) are the OWASP Password Storage Cheat Sheet's recommended floor for Argon2id as of
  this writing — general knowledge, so re-check the current cheat sheet when you touch them; the
  direction of progress is "more memory."
- **login** compares passwords through `argon2.verify`, which performs the time-constant
  comparison inside the library. When the email does not exist, the service still runs one full
  Argon2 verification against a dummy hash so that "unknown email" and "wrong password" take the
  same wall-clock time — without that, response timing reveals which emails are registered.
- **rotateRefresh** runs the rotation decision tree inside one transaction: unknown or expired
  tokens fail closed; a *revoked* token presented again is reuse — revoke the whole family, then
  fail; otherwise revoke the old token with a pointer to the new child, all atomically.
- **logout** revokes the presented token and is idempotent.

```ts
// src/auth/auth.service.ts
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { env } from '../config/env';
import { UnauthorizedError } from '../errors';
import { UsersRepository } from '../users/users.repository';
import { RefreshTokenRepository, type DbTx } from './refresh.repository';
import { signAccessToken } from './tokens';
import type { Role } from './types';

// Argon2id parameters: the OWASP Password Storage Cheat Sheet floor (19 MiB, 2 iterations,
// parallelism 1). General knowledge — verify against the current sheet when you change these.
const ARGON2_MEMORY_KIB = 19456;
const ARGON2_TIME_COST = 2;
const ARGON2_PARALLELISM = 1;

// A precomputed Argon2id hash of a long random string nobody knows. Verified (and paid for —
// the derivation runs either way) when a login names a user that does not exist, so that
// unknown-email and wrong-password responses take the same time.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$OL3CjKuc+Q9Fv4AneB4fNA$Ppc6Z8Ag7GI2kbaZneeGtz3cnY906/jL9hbsV53Sd5U';

const REFRESH_TOKEN_BYTES = 32; // 256 bits of entropy

// The narrow view of the database the service needs. The composition root passes the Prisma
// client itself; typing it as this port keeps Prisma imports out of the service layer and makes
// the service testable without a database.
export interface AuthDb {
  $transaction<T>(work: (tx: DbTx) => Promise<T>): Promise<T>;
}

export interface RegisterInput {
  email: string;
  password: string;
  role: 'PROVIDER' | 'PATIENT';
  practiceId?: string;
}

export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  practiceId: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function toPublicUser(user: {
  id: string;
  email: string;
  role: Role;
  practiceId: string | null;
}): PublicUser {
  return { id: user.id, email: user.email, role: user.role, practiceId: user.practiceId };
}

export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly db: AuthDb,
  ) {}

  async register(input: RegisterInput): Promise<PublicUser> {
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: ARGON2_MEMORY_KIB,
      timeCost: ARGON2_TIME_COST,
      parallelism: ARGON2_PARALLELISM,
    });
    const user = await this.users.create({
      email: input.email.toLowerCase(),
      passwordHash,
      role: input.role,
      practiceId: input.practiceId ?? null,
    });
    // A duplicate email surfaces as Prisma error P2002, which the section 10 mapper renders
    // as 409 Conflict. Note this does tell the caller the email is taken — the standard UX
    // trade-off; abuse of it is a rate-limiting concern (section 12), not a reason to lie here.
    return toPublicUser(user);
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const normalized = email.toLowerCase();
    const user = await this.users.findByEmail(normalized);
    if (user === null) {
      // Burn the same Argon2 cost a real check would burn so response timing does not reveal
      // whether the email exists (user-enumeration defense). Same message in both branches.
      await argon2.verify(DUMMY_HASH, password);
      throw new UnauthorizedError('Invalid email or password');
    }
    const passwordMatches = await argon2.verify(user.passwordHash, password);
    if (!passwordMatches) {
      throw new UnauthorizedError('Invalid email or password');
    }
    const accessToken = await signAccessToken({
      id: user.id,
      role: user.role,
      practiceId: user.practiceId,
    });
    const refreshToken = await this.issueRefreshToken(user.id, randomUUID());
    return { accessToken, refreshToken };
  }

  async rotateRefresh(rawToken: string): Promise<TokenPair> {
    const tokenHash = hashToken(rawToken);
    return this.db.$transaction(async (tx) => {
      const stored = await this.refreshTokens.findByHash(tokenHash, tx);
      if (stored === null) {
        throw new UnauthorizedError('Invalid refresh token');
      }
      if (stored.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedError('Refresh token expired');
      }
      if (stored.revokedAt !== null) {
        // REUSE DETECTION. A rotated token must never come back. When one does, the chain has
        // forked: either a client retried after a crash, or the token was stolen and both
        // parties hold it. We assume theft — the asymmetry is that a legitimate user loses a
        // re-login while an ignored thief keeps a 30-day session — and revoke the entire
        // family so the thief's chain dies with the victim's.
        await this.refreshTokens.revokeFamily(stored.familyId, tx);
        throw new UnauthorizedError('Refresh token reuse detected; all sessions of this login were revoked');
      }
      const user = await this.users.findById(stored.userId, tx);
      if (user === null) {
        throw new UnauthorizedError('Invalid refresh token');
      }
      // Fresh claims from the current user row: role or practice changes take effect here,
      // not after the old access token happens to expire.
      const accessToken = await signAccessToken({
        id: user.id,
        role: user.role,
        practiceId: user.practiceId,
      });
      const child = await this.issueRefreshToken(user.id, stored.familyId, tx);
      await this.refreshTokens.revoke(stored.id, child.id, tx);
      return { accessToken, refreshToken: child.raw };
    });
  }

  async logout(rawToken: string): Promise<void> {
    const stored = await this.refreshTokens.findByHash(hashToken(rawToken));
    if (stored === null || stored.revokedAt !== null) {
      return; // idempotent: logging out twice is not an error
    }
    await this.refreshTokens.revoke(stored.id, null);
  }

  private async issueRefreshToken(
    userId: string,
    familyId: string,
    tx?: DbTx,
  ): Promise<{ id: string; raw: string }> {
    const raw = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const created = await this.refreshTokens.create(
      { userId, tokenHash: hashToken(raw), familyId, expiresAt },
      tx,
    );
    return { id: created.id, raw };
  }
}
```

The transaction in `rotateRefresh` is not ceremony. Rotation is two writes that must happen
together — insert the child, mark the old token revoked with `replacedById`. Without the
transaction, a crash between them either strands a user with no live token or, worse, leaves two
live tokens in one family, which is exactly the ambiguity reuse detection exists to eliminate.

### The authenticate middleware

```ts
// src/auth/auth.middleware.ts
import type { Request, RequestHandler } from 'express';
import { UnauthorizedError } from '../errors';
import { verifyAccessToken } from './tokens';
import type { ReqUser, Role } from './types';

// Makes `req.user` known to TypeScript everywhere in the app.
declare global {
  namespace Express {
    interface Request {
      user?: ReqUser;
    }
  }
}

const ROLES: readonly Role[] = ['ADMIN', 'PROVIDER', 'PATIENT'];

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (header === undefined || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing Bearer access token');
    }
    const token = header.slice('Bearer '.length).trim();
    const claims = await verifyAccessToken(token);
    if (claims.sub === undefined || !ROLES.includes(claims.role)) {
      throw new UnauthorizedError('Access token has invalid claims');
    }
    const user: ReqUser = {
      id: claims.sub,
      role: claims.role,
      practiceId: claims.practiceId ?? null,
    };
    req.user = user;
    next();
  } catch (err) {
    next(err); // UnauthorizedError reaches the section 10 handler and becomes a 401 problem+json
  }
};
```

**The claim-staleness trade-off, honestly.** This middleware never touches the database. That is
the point — but it means the identity it attaches is up to 15 minutes old. If an ADMIN demotes a
PROVIDER, deactivates a user, or transfers a practice, the affected user's outstanding access
tokens keep working with their old claims until they expire. The alternatives and what they cost:

| Approach | Staleness | Cost |
|---|---|---|
| Claims only (this design) | up to 15 min | zero per-request I/O |
| DB lookup per request | none | one query on every request; latency coupled to the users table |
| Redis denylist of `jti`s | seconds | one Redis lookup per request; section 12's Redis layer can host it |

The 15-minute window is the price of stateless verification, and it is a good trade *because* the
sensitive paths do not rely on it: section 6 re-checks authorization against fresh data for
sensitive operations, and revocation-for-sure happens at the refresh layer (a deactivated user's
refresh token family can be revoked; their next refresh fails). If your compliance regime demands
instant kill across the board, add the `jti` denylist and pay the Redis lookup — but make that
decision with the cost on the table, not by default.

### The auth router

The four pinned endpoints. Express 5 forwards errors thrown in async handlers — including the
thrown Zod errors below — to the central error handler, which is why none of these handlers use
`try`/`catch`. Register the router at `/v1/auth` in the composition root (section 2), and apply
`app.use(cookieParser())` there so `req.cookies` is populated.

```ts
// src/auth/auth.router.ts
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { UnauthorizedError } from '../errors';
import { UsersRepository } from '../users/users.repository';
import { RefreshTokenRepository } from './refresh.repository';
import { AuthService, type AuthDb } from './auth.service';

const REFRESH_COOKIE = 'refresh_token';

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true, // no document.cookie access — XSS cannot read the refresh token
  secure: true, // HTTPS-only on the wire
  sameSite: 'strict' as const, // not sent on cross-site requests (see Common mistakes)
  path: '/v1/auth', // the browser sends it to the auth endpoints and nothing else
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000, // express wants ms; serializes to Max-Age=2592000
};

// clearCookie must match the path (and any domain options) or the browser keeps the old cookie.
const CLEAR_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/v1/auth',
};

const passwordSchema = z.string().min(12).max(128);

const registerSchema = z
  .object({
    email: z.email(),
    password: passwordSchema,
    // Deliberate: ADMIN is never registrable from the public endpoint. Admin accounts are
    // provisioned internally. Public self-service role selection is a privilege-escalation
    // invite; section 6's first Common mistake is exactly this bug.
    role: z.enum(['PROVIDER', 'PATIENT']),
    practiceId: z.uuid().optional(),
  })
  .refine((value) => value.role === 'PATIENT' || value.practiceId !== undefined, {
    message: 'practiceId is required when registering a PROVIDER',
    path: ['practiceId'],
  });

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
});

export interface AuthRouterDeps {
  users: UsersRepository;
  refreshTokens: RefreshTokenRepository;
  db: AuthDb;
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const authService = new AuthService(deps.users, deps.refreshTokens, deps.db);
  const router = Router();

  router.post('/register', async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw parsed.error; // section 10's mapper renders ZodError as 422 problem+json with errors[]
    }
    const user = await authService.register(parsed.data);
    res.status(201).json(user);
  });

  router.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw parsed.error;
    }
    const { accessToken, refreshToken } = await authService.login(
      parsed.data.email,
      parsed.data.password,
    );
    res.cookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
    res.status(200).json({ accessToken });
  });

  router.post('/refresh', async (req, res) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new UnauthorizedError('Missing refresh token cookie');
    }
    const { accessToken, refreshToken } = await authService.rotateRefresh(raw);
    res.cookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS); // rotated cookie on every refresh
    res.status(200).json({ accessToken });
  });

  router.post('/logout', async (req, res) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (typeof raw === 'string' && raw.length > 0) {
      await authService.logout(raw);
    }
    res.clearCookie(REFRESH_COOKIE, CLEAR_COOKIE_OPTIONS);
    res.status(204).send();
  });

  return router;
}
```

Wiring (composition root, section 2's pattern):

```ts
// src/app.ts — the auth slice of the composition root
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import express from 'express';
import { createAuthRouter } from './auth/auth.router';
import { UsersRepository } from './users/users.repository';
import { RefreshTokenRepository } from './auth/refresh.repository';

const prisma = new PrismaClient();
const app = express();

app.use(cookieParser());
app.use('/v1/auth', createAuthRouter({
  users: new UsersRepository(prisma),
  refreshTokens: new RefreshTokenRepository(prisma),
  db: prisma,
}));
```

The cookie contract, once more, in the shape the pinned endpoints produce: the access token lives
in the JSON response body and in the client's memory; the refresh token lives only in the
`Set-Cookie` header — never in a response body, never in `localStorage`.

### Walking the flow with curl

Login. `-i` shows response headers, `-c` saves the cookie jar:

```bash
$ curl -is -X POST https://api.supplementdirect.example/v1/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"ana.silva@northclinic.example","password":"correct-horse-battery-staple"}' \
    -c cookies.txt
HTTP/2 200
content-type: application/json; charset=utf-8
set-cookie: refresh_token=5VwIg1q_QCp6dbOVR3uxIHSEo7pk742prJ_MwEWfe2k; Path=/v1/auth; Max-Age=2592000; Expires=Sun, 08 Nov 2026 12:00:00 GMT; HttpOnly; Secure; SameSite=Strict
x-request-id: abc9dac2-3b62-4f1b-b6e6-848a247c6ac1
date: Fri, 09 Oct 2026 12:00:00 GMT

{"accessToken":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2MTU3M2I0NC1hMTYwLTQxMjMtYmM3NS0yMmVmMjdiNTc2YzgiLCJyb2xlIjoiUFJPVklERVIiLCJwcmFjdGljZUlkIjoiMWFiNDkxYTEtMzM4Ny00ODRhLWI2YTktNmFjOGQxMDNkZGUzIiwianRpIjoiM2FkNzkzNzEtOTk5Yy00MWQyLWJkN2QtYzQ1ZGY3ZTZiMjM1IiwiaWF0IjoxNzkxMDA0ODAwLCJleHAiOjE3OTEwMDU3MDAsImlzcyI6InN1cHBsZW1lbnRkaXJlY3QtYXBpIiwiYXVkIjoic3VwcGxlbWVudGRpcmVjdC1jbGllbnRzIn0.e5fTuuuN88iMDGzVcV_W5ymCZgk8hmLXIfMsRgiGpKA"}
```

(The token above is a display artifact with a forged signature — its payload decodes to the
pinned claim set:)

```json
{
  "sub": "61573b44-a160-4123-bc75-22ef27b576c8",
  "role": "PROVIDER",
  "practiceId": "1ab491a1-3387-484a-b6a9-6ac8d103dde3",
  "jti": "3ad79371-999c-41d2-bd7d-c45df7e6b235",
  "iat": 1791004800,
  "exp": 1791005700,
  "iss": "supplementdirect-api",
  "aud": "supplementdirect-clients"
}
```

`exp − iat = 900`: a 15-minute access token. The cookie carries `Max-Age=2592000` — exactly 30
days. Attribute order in `Set-Cookie` is irrelevant; what matters is that all five pinned
attributes are present.

Fifteen minutes later, the access token is dead. Refresh — `-b` sends the jar, `-c` overwrites it
with the rotated token:

```bash
$ curl -is -X POST https://api.supplementdirect.example/v1/auth/refresh \
    -b cookies.txt -c cookies.txt
HTTP/2 200
content-type: application/json; charset=utf-8
set-cookie: refresh_token=FEsteYk4aBhSGR1eGLELmgSNBqfFsJp5QgU4nr2Rpwg; Path=/v1/auth; Max-Age=2592000; Expires=Sun, 08 Nov 2026 12:00:05 GMT; HttpOnly; Secure; SameSite=Strict
x-request-id: 9e2f4c8a-1d77-4b0e-a3c5-6f8d2b91e0c4
date: Fri, 09 Oct 2026 12:00:05 GMT

{"accessToken":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2MTU3M2I0NC1hMTYwLTQxMjMtYmM3NS0yMmVmMjdiNTc2YzgiLCJyb2xlIjoiUFJPVklERVIiLCJwcmFjdGljZUlkIjoiMWFiNDkxYTEtMzM4Ny00ODRhLWI2YTktNmFjOGQxMDNkZGUzIiwianRpIjoiNGZlZWYzZTQtMGI5My00MDljLTg1ZDEtY2E0YzBhYWYyODFkIiwiaWF0IjoxNzkxMDA0ODA1LCJleHAiOjE3OTEwMDU3MDUsImlzcyI6InN1cHBsZW1lbnRkaXJlY3QtYXBpIiwiYXVkIjoic3VwcGxlbWVudGRpcmVjdC1jbGllbnRzIn0.e5fTuuuN88iMDGzVcV_W5ymCZgk8hmLXIfMsRgiGpKA"}
```

The cookie value changed — that is rotation. Presenting the *old* cookie value again now trips
reuse detection: 401, and every token in this family is dead in the database.

Logout — revokes the token server-side and clears the cookie:

```bash
$ curl -is -X POST https://api.supplementdirect.example/v1/auth/logout -b cookies.txt
HTTP/2 204
set-cookie: refresh_token=; Path=/v1/auth; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict
x-request-id: 0b7d3e5a-92c4-4f6a-8d21-7c5e9b4a3f18
```

After logout, replaying the stored refresh token does not error — it is already revoked, so the
service no-ops — and the family is dead either way. Every subsequent API call with the old access
token keeps working until `exp`, at most 15 minutes: the accepted staleness cost described above.

### Common mistakes

- **Storing JWTs in `localStorage`.** The failure: any XSS — a compromised npm dependency, a bad
  Rich Text field — reads `localStorage` with one line of JavaScript and exfiltrates a token that
  authenticates as the user until expiry. The fix: keep the refresh token in an `HttpOnly` cookie
  (invisible to scripts), keep the access token in memory only (a module-scoped variable or state
  store), and let the 15-minute TTL cap the value of an access token an XSS *did* manage to read.
- **Rotating refresh tokens without reuse detection.** The failure: a stolen refresh token and the
  victim's own token coexist silently for the full 30 days; you have rotation's overhead with none
  of its security. The fix: family-based reuse detection as built above — a revoked token
  presented again revokes the whole family.
- **Long-lived access tokens** (the "just make it 30 days and skip the refresh endpoint" move).
  The failure: revocation becomes impossible without a per-request denylist, claims staleness
  lasts a month (role changes and deactivations do nothing), and the blast radius of one stolen
  token is a month of impersonation. The fix: 15-minute access tokens; renewal is the refresh
  token's job, and it already exists.
- **Not pinning allowed algorithms** — trusting the token's own `alg` header. The failure: the
  `alg: none` family and HS256/RS256 confusion attacks (historically exploited across many JWT
  libraries) let an attacker forge tokens by telling the verifier to skip or misuse signature
  checking. The fix: pass `algorithms: ['HS256']` to `jwtVerify` as above, keep the key material
  server-side, and never construct the verification key from anything client-supplied. Note jose
  also refuses key-type/algorithm mismatches; the explicit pin is defense in depth so a future
  key-type change cannot silently widen what is accepted.
- **Committing the signing secret.** The failure: anyone with repository access, a CI log, or a
  forked copy of the repo can mint tokens for any user, any role — no password needed, no trace in
  your auth logs. The fix: `JWT_SECRET` comes from the environment (section 1's `env.ts`), stored
  in a secret manager, at least 32 bytes (`openssl rand -base64 48`). For rotation without
  downtime, sign with the new secret while still accepting the old one for a bounded overlap
  window.
- **Ignoring clock skew.** The failure: pods with drifting clocks reject tokens as "expired" or
  "issued in the future" within seconds of issuance — intermittent 401s that load-test fine and
  fail in production. The fix: `clockTolerance: 5` seconds in verification (as above) plus NTP in
  the cluster. Five seconds of tolerance does not meaningfully extend any attacker's window.
- **`SameSite=Strict` breaking cross-site clients.** The failure: the API at
  `api.supplementdirect.example` and the SPA at `app.northclinic.example` are different sites, so
  the browser refuses to send the strict cookie on the SPA's requests — auth works in curl and
  Postman and dies in production. The fix: serve the app and API from the same registrable domain
  so Strict works, or consciously drop to `SameSite=Lax` and add compensating controls for the
  cookie-consuming endpoints (they are POST-only already; verify `Origin` on refresh/logout). Make
  that choice explicitly — Lax without the compensating controls reopens CSRF on the only
  cookie-authenticated endpoints you have.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 401 "Invalid or expired access token" immediately after login, but only on some replicas | Different `JWT_SECRET` per replica — one instance signs, another verifies | Source the secret from one place (secret manager); add a startup self-check that signs and verifies a canary token |
| 401 "Missing refresh token cookie" even though login set it | Client fetch omits `credentials: 'include'`, or the cookie's `Path=/v1/auth` does not match where the API is actually mounted | Send cookies explicitly; keep the API mounted at `/v1` on the same origin as the pinned `Path` |
| Every refresh reports "reuse detected" for one specific user | The client fires two concurrent refreshes (retry after a timeout, or a two-tab race); the loser presents a just-revoked token and trips its own tripwire | Serialize refresh client-side (a single in-flight promise per app); do not weaken the server-side check — the pattern above is the fix |
| "Refresh token expired" even though the cookie is well within 30 days | Server clock skew, or `REFRESH_TOKEN_TTL_DAYS` changed between issuance and use | Sync clocks (NTP); compare the stored `expiresAt` with server time before assuming the cookie is at fault |
| Browser never stores the `Set-Cookie` in local development | `Secure: true` over plain HTTP — the browser drops the cookie | Terminate TLS locally (mkcert or Caddy in front of the dev server); do not disable the flag for dev |
| Login returns 401 for a real user typing the correct password | Email stored with different casing than queried, or the row was written by a legacy hasher | Normalize the email on every write and every read (the service lowercases both paths); rehash passwords on next successful login if a legacy hash format is found |
