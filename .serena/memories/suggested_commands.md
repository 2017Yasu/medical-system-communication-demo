# Suggested commands (Linux / WSL2)

## Server (run in `server/`)
- `mvn test` unit only; `mvn verify` unit + IT
- `mvn test -Dtest=IfMatchRuleTest`; `mvn verify -Dit.test=S1ScenarioIT`
- `mvn verify -Ds1.repeat=20` repeat S1 ITs (flakiness check, SC-004)
- `mvn -DskipTests package` → `server/target/demo-server.jar`; run `java -jar server/target/demo-server.jar`

## UI (run in `ui/`)
- `npm ci && npm test` (Vitest); `npx vitest run tests/unit/sequence.test.ts`
- `npm run typecheck` (tsc --noEmit; no lint)
- `npm run dev` Vite; proxies `/fhir /ws /demo` to localhost:8080 (override `DEMO_BACKEND`)
- `npm run build` (typecheck + vite build → `ui/dist`)

## E2E (Playwright, needs a running server at http://localhost:8080, override `DEMO_URL`)
- Server must serve the CURRENT UI: `npm run build` → copy `ui/dist/*` into `server/src/main/resources/static/` → `mvn -DskipTests package` → `java -jar ...`. UI changes are invisible to E2E until the JAR is rebuilt.
- `npx playwright install chromium && npx playwright test`; filter: `npx playwright test tests/e2e/presentation.spec.ts -g "次へ"`
- Chromium failing on missing `libasound.so.2`: `npx playwright install-deps` (root) or add extracted libs to `LD_LIBRARY_PATH`.

## Whole app
- `docker compose build && docker compose up` → http://localhost:8080/
- `scripts/fetch-jp-packages.sh [--check|--force]` fetch JP Core / JP Terminology to `.cache/fhir-packages/`

## Spec workflow for new features
- `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement` (skills in `.claude/skills/`, scripts in `.specify/`).
