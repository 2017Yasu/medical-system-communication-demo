# Task completion checklist

- Design change? Confirm `docs/` (and `docs/05-decisions.md`) and `specs/` were updated first (constitution VIII); keep `contracts/` consistent with behavior.
- Server touched: in `server/` run `mvn verify` (unit + IT). Concurrency/subscription changes: also `mvn verify -Ds1.repeat=20`.
- UI touched: in `ui/` run `npm run typecheck` and `npm test`. Scenario or `data-guide` changes are validated by `tests/unit/scenarios.test.ts`.
- User-visible flow changed: rebuild UI → copy to server static → rebuild JAR → run server → `npx playwright test` (see `mem:suggested_commands`).
- No formatter/linter exists; match surrounding style manually (`mem:conventions`).
- Check: no new runtime external network/CDN dependency; any new data is fictional; screens still communicate only via `/fhir/*`.
