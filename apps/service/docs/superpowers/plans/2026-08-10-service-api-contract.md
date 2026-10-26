# Service API Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Web-adaptation HTTP routes with a typed, validated, OpenAPI-described Service API and migrate the existing Web consumer without compatibility aliases.

**Architecture:** TypeBox route schemas are the single contract source for Fastify validation, inferred handler types, response serialization, and dynamic OpenAPI generation. Domain route plugins call existing repositories/services, while `src/web-runtime` translates the renderer's legacy IPC surface to the new HTTP and domain-event contracts.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Fastify 5.11, TypeBox 1.x, `@fastify/type-provider-typebox` 6.x, `@fastify/swagger` 9.x, Vitest 4, Playwright 1.62.

## Global Constraints

- Do not retain aliases, redirects, or handlers for old API paths.
- Do not add authentication, mobile code, or new catalog product features.
- Keep successful JSON envelopes as `{ data, meta? }`, errors as `{ error: { code, message, details? } }`, and deletions as empty `204` responses.
- Reject unknown request properties except explicitly extensible track metadata.
- Never serialize filesystem paths, upstream URLs, source headers, scripts, or credentials.
- Update the Web consumer in the same task as each breaking route change.
- Use contract tests for every route, Web tests for every affected mapping, and Playwright only for core user flows.

---

### Task 1: Contract infrastructure and error normalization

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/server/api/types.ts`
- Create: `src/server/api/schemas/common.ts`
- Create: `src/server/api/openapi.ts`
- Create: `src/server/api/openapi.test.ts`
- Modify: `src/server/errors.ts`
- Modify: `src/server/app.ts`

**Interfaces:**
- Produces: `ApiFastifyInstance`, `ApiSuccess(schema)`, `ApiErrorSchema`, `registerOpenApi(app)`, and `getOpenApiDocument(app)`.
- Produces normalized `VALIDATION_ERROR` responses consumed by all later tasks.

- [ ] **Step 1: Add a failing OpenAPI test**

Assert that a created server exposes `GET /openapi.json`, returns OpenAPI 3,
contains `GET /api/v1/health`, and assigns every operation an `operationId`.

- [ ] **Step 2: Run the focused test and confirm the route is absent**

Run: `npm test -- src/server/api/openapi.test.ts`
Expected: FAIL because `/openapi.json` and the API schema helpers do not exist.

- [ ] **Step 3: Install the compatible contract dependencies**

Run: `npm install @fastify/swagger@^9.8.1 @fastify/type-provider-typebox@^6.1.0 typebox@^1.3.12`

- [ ] **Step 4: Add shared schema helpers**

Implement the equivalent of:

```ts
import { Type, type TSchema } from '@fastify/type-provider-typebox'

