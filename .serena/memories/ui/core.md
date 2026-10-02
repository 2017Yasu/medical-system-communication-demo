# UI (`ui/src/`)

## Key modules / invariants
- `fhir/client.ts`: adds `X-Demo-Client` header to every request (monitor shows sender), keeps ETag and sends If-Match. No auto-retry on 412 etc.; errors mapped to Japanese business wording via `fhir/errors.ts` + `fhir/labels.ts`.
- `fhir/builders/labOrder.ts` + `fhir/labActions.ts`: build/send FHIR resources for each lab operation; shared by manual screen actions AND scenario auto-run — put request logic here, not in components.
- Codes/test items come from `master/fhir-master.json` (JLAC10 etc. verified against JP Terminology; server tests read the same file).
- `realtime/`: `useLiveData` (create Subscription → bind → refetch on ping), `trafficStore` (seq-ordered), `ensureSubscription` absorbs races when several screens create the same Subscription id.
- `scenario/`: definitions (`s1Main.ts`, `variations.ts`) + runner. Step completion = data state AND traffic condition (first matching traffic after previous step's baseline seq) — needed for steps with no data change (e.g. notification-driven refresh). Presentation-mode "back" = reset + replay.
- `guide/` self-study: scenario `target.control` must match a `data-guide` attribute on the screen; `tests/unit/scenarios.test.ts` checks this.
- `app/StageView`: EHR + LIS + monitor on one screen. Doctor and nurse views are always mounted, only visibility toggled (to keep Subscription binds alive) — don't conditionally unmount them.
- Systems: `systems/ehr/`, `systems/lis/`, `systems/shared/`; monitor in `monitor/` (sequence diagram, history, JSON view).

## Tests
- Unit: `tests/unit/*.test.ts` (Vitest, jsdom). E2E: `tests/e2e/*.spec.ts` (Playwright, page objects in `pages.ts`) against a running server — see `mem:suggested_commands`.
