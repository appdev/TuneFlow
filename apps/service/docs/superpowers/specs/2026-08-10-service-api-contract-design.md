# Service API Contract Design

## Context

The current Service exposes roughly forty `/api/v1` routes created while the
desktop renderer was adapted to the browser. Request validation, TypeScript
types, response shapes, and documentation are distributed across route
handlers. Playlist routes additionally expose both resource-style endpoints
and IPC-shaped `/actions/*` endpoints. There is no machine-readable contract.

The Service and Web build have not been released, so this migration does not
preserve the old HTTP API. Every breaking change must update the Web consumer
in the same change and carry verification appropriate to its user-visible
impact.

## Goals

- Make route schemas the single source of truth for runtime validation,
  TypeScript inference, response serialization, and OpenAPI generation.
- Organize existing capabilities as a coherent versioned domain API suitable
  for both Web and a future mobile client.
- Remove HTTP routes that expose desktop IPC or source-script protocol details.
- Define stable success, error, streaming, and event contracts.
- Prove each breaking change through contract tests and affected Web tests;
  retain Playwright coverage for core search, playlist, playback, and download
  flows.

## Non-goals

- Authentication, pairing, users, or public-network hardening.
- New catalog features such as charts, playlist discovery, comments, albums,
  or artists.
- Mobile implementation or generated client SDKs.
- Compatibility aliases, deprecation redirects, or dual old/new routes.
- Changes to source-script semantics or media transcoding.

## Contract Source of Truth

Use `@fastify/type-provider-typebox` and TypeBox schemas on every JSON route.
The schemas define params, query, body, success responses, and shared error
responses. Fastify performs runtime validation and response serialization,
while handlers receive inferred types.

Register `@fastify/swagger` in dynamic OpenAPI 3 mode before route plugins.
Generate `openapi.json` from the registered route schemas during verification
and the Service build. The generated file is a build artifact and must never be
edited manually. A structural test validates required operations, unique
operation IDs, component references, and the absence of undocumented JSON
routes.

Shared schemas live under `src/server/api/schemas/`; route-local schemas remain
next to their route plugin when they have no cross-domain consumer. Shared
schemas include:

- `ApiSuccess<T>` and `ApiPage<T>`;
- `ApiError`;
- identifiers and pagination;
- browser-safe track, playlist, source, download, and capability DTOs;
- domain event envelopes.

Schemas are application code. No API accepts user-provided schemas.

## API Conventions

- Keep `/api/v1` as the HTTP compatibility boundary.
- Use plural resource nouns and domain terminology; `lists` becomes
  `playlists`.
- JSON success responses are `{ "data": ... }`, optionally with `meta`.
- Successful deletion returns an empty `204` response.
- Errors are `{ "error": { "code", "message", "details"? } }`.
- Schema validation failures are normalized to the same error envelope with
  code `VALIDATION_ERROR`; internal validation details are safe, bounded field
  diagnostics rather than raw Ajv objects.
- Unknown JSON object properties are rejected unless a schema explicitly marks
  an extensible source-metadata object.
- Page-based endpoints use `page` and `pageSize`; page metadata is returned in
  `meta.page`, `meta.pageSize`, and the available `total` or `hasMore` value.
- Every operation has a stable `operationId`, tags, summary, declared success
  status, and declared error responses.
- Resource DTOs never expose server filesystem paths, upstream media URLs,
  source request headers, scripts, or credentials.

## Route Surface

### System and client state

| Method | New route | Replaces |
| --- | --- | --- |
| GET | `/api/v1/health` | `/api/v1/health` (normalized response) |
| GET | `/api/v1/capabilities` | same path (Service capability DTO) |
| GET | `/api/v1/runtime` | `/api/v1/env` |
| GET | `/api/v1/client-data/{key}` | `/api/v1/app-data/{key}` |
| PUT | `/api/v1/client-data/{key}` | `/api/v1/app-data/{key}` |
| GET | `/api/v1/settings` | same path |
| PATCH | `/api/v1/settings` | same path |

