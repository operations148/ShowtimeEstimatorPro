# Estimator Platform — Clean-Room Multi-Tenant SaaS

## How to Run Locally

> **No Docker required.** The local dev database is SQLite — the file is
> created automatically at `apps/api/dev.db` on first migrate.

```powershell
# 1. Install dependencies (Node >= 20, pnpm >= 9 required)
pnpm install

# 2. Copy env files
Copy-Item apps\api\.env.example      apps\api\.env
Copy-Item apps\dashboard-web\.env.example  apps\dashboard-web\.env
Copy-Item apps\widget\.env.example   apps\widget\.env

# 3. Create the database, run migrations, and seed demo data
pnpm --filter api db:migrate   # creates apps/api/dev.db and applies all migrations
pnpm --filter api db:seed      # inserts demo tenant, estimator, service area, etc.

# 4. Start all apps in dev mode
pnpm dev
```

Dashboard: http://localhost:3000
API: http://localhost:4000
Widget dev server: http://localhost:5173

### Reset to a clean slate

```powershell
pnpm --filter api db:reset   # deletes dev.db, re-migrates, re-seeds
```

### Import sample data into an existing tenant

```powershell
# From workspace root — set env vars inline
$env:TENANT_ID="<uuid>"; $env:ESTIMATOR_ID="<uuid>"; tsx scripts\import-estimator.ts
$env:TENANT_ID="<uuid>"; tsx scripts\import-service-area.ts
```

---

## 1. Project Overview

This is a **multi-tenant estimator + dashboard SaaS platform** enabling businesses to create embeddable price-estimation widgets, capture leads, and view analytics. It is built clean-room — no proprietary code, UI, or logic from any third-party product was copied or reverse-engineered.

### Core capabilities
- **Multi-tenant RBAC** — tenant-scoped orgs with owner/admin/member roles
- **OTP authentication** — email + SMS with pluggable vendor adapters (mock, Resend, Twilio)
- **Estimator builder** — CRUD questions, draft/published versioning, branding
- **Embeddable widget** — script-tag drop-in for any website; step-flow UI
- **JSON-driven pricing engine** — base prices, add-on deltas, min/max range logic
- **Service-area gating** — zip-code CSV validation
- **Analytics dashboard** — revenue, submissions, drop-off, time-series charts
- **CSV + JSON export** — leads + answers (GDPR data portability)
- **GDPR Art. 17 bulk erasure** — `DELETE /api/v1/tenants/me/data` with confirmation
- **Subscription billing** — single-plan enforcement with webhook status sync
- **Structured logging** — pino JSON logs with per-request `requestId`, sensitive field redaction
- **CSRF protection** — double-submit cookie pattern on all dashboard state-mutating routes
- **Content Security Policy** — `default-src 'none'; frame-ancestors 'none'` on all responses
- **Input sanitization** — HTML stripping on all user-provided text fields
- **Rate limiting** — per-IP on OTP, submissions, and analytics event ingestion
- **Startup validation** — DB probe + provider adapter health check before first request

---

## 2. Architecture

### Stack justification

| Layer | Choice | Why |
|---|---|---|
| **Frontend** | **Next.js 14 (App Router) + TypeScript** | Full-stack React framework; SSR for dashboard SEO; API routes as lightweight BFF; excellent DX with Turbopack; Vercel-native deployment. |
| **Widget** | **Vite + React + TypeScript** | Produces a slim, tree-shaken IIFE bundle ideal for embedding via `<script>` tag. Separate from Next to avoid framework overhead in the embed. |
| **API** | **Hono on Node.js + TypeScript** | Ultra-lightweight, edge-compatible HTTP framework; middleware-centric; runs on Node, Bun, or Cloudflare Workers. |
| **Database** | **SQLite (local dev) / PostgreSQL (production)** | SQLite via `better-sqlite3` for zero-install local dev; swap to Postgres by changing `DATABASE_URL` to a connection string and updating `drizzle.config.ts` dialect. |
| **ORM** | **Drizzle ORM** | Type-safe, SQL-close, lightweight; first-class Postgres support; generates migrations. |
| **Auth** | **Custom OTP** | No dependency on opinionated auth providers; httpOnly cookie sessions; tenant-scoped. |
| **Billing** | **Stripe adapter** (replaceable) | Industry standard for subscriptions; webhook-driven status sync. |
| **Monorepo** | **pnpm workspaces + Turborepo** | Fast builds, shared packages, parallel task execution. |

