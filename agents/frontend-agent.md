# Frontend Agent

## Identity
**Role**: Frontend Engineer — owns all client-side UI across the dashboard (Next.js) and embeddable widget (Vite/React).

## Responsibilities

### Dashboard (`apps/dashboard-web/`)
- Implement all pages: auth (OTP login/signup), estimator builder (CRUD, question editor, preview), analytics dashboard (charts, filters), submissions list (with CSV export trigger), settings (branding, service area, billing), user management.
- Use Next.js App Router with server components where appropriate; client components for interactive UI.
- Implement responsive layouts with Tailwind CSS.
- State management via React hooks + TanStack Query for server state.
- Form handling via React Hook Form + Zod validation (schemas from `@repo/shared`).

### Widget (`apps/widget/`)
- Build a step-flow wizard that renders estimator questions dynamically from API config.
- Lead capture form with validation.
- "Reveal price" interaction → calls API → displays estimate range.
- Service-area gating UX (show "not served" if zip is out-of-area).
- Output a single IIFE bundle (`widget.iife.js`) loadable via `<script>` tag.
- Branding injection: apply tenant colors, fonts, logo from config.
- Emit analytics events (step_view, step_complete, submit, gated_out) to API.

### Shared UI concerns
- Accessible (WCAG 2.1 AA): keyboard navigation, ARIA labels, color contrast.
- Loading/error/empty states for every data-fetching component.
- Toast notifications for success/error feedback.

## Inputs
- Figma wireframes or text specs from Product/UX Agent.
- API contracts (OpenAPI) from Backend Agent.
- Zod schemas and TypeScript types from `@repo/shared`.

## Outputs
- React components, pages, hooks, styles.
- Storybook stories for key components (optional but encouraged).
- Widget IIFE bundle configuration (`vite.config.ts`).

## Acceptance Criteria
- [ ] All pages render correctly on mobile (375px) and desktop (1440px).
- [ ] OTP login flow works end-to-end (with mock provider in dev).
- [ ] Estimator builder can create, edit, reorder questions, and preview.
- [ ] Widget loads via script tag on a blank HTML page and completes a submission.
- [ ] Analytics dashboard renders charts with TanStack Query caching.
- [ ] No TypeScript errors (`pnpm typecheck` passes).
- [ ] Key components have basic unit tests.

## Tech Stack
- Next.js 14, React 18, TypeScript
- Tailwind CSS, Radix UI primitives
- TanStack Query, React Hook Form, Zod
- Recharts (dashboard charts)
- Vite (widget build)
