# ADR-0005: JSON response envelope and error codes

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-003

## Context and problem statement

Clients (the SPA today, scanners and integrations later) need to distinguish success from failure, show a meaningful message, and branch on specific failures such as "not enough stock" versus "constraint violated" versus "retry". Errors come from four places: validation, pure domain logic, PostgreSQL constraints and the framework. How should responses be shaped?

## Decision drivers

- One shape for every response, including 404 for unknown routes and 501 for pending ones.
- Stable machine-readable codes independent of message wording.
- No leakage of stack traces or SQL in responses.
- Pending endpoints must be discoverable and point at the ticket that will deliver them.

## Considered options

1. Envelope `{ data, error: { code, message, details? } | null, meta? }` with a central error handler.
2. RFC 9457 problem details for errors and bare JSON for success.
3. Bare JSON with HTTP status only.

## Decision outcome

Chosen option: **1**. `ok(data, meta?)` builds success responses; `registerErrorHandling` converts anything thrown into the envelope:

| Source        | Mapping                                                                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppError`    | its own status and code (`VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `CSRF_INVALID`, `NOT_FOUND`, `INVALID_CREDENTIALS`, `RATE_LIMITED`, `INSUFFICIENT_STOCK`, `ALREADY_RELEASED`, `LOT_EXPIRY_MISMATCH`, `BIN_INACTIVE` …)         |
| `DomainError` | 400 for shape errors (`INVALID_QUANTITY`, `INVALID_UOM`, `NON_INTEGRAL_CONVERSION`, `INVALID_UOM_LADDER`, `INVALID_BIN_CODE`, `INVALID_DATE`, `INVALID_MOVEMENT`); 409 for stock errors (`INSUFFICIENT_AVAILABLE`, `INSUFFICIENT_ALLOCATED`) |
| PostgreSQL    | 23505 -> 409 `ALREADY_EXISTS`; 23514 -> 409 `CONSTRAINT_VIOLATION`; 23503 -> 400 `VALIDATION_FAILED`; 40P01/40001 -> 503 `CONCURRENCY_RETRY`                                                                                                 |
| Fastify       | invalid media type -> 415 `UNSUPPORTED_MEDIA_TYPE`; other 4xx -> `BAD_REQUEST`                                                                                                                                                               |
| anything else | 500 `INTERNAL_ERROR` with a generic message; full error logged server-side                                                                                                                                                                   |

`429` responses also set `Retry-After` from `details.retryAfterSeconds`. Pending endpoints return `501 { code: "NOT_IMPLEMENTED", details: { ticket: "SP-###" } }`. List endpoints put pagination in `meta` (`limit`, `nextCursor`, `count`).

### Consequences

- Good: the SPA client unwraps one shape (`apiRequest` in `apps/web/src/api/client.ts`).
- Good: the database CHECK constraints surface as a clean 409 instead of a 500 if pure-code checks are ever bypassed.
- Bad: one extra nesting level in every payload.
- Neutral: `CONCURRENCY_RETRY` is a 503 so generic HTTP clients retry it; it is idempotency-safe only once idempotency keys land (see system design §7).
