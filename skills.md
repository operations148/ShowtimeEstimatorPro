# Skills Matrix — Sub-Agent Delegation Model

## Overview

Work on this platform is delegated across six specialized sub-agents. Each agent owns a vertical slice of the system and has clearly defined responsibilities, inputs, outputs, and acceptance criteria. Agents collaborate through shared interfaces defined in `packages/shared/`.

## Agent Roster

| Agent | File | Primary Domain |
|---|---|---|
| Frontend Agent | `agents/frontend-agent.md` | Dashboard UI, widget UI, React components, styling |
| Backend Agent | `agents/backend-agent.md` | API routes, services, DB models, business logic |
| Infra/DevOps Agent | `agents/infra-devops-agent.md` | CI/CD, Docker, deployment, monitoring, env config |
| QA Agent | `agents/qa-agent.md` | Test strategy, test authoring, coverage, regression |
| Security & Privacy Agent | `agents/security-privacy-agent.md` | Auth hardening, tenant isolation, CORS, audit, GDPR |
| Product/UX Agent | `agents/product-ux-agent.md` | Wireframes, user flows, copy, feature specs, analytics design |

## Delegation Rules

1. **Single ownership**: Every file, module, or feature has exactly one owning agent. Shared packages are co-owned by Backend + Frontend with Backend as tiebreaker.
2. **Interface contracts**: When Agent A needs something from Agent B, they define a TypeScript interface in `packages/shared/` and open a task for Agent B to implement it.
3. **Review crossover**: Security Agent reviews all auth and data-access PRs. QA Agent reviews all test-related PRs. Product/UX Agent reviews all user-facing PRs.
4. **Escalation**: Ambiguous ownership → Product/UX Agent decides scope; Backend Agent decides technical approach.

## Work Handoff Protocol

```
1. Product/UX Agent writes feature spec (inputs: user story → outputs: spec doc)
2. Backend Agent designs API contract (inputs: spec → outputs: OpenAPI additions)
3. Frontend Agent builds UI (inputs: API contract + wireframes → outputs: components)
4. Security Agent reviews (inputs: PR → outputs: approval or required changes)
5. QA Agent writes tests (inputs: spec + implementation → outputs: test suite)
6. Infra Agent deploys (inputs: merged main → outputs: staged then production)
```

## Skill Dependencies

```
                  ┌─────────────────┐
                  │ Product/UX Agent│
                  └────────┬────────┘
                           │ specs & wireframes
              ┌────────────┼────────────┐
              ▼            ▼            ▼
     ┌────────────┐ ┌─────────────┐ ┌──────────────┐
     │  Frontend  │ │   Backend   │ │   Security   │
     │   Agent    │ │   Agent     │ │   Agent      │
     └─────┬──────┘ └──────┬──────┘ └──────┬───────┘
           │               │               │
           └───────┬───────┘               │
                   ▼                       ▼
            ┌─────────────┐         ┌─────────────┐
            │  QA Agent   │         │ Audit/Review │
            └──────┬──────┘         └─────────────┘
                   │
                   ▼
          ┌────────────────┐
          │ Infra/DevOps   │
          │    Agent       │
          └────────────────┘
```