### Monorepo structure

```
estimator-platform/
├── apps/
│   ├── api/             # Hono API server
│   ├── dashboard-web/   # Next.js tenant dashboard + builder
│   └── widget/          # Vite-built embeddable widget
├── packages/
│   ├── shared/          # Types, Zod schemas, constants
│   ├── pricing-engine/  # Standalone pricing computation (pure logic)
│   └── provider-adapters/  # Email, SMS, payment interfaces + mocks
├── agents/              # Sub-agent role definitions
├── attachments/         # Sample seed files (provided by stakeholders)
├── scripts/             # Import & seed scripts
└── docs, configs, etc.
```

### Data flow

```
[End-user browser]
      │
      ▼
[Widget bundle (CDN)] ──GET /api/v1/widget/:publicKey──▶ [API]
      │                                                     │
      ├─POST /api/v1/submissions────────────────────────────┤
      │                                                     │
      ▼                                                     ▼
[Lead captured]                                     [SQLite/Postgres DB]
                                                           │
                                    [Dashboard (Next.js)] ◄┘
```

---

## 3. Coding Standards

- **Language**: TypeScript strict mode everywhere (`strict: true`, `noUncheckedIndexedAccess: true`).
- **Formatting**: Prettier (printWidth: 100, singleQuote: true, trailingComma: 'all').
- **Linting**: ESLint with `@typescript-eslint/recommended` + `import/order`.
- **Naming**:
  - Files: `kebab-case.ts` (modules), `PascalCase.tsx` (React components).
  - Variables/functions: `camelCase`. Types/interfaces: `PascalCase`. Constants: `UPPER_SNAKE`.
  - DB columns: `snake_case`.
- **Imports**: Use `@repo/shared`, `@repo/pricing-engine`, `@repo/provider-adapters` workspace aliases.
- **Error handling**: Return `Result<T, E>` types from services; never throw from business logic. HTTP layer translates to status codes.
- **API responses**: Envelope `{ data, error, meta }`.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`).
- **PRs**: Require 1 approval; must pass CI (lint + typecheck + test).

---

## 4. CI/CD Pipeline

```yaml
# .github/workflows/ci.yml (conceptual)
jobs:
  validate:
    - pnpm install --frozen-lockfile
    - pnpm lint
    - pnpm typecheck
    - pnpm test
  deploy-api:
    - Build Docker image or deploy to Vercel/Railway
    - Run migrations: pnpm --filter api db:migrate
  deploy-dashboard:
    - pnpm --filter dashboard-web build
    - Deploy to Vercel
  deploy-widget:
    - pnpm --filter widget build
    - Upload dist/widget.iife.js to CDN
