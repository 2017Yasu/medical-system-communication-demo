# Server (`server/`, package `jp.example.demo`)

Single Jetty process serves `/fhir/*` (HAPI plain server, R4), `/ws/*`, `/demo/*`, static UI (`StaticSpaServlet`, from `src/main/resources/static/`, gitignored, filled from `ui/dist`). Entry: `DemoServerMain`. NOT HAPI JPA; derived from fhirstarters skeleton.

## Key invariants
- `store/InMemoryRepository`: immutable version snapshots; all writes serialized by ONE lock; commit and reset (`replaceAll`) swap a single reference.
- `fhir/ResourceWriter`: single place for create/update/patch rules (If-Match → 400/412, Task transitions → 422, Subscription validation). Single-op providers AND each transaction entry must go through it — never add write rules elsewhere. Rules in `fhir/rules/`; toggles in `demo/DemoPolicy` (safe defaults).
- `fhir/provider/*` extend `AbstractRepositoryProvider`. HAPI does not put `@Patch` If-Match into the id → `TaskProvider` reads it from `RequestDetails` and sets PATCH response ETag/Location itself.
- `fhir/system/TransactionProcessor`: applies POST → PUT → GET into a working session; commit only if all succeed. Supports `urn:uuid` rewriting, `ifMatch`, `ifNoneExist`. DELETE/PATCH entries → 400.
- `traffic/TrafficCaptureFilter`: records all `/fhir/*` traffic (gunzips). seq assigned at request receipt, so ping records may be delivered before the triggering request's record — always order by seq.
- `subscription/SubscriptionEngine`: R4 websocket channel (`bind {id}` / `ping {id}`); evaluates criteria against the post-update resource on every commit. Don't use criteria that a state change makes the resource fall out of.
- `demo/DemoControl`: `/demo/reset` resets data, traffic, binds AND policy.
- Errors are HAPI exceptions with Japanese business-language messages (UI parses diagnostics, e.g. detects "If-Match").

## Tests
- `src/test/java/jp/example/demo/unit/*Test` (surefire), `integration/*IT` (failsafe; `DemoServerExtension` boots Jetty on random port; `LabFlow` helper; HAPI Generic Client). `jp/JpPackageConsistencyTest` skips without `.cache/fhir-packages/` (`JP_FHIR_PACKAGE_DIR` overrides).
- Each scenario must have an IT reproducing its steps (constitution). `-Ds1.repeat=N` repeats S1 ITs.
