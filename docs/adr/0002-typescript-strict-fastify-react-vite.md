# ADR-0002: TypeScript strict, Fastify 5 and React with Vite

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-001, SP-060

## Context and problem statement

We need a language and frameworks for the API and the web client that make quantity and state errors hard to write, run on Node.js 22 without a transpile-heavy toolchain, and keep the dependency list short.

## Decision drivers

- One language end to end so domain types are shared, not re-declared.
- Exhaustiveness checking for discriminated unions (movement types, zone types, allocation statuses).
- A fast HTTP framework with first-class hooks (`preHandler`, `onSend`), request IDs and pino logging.
- A web stack with a fast dev server and a static build that nginx can serve.

## Considered options

1. TypeScript `strict` (plus `noUncheckedIndexedAccess`) + Fastify 5 + React 18 / Vite / React Router.
2. TypeScript + Express 5 + Next.js.
3. TypeScript + NestJS + Angular.
4. Plain JavaScript with JSDoc types.

## Decision outcome

Chosen option: **1**. Fastify gives hooks for the auth preHandler and security headers, a structured logger with redaction, `genReqId`, a body size limit and a typed route config (`config.permission`) that we use for RBAC. Vite produces a static bundle with no server runtime, which fits the nginx deployment. React Router covers navigation; no UI kit is needed because plain CSS with design tokens is enough.

### Consequences

- Good: `never` checks in `effectsOf` make adding a movement type a compile error until every switch handles it.
- Good: Fastify's `routeOptions.config` lets each route declare its permission next to its path.
- Good: the web build is static files; no Node process serves the UI in production.
- Bad: no server-side rendering; first paint waits for the bundle (acceptable for an authenticated operations tool).
- Bad: strict index access forces explicit `as` assertions after lookups in a few repository helpers.