export const ApiSuccess = <T extends TSchema>(data: T) => Type.Object({ data }, { additionalProperties: false })
export const ApiErrorSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }, { additionalProperties: false }),
}, { additionalProperties: false })
```

Define `ApiFastifyInstance` as the Fastify instance using
`TypeBoxTypeProvider`. Register Swagger before every route plugin and expose
`app.swagger()` through `/openapi.json` with an explicit response schema.

- [ ] **Step 5: Normalize Fastify validation errors**

Update the global error handler so `error.validation != null` maps to status
400, code `VALIDATION_ERROR`, message `Request validation failed`, and bounded
details containing only `instancePath`, `schemaPath`, and `message`.

- [ ] **Step 6: Make health the first fully described operation**

Add params/body/response schemas, tag `System`, summary, and operation ID
`getHealth`; change its body to `{ data: { status: 'ok' } }`.

- [ ] **Step 7: Run contract and existing server tests**

Run: `npm test -- src/server/api/openapi.test.ts src/server/app.test.ts`
Expected: PASS after updating the health assertion.

### Task 2: System, settings, and client-state API

**Files:**
- Create: `src/server/api/schemas/settings.ts`
- Modify: `src/server/routes/health.ts`
- Modify: `src/server/routes/runtime.ts`
- Modify: `src/server/routes/settings.ts`
- Modify: `src/web-runtime/rendererIpc.ts`
- Modify: `src/web-runtime/runtime.test.ts`
- Modify: `src/server/app.test.ts`

**Interfaces:**
- Consumes: Task 1 schema helpers and typed Fastify instance.
- Produces: `/runtime`, `/client-data/{key}`, typed settings operations, and a Service capability DTO.

- [ ] **Step 1: Write failing route and Web mapping tests**

Assert `/api/v1/env` and `/api/v1/app-data/x` return 404; assert the replacement
routes return the existing values; assert mocked Web calls use only
`/api/v1/runtime` and `/api/v1/client-data/x`.

- [ ] **Step 2: Run tests to establish the expected failures**

Run: `npm test -- src/server/app.test.ts src/web-runtime/runtime.test.ts`
Expected: FAIL on new path expectations.

- [ ] **Step 3: Add typed system and client-state routes**

Rename `/env` to `/runtime` and `/app-data/{key}` to `/client-data/{key}`.
Use a non-empty bounded key schema and require `{ value: unknown }` for PUT.
Describe capabilities as server features rather than Electron UI features.

- [ ] **Step 4: Define the supported settings contract**

Build TypeBox schemas from the keys and primitive/nullable value types in
`src/common/defaultSetting.ts`. GET returns a complete settings object; PATCH
uses a partial object with `additionalProperties: false`. Preserve language
side effects and the effective-patch event.

- [ ] **Step 5: Update Web mappings and run focused tests**

Run: `npm test -- src/server/app.test.ts src/web-runtime/runtime.test.ts`
Expected: PASS and no old system/client-state path in those files.

### Task 3: Playlist domain service and API

**Files:**
- Create: `src/server/api/schemas/tracks.ts`
- Create: `src/server/api/schemas/playlists.ts`
- Create: `src/server/playlists/service.ts`
- Create: `src/server/playlists/service.test.ts`
- Replace: `src/server/routes/lists.ts` with `src/server/routes/playlists.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`
- Modify: `src/web-runtime/rendererIpc.ts`
- Modify: `src/web-runtime/runtime.test.ts`

**Interfaces:**
- Produces: `PlaylistService` methods `list`, `get`, `create`, `update`, `remove`, `reorder`, `importState`, `addTracks`, `updateTracks`, `removeTracks`, `replaceTracks`, `clearTracks`, `reorderTracks`, `moveTracks`, `containsTrack`, and `findPlaylistIdsByTrack`.
- Produces browser-safe `TrackSchema`, `PlaylistSummarySchema`, and `PlaylistDetailSchema`.

- [ ] **Step 1: Write failing service tests for every mutation class**

Cover playlist create/update/delete/reorder/import and track add/update/remove/
replace/clear/reorder/move plus both membership queries. Assert each mutation
publishes one domain event with a browser-safe payload.

- [ ] **Step 2: Run the service test and confirm the service is absent**

Run: `npm test -- src/server/playlists/service.test.ts`
Expected: FAIL because `PlaylistService` does not exist.

- [ ] **Step 3: Implement the playlist service over existing DB functions**

Move validation-independent orchestration and event publication out of the
route file. Preserve built-in playlist IDs, insertion order, atomic full-state
import, and existing DB behavior.

- [ ] **Step 4: Write failing HTTP and Web transport tests**

Exercise every route in the design spec, validation rejection, and primary 404
or 409 response. Assert `/api/v1/lists` and every `/lists/actions/*` request
return 404. Assert renderer IPC calls map to the new resource endpoints.

- [ ] **Step 5: Implement playlist schemas and routes**

Register only `/api/v1/playlists...` and `/api/v1/tracks/{trackId}/playlists`.
Use `POST .../tracks/remove` rather than a DELETE request body. Ensure response
schemas strip server-private fields through `projectBrowserDto` or an equivalent
schema-backed projector before serialization.

- [ ] **Step 6: Update the Web adapter and run all playlist tests**

Run: `npm test -- src/server/playlists/service.test.ts src/server/app.test.ts src/web-runtime/runtime.test.ts`
Expected: PASS with no HTTP request to `/api/v1/lists`.

### Task 4: Sources and catalog routes

**Files:**
- Create: `src/server/api/schemas/sources.ts`
- Create: `src/server/api/schemas/catalog.ts`
- Modify: `src/server/routes/sources.ts`
- Replace: `src/server/routes/search.ts` with `src/server/routes/catalog.ts`
- Remove: `src/server/routes/lyrics.ts`
- Modify: `src/server/app.ts`
- Create: `src/server/routes/catalog.test.ts`
- Modify: `src/web-runtime/rendererIpc.ts`
- Modify: `src/web-runtime/lyrics.ts`
- Modify: `src/web-runtime/lyrics.test.ts`
- Modify: `src/renderer/core/music/online.ts`

**Interfaces:**
- Produces: typed source summaries and catalog track search, lyric, and picture responses.
- Removes: public `SourcesService.requestSource` HTTP pass-through while retaining the internal method.

- [ ] **Step 1: Write failing catalog and source contract tests**

Assert the three catalog operations validate source and track input, source
activation uses `PUT /sources/active`, and `/sources/{id}/request`, `/search`,
and `/lyrics` return 404.

- [ ] **Step 2: Run focused tests and confirm new operations are missing**

Run: `npm test -- src/server/routes/catalog.test.ts src/server/routes/lyrics.test.ts src/web-runtime/lyrics.test.ts`
Expected: FAIL on the new contract.

- [ ] **Step 3: Implement source and catalog schemas/routes**

Use existing `search`, `getLyric`, and `getPicture` functions behind the catalog
handlers. Preserve bounded 502 source errors. Do not expose scripts or worker
request shapes in source responses.

- [ ] **Step 4: Replace Web source RPC fallbacks**

Map source management to the new activation route. Point service-Web lyrics and
picture lookup at catalog endpoints. Ensure service-Web playback continues to
use playback resolution rather than generic source RPC. Remove generic source
request HTTP mapping from `rendererIpc.ts`.

- [ ] **Step 5: Run catalog, source, and Web music tests**

Run: `npm test -- src/server/routes/catalog.test.ts src/server/sources/source.test.ts src/web-runtime/lyrics.test.ts src/renderer/core/music/runtime.test.ts`
Expected: PASS with no old catalog/source-RPC path.

### Task 5: Playback, downloads, and library contracts

**Files:**
- Create: `src/server/api/schemas/media.ts`
- Modify: `src/server/routes/playback.ts`
- Modify: `src/server/routes/downloads.ts`
- Modify: `src/server/routes/library.ts`
- Modify: `src/server/playback/resolver.ts`
- Modify: `src/server/library/scanner.ts`
- Modify: `src/renderer/core/music/online.ts`
- Modify: `src/server/playback/proxy.test.ts`
- Modify: `src/server/downloads/downloads.test.ts`
- Modify: `src/server/task5PlaybackUi.smoke.test.ts`

**Interfaces:**
- Produces: safe media DTOs and new `/playback/tracks/resolve`, `/streams/{token}`, and `/library/tracks...` paths.

- [ ] **Step 1: Update tests first to the new paths and DTO schemas**

Assert resolve results begin with `/api/v1/streams/`; library records begin
with `/api/v1/library/tracks/`; GET/HEAD and valid/invalid Range behavior remain
unchanged; old paths return 404.

- [ ] **Step 2: Run focused tests and confirm failures**

Run: `npm test -- src/server/playback/proxy.test.ts src/server/downloads/downloads.test.ts`
Expected: FAIL because DTOs and routes still contain old paths.

- [ ] **Step 3: Implement typed media routes and projections**

Declare JSON schemas for download jobs, library tracks, and playback resolution.
Declare OpenAPI content and status metadata for SSE/audio routes without JSON
wrapping. Change only opaque URL construction; preserve token TTL, SSRF checks,
headers, Range forwarding, and local file containment.

- [ ] **Step 4: Update Web playback and smoke-test path matching**

Change direct fetch and URL guards in `online.ts` and the Playwright diagnostic
filters to the new routes.

- [ ] **Step 5: Run media tests**

Run: `npm test -- src/server/playback/proxy.test.ts src/server/downloads/downloads.test.ts src/server/task5PlaybackUi.smoke.test.ts`
Expected: PASS.

### Task 6: Domain SSE events

**Files:**
- Create: `src/server/api/schemas/events.ts`
- Modify: `src/server/routes/events.ts`
- Modify: `src/server/events.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/web-runtime/events.ts`
- Modify: `src/web-runtime/runtime.test.ts`
- Modify: `src/web-runtime/types.ts`

**Interfaces:**
- Produces: `ServiceEvent<T> = { type: string, sequence: number, data: T }` and a snapshot carrying the latest sequence and recoverable events.
- Consumes: domain event publications introduced in Tasks 2–5.

- [ ] **Step 1: Write failing event transport tests**

Assert monotonic sequence values, domain event names, normalized data envelopes,
snapshot restoration, reconnect behavior, and translation back to the renderer
IPC callbacks. Assert IPC constant strings do not appear on the wire.

- [ ] **Step 2: Run event tests and confirm old wire format fails**

Run: `npm test -- src/server/events.test.ts src/web-runtime/runtime.test.ts`
Expected: FAIL because current events send `{ name, params }` and IPC names.

- [ ] **Step 3: Implement typed domain events and Web translation**

Increment an in-memory sequence for each publication, store the latest
recoverable event per type, emit SSE `event: <domain-type>` and a JSON envelope,
and translate it in `web-runtime/events.ts`. Preserve reconnect snapshot
deduplication and listener cleanup.

- [ ] **Step 4: Run event and runtime tests**

Run: `npm test -- src/server/events.test.ts src/web-runtime/runtime.test.ts`
Expected: PASS.

### Task 7: Final contract artifact, documentation, and integration proof

**Files:**
- Create: `build-config/server/write-openapi.mjs`
- Modify: `build-config/server/build.mjs`
- Modify: `docs/server-web.md`
- Modify: `src/server/api/openapi.test.ts`
- Modify: relevant tests containing deleted paths

**Interfaces:**
- Produces: `dist/server/openapi.json` generated from the same registered route schemas and served by `/openapi.json`.

- [ ] **Step 1: Add a failing build-artifact test**

Assert the generated document contains every expected operation ID, contains no
old path, has reusable error schemas, and has no JSON operation without request
and response schemas.

- [ ] **Step 2: Implement deterministic OpenAPI writing**

Create the server with temporary storage/web roots, call `app.ready()`, obtain
`app.swagger()`, recursively sort object keys, write formatted JSON to the
prepared server output, and close the app. Integrate this after server build.

- [ ] **Step 3: Update API documentation**

Document `/openapi.json`, domain groups, error envelopes, streams/SSE, lack of
authentication, and the fact that this contract is pre-release and intentionally
replaced the earlier Web-adapter routes.

- [ ] **Step 4: Prove deleted routes are gone**

Run:

```sh
rg -n "/api/v1/(lists|env|app-data|search|lyrics|stream/|library(?:/|'))|sources/.+/activate|sources/.+/request" src tests docs --glob '!docs/superpowers/**'
```

Expected: no executable consumer or route matches; historical prose is allowed
only when explicitly labeled migration history.

- [ ] **Step 5: Run focused unit and integration verification**

Run: `npm test`
Expected: all Vitest tests pass.

Run: `npm run build:web && npm run prepare:service`
Expected: both builds succeed and `dist/server/openapi.json` exists.

- [ ] **Step 6: Run core browser flows once on the frozen tree**

Run: `npm run test:e2e -- tests/e2e/play-search-download.spec.ts tests/e2e/settings-theme.spec.ts`
Expected: both Playwright specs pass without unexpected page or console errors.

- [ ] **Step 7: Review the final diff without committing**

Run: `git diff --check && git status --short`
Expected: no whitespace errors; only planned files plus the user's pre-existing
dirty-worktree changes are present. Do not stage or commit without explicit
authorization.
