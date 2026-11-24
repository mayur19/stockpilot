# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-25

### Added

- Monorepo with `packages/shared`, `apps/api` (Fastify 5) and `apps/web` (React 18 + Vite).
- Zod-validated configuration, structured logging, response envelope, request IDs, health
  and readiness endpoints, checksum-verified SQL migrations, `run.sh` launcher, CI on native
  PostgreSQL.
- Session authentication with scrypt, CSRF double-submit, RBAC permissions, audit events,
  per-email progressive login backoff, per-IP spraying and registration limits, configurable
  `TRUST_PROXY`, non-enumerating registration.
- Warehouse topology (warehouses, zones, bins) with bin-code validation and serpentine pick
  sequence; SKUs with nested UoM ladders; lots with expiry.
- Event-sourced inventory ledger (receipts, moves, adjustments) with a synchronous on-hand
  projection and replay verification; append-only enforcement in the database.
- FEFO/FIFO/LIFO allocation engine with shelf-life rules, pick minimisation, ship-complete,
  concurrency-safe persistence with ordered row locks, and release.
- Web screens: login, navigation with planned sections, stock on hand by bin with receive and
  move forms, allocations.
- Full documentation set, OpenAPI specification with `x-status`, and 501 stubs for every
  planned endpoint.