```

### Environment variable validation

Each app validates env vars at startup using Zod schemas (see `apps/*/src/env.ts`). Missing or malformed vars cause a hard startup failure with descriptive messages.

---

## 5. Testing Plan

| Layer | Tool | Scope |
|---|---|---|
| **Unit** | Vitest | pricing-engine rules, OTP generation/validation, schema parsing |
| **Integration** | Vitest + Supertest | API submission flow, auth flow, billing webhook handler |
| **UI** | Playwright | Dashboard login → create estimator → preview widget flow |
| **E2E** | Playwright | Widget embed → fill steps → capture lead → verify in dashboard |

### Test commands

```bash
pnpm test              # all workspaces
pnpm test:unit         # unit only
pnpm test:integration  # integration only
pnpm test:e2e          # Playwright
pnpm test:coverage     # coverage report
```

---

## 6. Environment Variables

See `.env.example` in each app for full documentation. Key variables:

### apps/api
| Var | Description |
|---|---|
| `DATABASE_URL` | SQLite file path (local dev, e.g. `./dev.db`) or Postgres URL (production) |
| `SESSION_SECRET` | 32+ char secret for signing httpOnly JWT cookies |
| `OTP_EXPIRY_MINUTES` | OTP code lifetime (default: 10) |
| `OTP_MAX_ATTEMPTS` | Max verification attempts before lockout (default: 5) |
| `EMAIL_PROVIDER` | `mock` / `resend` / `sendgrid` / `postmark` / `ses` |
| `RESEND_API_KEY` | Required when `EMAIL_PROVIDER=resend` |
| `RESEND_FROM` | Sender address for Resend (default: `onboarding@resend.dev`) |
| `SMS_PROVIDER` | `mock` / `twilio` / `vonage` |
| `TWILIO_ACCOUNT_SID` | Required when `SMS_PROVIDER=twilio` |
| `TWILIO_AUTH_TOKEN` | Required when `SMS_PROVIDER=twilio` |
| `TWILIO_FROM` | Sender number, required when `SMS_PROVIDER=twilio` |
| `PAYMENT_PROVIDER` | `mock` / `stripe` |
| `STRIPE_SECRET_KEY` | Required when `PAYMENT_PROVIDER=stripe` |
| `STRIPE_WEBHOOK_SECRET` | Required when `PAYMENT_PROVIDER=stripe` |
| `CORS_WIDGET_ORIGINS` | Comma-separated allowed widget embed origins |
| `CORS_DASHBOARD_ORIGIN` | Dashboard origin for CORS + CSRF cookies |
| `PORT` | HTTP listen port (default: 4000) |
| `LOG_LEVEL` | pino log level: `trace` / `debug` / `info` / `warn` / `error` / `fatal` |
| `CRON_SECRET` | Bearer token to protect `/api/v1/cron/*` endpoints (optional in dev) |

### apps/dashboard-web
| Var | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | API base URL |

### apps/widget
| Var | Description |
|---|---|
| `VITE_API_URL` | API base URL for widget requests |

---

## 7. Local Development

### Prerequisites
- Node.js >= 20
- pnpm >= 9
- No Docker required — database is SQLite for local development

### docker-compose.yml

Kept at repo root for **production / staging** use only (Postgres 16 + Redis 7).
Not needed for local development.

### Seed data

`scripts/seed.ts` creates:
1. A demo tenant (`demo-pools`, slug: `demo-pools`)
2. An owner user (`owner@demo.test`)
3. Sample estimator imported from `attachments/estimator-questions.sample.json`
4. Service-area zips imported from `attachments/service-area.sample.csv`
5. Sample pricing config from `attachments/pricing-config.sample.json`

### Mock providers

When `EMAIL_PROVIDER=mock`, `SMS_PROVIDER=mock`, `PAYMENT_PROVIDER=mock`:
- OTP codes are printed to stdout (`[MockEmail] Body: Your one-time code is: 123456`)
- Payment subscription state is simulated via `POST /api/v1/dev/simulate-webhook`
  ```json
  { "tenantId": "<uuid>", "status": "active" }
  ```
  Status options: `active` | `trialing` | `past_due` | `canceled` | `unpaid`

### CSRF flow for dashboard clients

All state-mutating dashboard requests require a CSRF token:
1. `GET /api/v1/auth/csrf-token` → receive token in response body + non-httpOnly cookie
2. Include `X-CSRF-Token: <token>` header on all POST / PUT / PATCH / DELETE requests

**Bypassed endpoints** (no CSRF needed): `POST /tenants/signup`, `POST /auth/otp/request`,
`POST /auth/otp/verify`, `POST /submissions`, `POST /analytics/events`, `POST /billing/webhook`,
and all `/dev/*` routes.

### API response envelope

All responses use `{ data, error, meta? }`. On error: `data` is `null`; `error` has `code` + `message`.

---

## 8. Privacy & Data Controller/Processor Model

### Controller/Processor relationship

- **Platform operator** (us): Data **Processor**. We process personal data on behalf of tenants.
- **Tenant** (org using the platform): Data **Controller**. They determine the purposes and means of processing end-user data (leads captured via estimator widgets).
- **End-user** (widget visitor): Data **Subject**.

### Data minimization

- Lead capture collects only: email (required), zip (required), name (optional), phone (optional).
- No tracking cookies on the widget; analytics events are first-party and server-side.
- Answers to estimator questions are stored as JSONB, scoped to the submission.

### Retention & deletion

- Tenants configure a retention period (default: indefinite until manual delete).
- `DELETE /api/v1/submissions/:id` hard-deletes a single submission and its answers.
- `DELETE /api/v1/tenants/me/data` bulk-deletes all tenant data (GDPR Art. 17). Requires owner role + body `{ "confirm": "DELETE_ALL_DATA" }`. Deletes in dependency order; audit entry is written BEFORE deletion.
- `RetentionService.purgeExpired(tenantId, retentionDays)` prunes submissions older than the configured cutoff.
- Deletion is logged in the audit log for compliance.

### Audit log

All admin actions (user CRUD, estimator publish, data export, data deletion) are logged with: `actor_id`, `action`, `resource_type`, `resource_id`, `timestamp`, `ip_address`.
