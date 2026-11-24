# Backlog

Every ticket for StockPilot. Estimates are engineering hours including tests and docs. Totals: **1560 h**, of which **166 h done** (10.6%). Ticket IDs are referenced by 501 responses (`details.ticket`), the traceability matrix and GitHub issues.

## Epics

| Epic | Name                    |
| ---- | ----------------------- |
| E01  | Platform foundation     |
| E02  | Identity & access       |
| E03  | Warehouse topology      |
| E04  | Catalogue & UoM         |
| E05  | Inventory ledger        |
| E06  | Allocation              |
| E07  | Inbound & receiving     |
| E08  | Putaway & slotting      |
| E09  | Outbound orders & waves |
| E10  | Picking & pick paths    |
| E11  | Packing & cartonization |
| E12  | Shipping                |
| E13  | Cycle counting          |
| E14  | Replenishment           |
| E15  | Returns                 |
| E16  | Labels & handling units |
| E17  | Reporting & billing     |
| E18  | Operations & hardening  |

## M0

| ID     | Title                                                                                      | Epic | Milestone | Estimate (h) | Status | Dependencies |
| ------ | ------------------------------------------------------------------------------------------ | ---- | --------- | -----------: | ------ | ------------ |
| SP-001 | Monorepo tooling: workspaces, strict TS, ESLint, Prettier                                  | E01  | M0        |            6 | done   | —            |
| SP-002 | Zod-validated config loader and structured logging                                         | E01  | M0        |            4 | done   | SP-001       |
| SP-003 | Error envelope, request IDs, health/readiness endpoints                                    | E01  | M0        |            5 | done   | SP-002       |
| SP-004 | Forward-only SQL migration runner with checksums                                           | E01  | M0        |            6 | done   | SP-002       |
| SP-005 | CI pipeline on native runner PostgreSQL                                                    | E01  | M0        |            4 | done   | SP-004       |
| SP-006 | run.sh launcher (setup/migrate/seed/reset/test/dev)                                        | E01  | M0        |            4 | done   | SP-004       |
| SP-010 | Org owner registration, login, logout, me                                                  | E02  | M0        |           10 | done   | SP-004       |
| SP-011 | Postgres-backed sessions and CSRF double-submit                                            | E02  | M0        |            6 | done   | SP-010       |
| SP-012 | Auth throttling: per-email backoff, per-IP spraying guard, registration limit, TRUST_PROXY | E02  | M0        |            6 | done   | SP-010       |
| SP-013 | RBAC permission skeleton                                                                   | E02  | M0        |            5 | done   | SP-010       |
| SP-014 | Audit log write path                                                                       | E02  | M0        |            4 | done   | SP-004       |

## M1

| ID     | Title                                                                     | Epic | Milestone | Estimate (h) | Status | Dependencies  |
| ------ | ------------------------------------------------------------------------- | ---- | --------- | -----------: | ------ | ------------- |
| SP-020 | Warehouses, zones, bins with bin-code validation and pick sequence        | E03  | M1        |           10 | done   | SP-013        |
| SP-030 | SKUs with nested UoM ladders and exact conversion math                    | E04  | M1        |           10 | done   | SP-013        |
| SP-031 | Lot tracking with expiry and auto lots                                    | E04  | M1        |            4 | done   | SP-030        |
| SP-040 | Event-sourced movement ledger (receipt, move, adjust)                     | E05  | M1        |           16 | done   | SP-020,SP-031 |
| SP-041 | On-hand projection with replay verification                               | E05  | M1        |           10 | done   | SP-040        |
| SP-050 | FEFO/FIFO/LIFO allocation engine in shared domain                         | E06  | M1        |           14 | done   | SP-031        |
| SP-051 | Concurrency-safe allocation API with ordered row locks                    | E06  | M1        |           12 | done   | SP-041,SP-050 |
| SP-055 | Allocation release with compensating ledger entries                       | E06  | M1        |            8 | done   | SP-051        |
| SP-060 | Web shell: login, navigation with Planned badges                          | E01  | M1        |            8 | done   | SP-010        |
| SP-061 | Stock-on-hand by bin screen with receive/move forms and allocation screen | E05  | M1        |           10 | done   | SP-041,SP-060 |
| SP-062 | Realistic demo seed for the slice                                         | E01  | M1        |            4 | done   | SP-051        |

## M2