`client-data` remains an opaque JSON value store used by the current Web UI.
It is documented as client state rather than as a general server database.

### Playlists

| Method | New route | Purpose |
| --- | --- | --- |
| GET | `/api/v1/playlists` | List playlist summaries in order |
| POST | `/api/v1/playlists` | Create one or more playlists at a position |
| PATCH | `/api/v1/playlists` | Update one or more playlist summaries |
| DELETE | `/api/v1/playlists/{playlistId}` | Delete one playlist |
| GET | `/api/v1/playlists/{playlistId}` | Get summary and tracks |
| POST | `/api/v1/playlists/reorder` | Reorder playlist IDs |
| POST | `/api/v1/playlists/import` | Atomically replace complete playlist state |
| POST | `/api/v1/playlists/{playlistId}/tracks` | Add tracks at top or bottom |
| PATCH | `/api/v1/playlists/{playlistId}/tracks` | Update track records |
| POST | `/api/v1/playlists/{playlistId}/tracks/remove` | Remove track IDs without a DELETE body |
| PUT | `/api/v1/playlists/{playlistId}/tracks` | Replace all tracks |
| DELETE | `/api/v1/playlists/{playlistId}/tracks` | Clear all tracks |
| POST | `/api/v1/playlists/{playlistId}/tracks/reorder` | Reorder track IDs |
| POST | `/api/v1/playlists/tracks/move` | Move tracks between playlists |
| GET | `/api/v1/playlists/{playlistId}/tracks/{trackId}/exists` | Membership check |
| GET | `/api/v1/tracks/{trackId}/playlists` | Reverse membership lookup |

All `/api/v1/lists` and `/api/v1/lists/actions/*` routes are deleted. The Web
runtime adapter may fan out a legacy IPC batch delete into several HTTP DELETE
requests, but no legacy shape crosses the HTTP boundary.

### Sources and catalog

| Method | New route | Replaces |
| --- | --- | --- |
| GET | `/api/v1/sources` | same path |
| POST | `/api/v1/sources` | same path |
| PUT | `/api/v1/sources/active` | `/sources/{id}/activate` |
| DELETE | `/api/v1/sources/{sourceId}` | same semantics |
| POST | `/api/v1/catalog/tracks/search` | `/api/v1/search` |
| POST | `/api/v1/catalog/tracks/lyrics` | `/api/v1/lyrics` |
| POST | `/api/v1/catalog/tracks/picture` | source picture lookup previously reached through source RPC |

Delete `/api/v1/sources/{id}/request`. It exposes the source-script RPC
protocol and lets clients bypass domain validation. Search, lyrics, pictures,
playback, and downloads call `SourcesService` or the built-in SDK behind domain
services. The picture route is not a new end-user feature: it closes an existing
Web path that otherwise still calls source RPC when track metadata has no
picture URL. The active source remains a server-owned choice.

### Playback, downloads, and library

| Method | New route | Replaces |
| --- | --- | --- |
| POST | `/api/v1/playback/tracks/resolve` | `/api/v1/playback/resolve` |
| GET/HEAD | `/api/v1/streams/{token}` | `/api/v1/stream/{token}` |
| GET | `/api/v1/downloads` | same path |
| POST | `/api/v1/downloads` | same path |
| POST | `/api/v1/downloads/{downloadId}/start` | same semantics |
| POST | `/api/v1/downloads/{downloadId}/resume` | same semantics |
| POST | `/api/v1/downloads/{downloadId}/pause` | same semantics |
| DELETE | `/api/v1/downloads/{downloadId}` | same semantics |
| GET | `/api/v1/library/tracks` | `/api/v1/library` |
| POST | `/api/v1/library/scan` | same path |
| GET/HEAD | `/api/v1/library/tracks/{trackId}/stream` | `/library/{id}/stream` |

