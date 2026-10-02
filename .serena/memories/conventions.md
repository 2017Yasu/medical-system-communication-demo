# Conventions

## Language split
- Identifiers English; comments, Javadoc/JSDoc, exception/error messages, UI strings, docs in Japanese (full-width punctuation 「」（）、。 and a half-width space between Japanese and ASCII words, e.g. `FHIR サーバー`).
- UI shows business terms first, FHIR code/resource name alongside (labels centralized in `ui/src/fhir/labels.ts`; spec in `docs/04-design-rules.md` 表示ラベル).

## Comments
- Brief; often cite the spec/doc source: FHIR spec section, `contracts/*.md` section, requirement ids (`FR-xxx`, `SC-xxx`, `R-xx`). Top-of-file `//` comment in TS states purpose + source.
- Java: one-line `/** ... */` Javadoc on classes/public methods; `@param` only when non-obvious.

## Java
- 4-space indent, `final` classes where possible, constructor injection (e.g. `DemoPolicy`), records for value types (`StoredVersion`), throw HAPI `BaseServerResponseException` subclasses (`InvalidRequestException` 400, `PreconditionFailedException` 412, `UnprocessableEntityException` 422).

## TypeScript / React
- 2-space indent, double quotes, semicolons. Named exports; string-literal union types over enums; `interface` for shapes; FHIR types via `import type { Task, ... } from "fhir/r4"` (`@types/fhir`).
- CSS: design tokens in `styles/tokens.css`, CSS modules for layout (`*.module.css`).
- Elements targeted by scenarios/guide carry `data-guide` attributes; keep them in sync with scenario `target.control`.

## Git
- Conventional-commit subjects in English (`feat:`, `fix:`, `docs:`), referencing task ids where applicable (e.g. `(T077-T083)`).