| ID     | Title                                                          | Epic | Milestone | Estimate (h) | Status  | Dependencies |
| ------ | -------------------------------------------------------------- | ---- | --------- | -----------: | ------- | ------------ |
| SP-009 | Email-verified signup via local outbox                         | E02  | M2        |           16 | pending | SP-173       |
| SP-015 | User invitations and management                                | E02  | M2        |           16 | pending | SP-013       |
| SP-017 | Password reset via local outbox                                | E02  | M2        |            8 | pending | SP-173       |
| SP-021 | Topology bulk import (CSV)                                     | E03  | M2        |           12 | pending | SP-020       |
| SP-022 | Bin capacity (weight/volume) enforcement on putaway and moves  | E03  | M2        |           12 | pending | SP-034       |
| SP-024 | Warehouse/zone/bin update and deactivation                     | E03  | M2        |           10 | pending | SP-020       |
| SP-033 | SKU catalogue import/export                                    | E04  | M2        |           10 | pending | SP-030       |
| SP-034 | Item attributes: dimensions, weight, hazmat, temperature class | E04  | M2        |           10 | pending | SP-030       |
| SP-035 | SKU update and UoM ladder versioning                           | E04  | M2        |           12 | pending | SP-030       |
| SP-042 | Inventory status and holds (quarantine, damaged, QA)           | E05  | M2        |           16 | pending | SP-041       |
| SP-070 | ASN creation and import                                        | E07  | M2        |           20 | pending | SP-030       |
| SP-071 | Receiving against ASN with discrepancy handling                | E07  | M2        |           28 | pending | SP-070       |
| SP-072 | Mobile-friendly receiving scanner flow                         | E07  | M2        |           24 | pending | SP-071       |
| SP-073 | Quality inspection and quarantine on receipt                   | E07  | M2        |           16 | pending | SP-042       |
| SP-080 | Directed putaway rules engine                                  | E08  | M2        |           32 | pending | SP-022       |
| SP-081 | Putaway task execution and confirmation                        | E08  | M2        |           16 | pending | SP-080       |
| SP-173 | Local outbox and in-app notifications                          | E17  | M2        |           16 | pending | SP-004       |

## M3

| ID     | Title                                                       | Epic | Milestone | Estimate (h) | Status  | Dependencies  |
| ------ | ----------------------------------------------------------- | ---- | --------- | -----------: | ------- | ------------- |
| SP-052 | Allocation rules per client/SKU class                       | E06  | M3        |           16 | pending | SP-018        |
| SP-053 | Pick-face versus reserve aware allocation (full-case rules) | E06  | M3        |           16 | pending | SP-051        |
| SP-054 | Backorders and allocation retry queue                       | E06  | M3        |           20 | pending | SP-090        |
| SP-090 | Outbound order intake (API and CSV)                         | E09  | M3        |           20 | pending | SP-030        |
| SP-091 | Order lifecycle state machine                               | E09  | M3        |           16 | pending | SP-090        |
| SP-092 | Wave planning by carrier cut-off and zone                   | E09  | M3        |           32 | pending | SP-091        |
| SP-093 | Wave release and task generation                            | E09  | M3        |           20 | pending | SP-092,SP-051 |

## M4

| ID     | Title                                                  | Epic | Milestone | Estimate (h) | Status  | Dependencies |
| ------ | ------------------------------------------------------ | ---- | --------- | -----------: | ------- | ------------ |
| SP-100 | Pick path optimisation (S-shape / largest-gap / 2-opt) | E10  | M4        |           40 | pending | SP-093       |
| SP-101 | Pick task execution and short-pick handling            | E10  | M4        |           24 | pending | SP-093       |
| SP-102 | Batch and cluster picking                              | E10  | M4        |           24 | pending | SP-100       |
| SP-103 | Picker mobile UI                                       | E10  | M4        |           28 | pending | SP-101       |

## M5

| ID     | Title                                             | Epic | Milestone | Estimate (h) | Status  | Dependencies |
| ------ | ------------------------------------------------- | ---- | --------- | -----------: | ------- | ------------ |
| SP-110 | Carton type catalogue                             | E11  | M5        |            8 | pending | SP-034       |
| SP-111 | 3D cartonization heuristic                        | E11  | M5        |           48 | pending | SP-110       |
| SP-112 | Pack station UI with scan verification            | E11  | M5        |           24 | pending | SP-111       |
| SP-120 | Shipments and manifest generation                 | E12  | M5        |           20 | pending | SP-112       |
| SP-121 | Local carrier rate tables                         | E12  | M5        |           16 | pending | SP-120       |
| SP-122 | Shipping documents (packing list, bill of lading) | E12  | M5        |           20 | pending | SP-120       |
| SP-123 | Ship confirmation and inventory decrement         | E12  | M5        |           12 | pending | SP-120       |