Audio routes declare Range behavior, `200`, `206`, `410`/`416`, and media
content in OpenAPI. Their bodies are not JSON-wrapped. Opaque stream URLs in
DTOs use only the new paths.

### Events and contract discovery

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/v1/events` | SSE domain event stream |
| GET | `/api/v1/events/snapshot` | Current recoverable event state |
| GET | `/openapi.json` | Generated OpenAPI contract |

Replace IPC constants on the wire with domain event names:

- `settings.updated`;
- `playlists.created`, `playlists.updated`, `playlists.deleted`,
  `playlists.reordered`, `playlists.imported`;
- `playlist.tracks.added`, `playlist.tracks.updated`,
  `playlist.tracks.removed`, `playlist.tracks.reordered`,
  `playlist.tracks.replaced`, `playlist.tracks.cleared`,
  `playlist.tracks.moved`;
- `sources.updated`;
- `downloads.updated`.

Each SSE data payload is an envelope containing `type`, `data`, and a
process-local monotonically increasing `sequence`. The Web adapter translates
domain events back to renderer IPC events internally. The snapshot endpoint
returns the latest recoverable state plus the latest sequence. Durable replay
across Service restarts is outside this scope.

## Server Structure

Refactor route registration into Fastify plugins grouped by domain. Handlers
perform HTTP translation only and call existing repositories/services. Move
playlist mutation orchestration out of the route file into a playlist service
so event publication and data operations can be tested without HTTP.

`createServer` constructs dependencies, registers Swagger and shared schemas,
registers domain plugins, then registers the SPA fallback. A final test asserts
that every `/api/v1` JSON route has a schema and appears in OpenAPI.

The Web runtime retains its current renderer-facing IPC API. Only its transport
handlers and event translation change, which contains the HTTP breaking change
inside `src/web-runtime` rather than spreading it into Vue components.

## Error Handling

- TypeBox/Fastify validation errors become HTTP 400 `VALIDATION_ERROR`.
- Missing resources use domain-specific 404 codes.
- Conflicting state uses 409, including no active source where appropriate.
- Upstream/source failures use 502 with a bounded public message.
- Expired stream tokens remain 410.
- Unexpected failures use 500 `INTERNAL_ERROR`; stack traces and upstream
  secrets are never returned.
- All error variants are declared through reusable OpenAPI components.

## Verification Strategy

1. **Schema unit tests:** shared DTO schemas accept representative safe values,
   reject malformed values, and prove private fields are not serialized.
2. **Route contract tests:** every operation covers success, validation error,
   and primary domain error; generated OpenAPI is structurally asserted.
3. **Service tests:** playlist orchestration, source selection, event envelopes,
   and stream DTO projection are tested independently.
4. **Web runtime tests:** each changed transport mapping and domain-to-IPC event
   translation is tested with mocked fetch/EventSource.
5. **Core Playwright flows:** run search/playback, playlist mutation,
   download/local-library, and existing settings/theme flows affected by the
   cutover.
6. **Final integration pass:** build Web and Service from the frozen tree, run
   the focused Vitest suites, and run the selected Playwright projects once.

No old route may remain in the generated contract or be requested by Web tests.
A repository search for deleted paths is part of verification.

## Delivery Sequence

1. Add contract infrastructure, shared schemas, OpenAPI generation, and error
   normalization without changing routes.
2. Migrate system, settings, and client-state routes and their Web mappings.
3. Replace playlists and remove all list action routes.
4. Migrate source, catalog, and source RPC usage.
5. Migrate playback, streams, downloads, and library DTO paths.
6. Replace wire-level IPC events with domain events.
7. Remove old paths, generate the final OpenAPI artifact, and run the final
   integration verification.

Each sequence step leaves the Service and Web mutually consistent. No
compatibility layer or partially migrated externally callable route set is a
deliverable.
