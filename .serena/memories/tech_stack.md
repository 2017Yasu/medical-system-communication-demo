# Tech stack

## Server (`server/pom.xml`)
- Java release 21 (constitution allows ≥17; Docker uses temurin-21). Maven. Packaging: shade plugin → `target/demo-server.jar`, main `jp.example.demo.DemoServerMain`.
- HAPI FHIR 8.12.1 (base, server, structures-r4; client for tests only), Jetty 12.1 ee10 (servlet + jakarta websocket), jakarta.servlet 6.0, `io.dogote:json-patch`, logback.
- Tests: JUnit 5.12, AssertJ. surefire excludes `**/*IT.java`; failsafe runs them, passes `s1.repeat` system property.

## UI (`ui/package.json`, npm with `package-lock.json`)
- TypeScript 5.9 (strict, noUnusedLocals/Parameters, `moduleResolution: Bundler`, `noEmit`), React 19, react-router 8, Vite 8, Vitest 5 + jsdom, Playwright 1.63 (chromium), `@types/fhir` for R4 types, `@fontsource/noto-sans-jp` (bundled font, offline).
- No linter/formatter configured.

## Delivery
- `Dockerfile` multi-stage: node:22 UI build → maven temurin-21 server build (copies `ui/dist` into `src/main/resources/static`) → temurin-21 JRE. `compose.yml` (not `.yaml`). Port 8080 (`PORT` env).
