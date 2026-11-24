# StockPilot documentation

| Area         | Document                                                   | What it covers                                                   |
| ------------ | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Product      | [PRD](product/PRD.md)                                      | Vision, personas, goals, scope, metrics, release plan            |
| Product      | [Requirements](product/requirements.md)                    | Numbered FR/NFR with MoSCoW and acceptance criteria              |
| Product      | [User stories](product/user-stories.md)                    | Epics and Given/When/Then stories                                |
| Product      | [Traceability](product/requirements-traceability.md)       | FR → epic → ticket → module → test → status                      |
| Architecture | [Overview](architecture/overview.md)                       | C4 diagrams, module boundaries, request lifecycle                |
| Architecture | [Quality attributes](architecture/quality-attributes.md)   | Measurable NFR targets and verification                          |
| Decisions    | [ADR index](adr/README.md)                                 | Architecture decision records                                    |
| Design       | [System design](design/system-design.md)                   | State machines, sequences, algorithms, concurrency               |
| Design       | [Data model](design/data-model.md)                         | Target ERD, tables, indexes, migration status                    |
| API          | [API guide](api/README.md)                                 | Conventions, errors, pagination, auth, curl examples             |
| API          | [OpenAPI](api/openapi.yaml)                                | Full target API with `x-status` per operation                    |
| Security     | [Threat model](security/threat-model.md)                   | STRIDE, trust boundaries, ASVS mapping                           |
| Testing      | [Test strategy](testing/test-strategy.md)                  | Pyramid, coverage gates, acceptance matrix                       |
| Operations   | [Runbook](operations/runbook.md)                           | Configuration, run/migrate/seed, backup/restore, troubleshooting |
| Operations   | [Deployment](operations/deployment.md)                     | VM deployment with systemd, nginx and native PostgreSQL          |
| Planning     | [Roadmap](planning/roadmap.md)                             | Milestones M0–M8 with exit criteria                              |
| Planning     | [Backlog](planning/backlog.md)                             | Every ticket with estimate, status and dependencies              |
| Planning     | [Implementation status](planning/implementation-status.md) | What is done, what is stubbed, how % is computed                 |
| Planning     | [Risks](planning/risks.md)                                 | Risk register                                                    |
| Reference    | [Glossary](glossary.md)                                    | Warehouse domain vocabulary                                      |
