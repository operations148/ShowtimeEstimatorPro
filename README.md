# EstimatorPro

A multi-tenant SaaS platform for building embeddable **price-estimation widgets**, capturing leads, and viewing analytics. Businesses create an interactive estimator, drop it onto any website via a `<script>` tag, and route every lead into their CRM.

- **Interactive two-column estimator** with image options, per-tenant branding (logo, color, font), and an instant price reveal
- **Lead capture** — Name, Phone, and Email required; Zip optional (used for service-area gating)
- **CRM integrations** — GoHighLevel webhook, Google Sheets webhook, and native Google Sheets (OAuth)
- **Dashboard** — estimator builder, submissions, analytics & drop-off, CSV export, team & billing
- Built-in spam protection, instant email-per-lead, and GDPR data export/erasure

## Stack

pnpm + Turborepo monorepo. **API**: Hono + Drizzle ORM (SQLite in dev, Postgres in prod). **Dashboard**: Next.js 14. **Widget**: Vite + React (self-contained IIFE bundle).

```
apps/       api/  dashboard-web/  widget/
packages/   shared/  pricing-engine/  provider-adapters/
```

## Quick start (local)

Requires **Node ≥ 20** and **pnpm ≥ 9** (`corepack enable` provides pnpm). No Docker needed — the dev database is SQLite.

```bash
# 1. Install
pnpm install

# 2. Env files (copy the examples, then edit apps/api/.env for real provider keys)
cp apps/api/.env.example           apps/api/.env
cp apps/dashboard-web/.env.example apps/dashboard-web/.env
cp apps/widget/.env.example        apps/widget/.env

# 3. Create + migrate + seed the SQLite database (demo tenant, estimator, pricing, service area)
pnpm --filter api db:reset

# 4. Run everything
pnpm dev
```

- Dashboard → http://localhost:3000  (demo login: `owner@demo.test`; OTP code prints to the API console with `EMAIL_PROVIDER=mock`)
- API → http://localhost:4000
- Widget dev / marketing home (with a live demo estimator embedded) → http://localhost:5173

Reset to a clean slate anytime with `pnpm --filter api db:reset`.

## Embedding the widget

```html
<div id="estimator-widget"
     data-key="YOUR_PUBLIC_KEY"
     data-api-url="https://your-api-host/api/v1"></div>
<script src="https://your-cdn/widget.iife.js"></script>
```

The public key comes from a **published** estimator (see the estimator's Embed button in the dashboard).

## Google Sheets integration (optional)

To enable Google sign-in and the native Google Sheets lead integration, set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `apps/api/.env`. In Google Cloud → APIs & Services:

1. Create an OAuth 2.0 Client ID (Web application).
2. Add authorized redirect URIs:
   - `http://localhost:4000/api/v1/auth/google/callback`
   - `http://localhost:4000/api/v1/integrations/google-sheets/callback`
3. Enable the **Google Sheets API** and add the `.../auth/spreadsheets` scope on the consent screen.

The GHL and Google-Sheets-webhook integrations need no external setup — just paste a webhook URL in **Settings → Integrations**.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Run api + dashboard + widget in watch mode |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Validate all workspaces |
| `pnpm --filter api db:reset` | Delete, re-migrate, and re-seed the dev database |
| `pnpm --filter api db:generate` | Generate a Drizzle migration from schema changes |
| `pnpm --filter widget build` | Build the embeddable `widget.iife.js` bundle |

## Configuration

Every environment variable is documented in each app's `.env.example`. Providers for email, SMS, and payments are pluggable (`mock` by default) and selected via env vars. See [CLAUDE.md](CLAUDE.md) for full architecture, privacy model, and coding standards.
