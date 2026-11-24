# ADR-0004: Zod-validated configuration and boundary validation

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-002, SP-003

## Context and problem statement

Misconfiguration (a short session secret, `TRUST_PROXY=true`, a pool size of 0) and malformed input (fractional quantities, unknown UoM codes, bad dates) are the most common sources of production incidents and security holes. TypeScript types disappear at runtime. How do we guarantee that everything entering the process has the shape the code assumes?

## Decision drivers

- Fail fast at startup with a readable message rather than misbehave later.
- One schema definition reused for runtime parsing and static types.
- Same schemas usable by the web client for form validation.
- Security-relevant config must reject unsafe values, not just type-check them.

## Considered options

1. zod schemas for env (`apps/api/src/config/env.ts`) and for every request body, query and params (`packages/shared/src/schemas`), parsed via a single `parse()` helper.
2. Fastify JSON Schema validation with `@sinclair/typebox`.
3. Hand-written guards per route.
4. `dotenv` + `envalid` for config only.

## Decision outcome

Chosen option: **1**. `loadEnv` parses `process.env` once; invalid config throws `Invalid configuration: <path>: <message>` and the process exits. Notable rules: `SESSION_SECRET` >= 32 characters and not the placeholder in production; `TRUST_PROXY` accepts only `false`, a hop count, or a list of IPs/CIDRs and **rejects `true`**, and must be set explicitly when `NODE_ENV=production`; numeric bounds on pool size, TTLs and throttle limits. Routes call `parse(schema, request.body | query | params)` which raises `400 VALIDATION_FAILED` with `details: [{ path, message }]`. Domain invariants that need context (lot tracking rules, UoM ladder nesting, IANA time zone canonicalisation) are checked after parsing and raise `DomainError` or `AppError`.

### Consequences

- Good: impossible to boot with an unsafe proxy trust setting or a weak secret.
- Good: the web forms and the API share `receiptSchema`, `moveSchema`, `allocationSchema`.
- Good: inputs are normalised at the edge (emails lower-cased, codes upper-cased, time zones canonical) so equality and caching behave.
- Bad: zod schemas are not emitted into the OpenAPI document automatically; `docs/api/openapi.yaml` is maintained by hand.
- Bad: Fastify's built-in schema-based serialisation speed-up is not used.
