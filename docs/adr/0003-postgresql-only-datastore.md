# ADR-0003: PostgreSQL as the only datastore, no external services

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-004, SP-173

## Context and problem statement

A WMS typically accumulates Redis for sessions and rate limits, a message broker for events, an email provider, carrier APIs and object storage for labels. Each one adds a failure mode, a consistency boundary and an operational burden. The product brief also forbids any runtime call to third-party services. Where should state, queues and side effects live?

## Decision drivers

- Stock changes, allocation rows, audit entries and (later) outbound notifications must commit or roll back together.
- Zero third-party runtime dependencies; the system must run fully offline on one host.
- Operators should back up one thing (`pg_dump`) to recover everything.

## Considered options

1. PostgreSQL for everything: relational data, ledger, sessions, audit, and later the outbox, notifications and throttle counters.
2. PostgreSQL + Redis (sessions, rate limits, locks) + a broker (RabbitMQ/Kafka) for events.
3. PostgreSQL + hosted services (email API, carrier APIs, object storage).

## Decision outcome

Chosen option: **1**. Sessions are a table (`sessions`), audit is a table (`audit_events`), row locks replace distributed locks (ADR-0011), and planned side effects use a transactional outbox table (`outbox_messages`, SP-173) consumed in-process. Email is never sent: verification and reset messages are written to the outbox and shown in-app or in a development mailbox page (SP-009, SP-017). Carrier rates are local tables (SP-121); barcodes are rendered in-house as SVG (SP-160).

### Consequences

- Good: one transaction boundary; one backup; one thing to monitor.
- Good: tests run against a real database with no mocks for infrastructure.
- Bad: PostgreSQL becomes the throughput ceiling; mitigated by short transactions, a projection table for reads and ledger partitioning (SP-186).
- Bad: the in-memory auth throttles are the one piece of state outside PostgreSQL today; they must move into it (SP-183, SP-190) before horizontal scaling.
- Neutral: polling an outbox table is less immediate than a broker push; acceptable for notifications.
