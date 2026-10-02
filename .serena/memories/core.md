# Core

Demo of FHIR-server-mediated integration between EHR and lab (LIS) screens, aimed at clinicians. Implemented: S1 (lab order). S2–S5 exist only as design in `docs/02-demo-scenarios.md`.

## Source map
- `server/` Java FHIR server (HAPI plain server + embedded Jetty, single process): `mem:server/core`
- `ui/` React/Vite SPA (EHR, LIS, traffic monitor, presentation/self-study modes): `mem:ui/core`
- `docs/` design (01 overview, 02 scenarios, 03 architecture, 04 design rules = Task state matrix / labels / codes / If-Match / transaction units, 05 decisions + open items)
- `specs/001-lab-order-workflow/` Spec Kit artifacts for S1; API/WebSocket/screen contracts in `contracts/`. Code comments cite these (e.g. `FR-032`, `R-18`, `T077`).
- `.specify/memory/constitution.md` (v1.0.1) — highest authority.
- `server/src/main/resources/seed/` fictional initial data; `ui/src/master/fhir-master.json` test items/codes (shared with server tests).
- `scripts/fetch-jp-packages.sh` fetches JP Core/JP Terminology into `.cache/fhir-packages/` (gitignored, not redistributed).

## Project-wide invariants (constitution)
- Screens talk to each other ONLY via the FHIR server (`/fhir/*`, Subscription ping). No direct screen↔screen channel, no custom backend API. Sole exception: `/demo/*` (reset, policy, traffic).
- All data fictional. No runtime network/CDN dependency (fonts bundled); start = `docker compose up`.
- Every request/response/notification is recorded and shown; business state changes must happen as visible FHIR traffic.
- Accident reproduction (lost update, etc.) is switchable via demo policy; defaults are safe side (If-Match required, Task transition check ON). Concurrent update to same version: exactly one succeeds, other gets 412. Clients never auto-retry on 412.
- FHIR R4 (4.0.1). Request (ServiceRequest = authorization) vs fulfilment (Task = progress) are separate resources.
- Docs-first: change `docs/` (decisions → `docs/05-decisions.md`) and `specs/` BEFORE implementing design changes.
- Language: code identifiers English; docs, UI text, code comments, error messages, commit message bodies in Japanese (commit subject prefix is conventional-commit English, see `mem:conventions`).

## Further memories
- Toolchain/version pins: `mem:tech_stack`
- Build/test/run commands, E2E setup pitfalls: `mem:suggested_commands`
- Code style, naming, commit format: `mem:conventions`
- What to run before declaring a task done: `mem:task_completion`