## M6

| ID     | Title                                               | Epic | Milestone | Estimate (h) | Status  | Dependencies  |
| ------ | --------------------------------------------------- | ---- | --------- | -----------: | ------- | ------------- |
| SP-043 | Point-in-time stock query by ledger replay          | E05  | M6        |           16 | pending | SP-044        |
| SP-044 | Ledger snapshots and projection compaction          | E05  | M6        |           20 | pending | SP-041        |
| SP-045 | Adjustment approval workflow with thresholds        | E05  | M6        |           12 | pending | SP-041        |
| SP-082 | Velocity-based (ABC) slotting recommendations       | E08  | M6        |           28 | pending | SP-171        |
| SP-130 | Cycle count planning (ABC frequency)                | E13  | M6        |           20 | pending | SP-171        |
| SP-131 | Blind count execution                               | E13  | M6        |           20 | pending | SP-130        |
| SP-132 | Variance approval and adjustment posting            | E13  | M6        |           16 | pending | SP-131,SP-045 |
| SP-140 | Min/max replenishment rules                         | E14  | M6        |           16 | pending | SP-053        |
| SP-141 | Replenishment task generation and execution         | E14  | M6        |           20 | pending | SP-140        |
| SP-142 | Demand-based replenishment                          | E14  | M6        |           24 | pending | SP-141        |
| SP-171 | Inventory reports: aging, expiry exposure, velocity | E17  | M6        |           20 | pending | SP-041        |
| SP-172 | Ledger CSV export                                   | E17  | M6        |            8 | pending | SP-041        |

## M7

| ID     | Title                                           | Epic | Milestone | Estimate (h) | Status  | Dependencies |
| ------ | ----------------------------------------------- | ---- | --------- | -----------: | ------- | ------------ |
| SP-016 | Custom role editor                              | E02  | M7        |           16 | pending | SP-015       |
| SP-018 | 3PL client accounts and client-scoped inventory | E02  | M7        |           24 | pending | SP-015       |
| SP-032 | Serial number tracking                          | E04  | M7        |           24 | pending | SP-040       |
| SP-150 | RMA authorisation                               | E15  | M7        |           16 | pending | SP-123       |
| SP-151 | Returns receiving and disposition               | E15  | M7        |           20 | pending | SP-150       |
| SP-160 | In-house Code128 barcode SVG encoder            | E16  | M7        |           16 | pending | —            |
| SP-161 | Label templates (bin, LPN, carton, shipping)    | E16  | M7        |           20 | pending | SP-160       |
| SP-162 | License plates (LPN) and nested containers      | E16  | M7        |           28 | pending | SP-040       |
| SP-174 | 3PL storage and handling billing                | E17  | M7        |           40 | pending | SP-018       |

## M8

| ID     | Title                                                                | Epic | Milestone | Estimate (h) | Status  | Dependencies |
| ------ | -------------------------------------------------------------------- | ---- | --------- | -----------: | ------- | ------------ |
| SP-019 | Audit log browser and export                                         | E02  | M8        |           12 | pending | SP-014       |
| SP-023 | Warehouse map visualisation (SVG)                                    | E03  | M8        |           20 | pending | SP-020       |
| SP-170 | Operations dashboard (throughput, backlog)                           | E17  | M8        |           24 | pending | SP-101       |
| SP-180 | Metrics endpoint and dashboards                                      | E18  | M8        |           12 | pending | SP-003       |
| SP-181 | Load testing allocation and ledger                                   | E18  | M8        |           16 | pending | SP-051       |
| SP-182 | Backup/restore drill automation                                      | E18  | M8        |            8 | pending | —            |
| SP-183 | Security hardening: Postgres-backed throttles, ASVS L2 review        | E18  | M8        |           24 | pending | SP-012       |
| SP-190 | Postgres-backed shared throttle store for multi-instance deployments | E18  | M8        |           16 | pending | SP-183       |
| SP-184 | Accessibility audit of the web UI                                    | E18  | M8        |           12 | pending | —            |
| SP-185 | End-to-end suite across critical flows                               | E18  | M8        |           24 | pending | —            |
| SP-186 | Ledger partitioning by month                                         | E18  | M8        |           20 | pending | SP-044       |
| SP-187 | Offline-tolerant scanner PWA                                         | E18  | M8        |           40 | pending | SP-103       |
| SP-188 | Labour tracking and productivity                                     | E18  | M8        |           32 | pending | SP-101       |
| SP-189 | Dock appointment scheduling                                          | E18  | M8        |           32 | pending | SP-070       |
