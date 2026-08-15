# Server-Owned Playback Session History Design

**Date:** 2026-08-14
**Status:** Approved for implementation

## Goal

Replace the bounded, de-duplicated recent-playback list with a 30-day playback-session history suitable for later AI analysis and recommendation. Every successful start creates an independent session. The client reports lifecycle facts that only its audio player can observe, while the Service owns identifiers, timestamps, retention, persistence, server-local playback resolution, and save-while-listening behavior.

The Service and its Docker-hosted Web UI live in this repository. Flutter remains a separate project at `/Volumes/ext/MusicFree/flutter-client` and will be changed through a coordinated follow-up task after the Service contract is implemented and verified.

## Scope and Assumptions

- One Service instance still represents one user. This work does not add accounts or user identity.
- Supported playback platforms are `android`, `ios`, `macos`, `windows`, `linux`, `web`, and `other`.
- The Docker-hosted browser client reports `web`; Docker itself is not a playback platform.
- Every successful playback start creates a new row, including repeated plays of the same track.
- The initial implementation records start/end timestamps, completion, last position, and media duration. Exact active-listening time excluding pause, seek, buffering, and playback-rate effects is deferred.
- Existing test-stage playback-history rows may be deleted during schema replacement. No legacy migration is required.

## Ownership and Data Flow

Playback uses a client-event/Service-ownership split:

1. A client asks the Service to resolve a track. The Service prefers an existing file in its download directory or media library and uses an online source only when no matching server-local file exists.
2. The audio-owning client confirms that playback actually started.
3. The client creates a playback session with the track snapshot and its platform.
4. The Service generates the playback ID and start time, persists the row, and, when the global `player.autoDownloadOnPlay` setting is enabled, asynchronously creates a server download task.
5. The client retains the returned playback ID while that logical play remains active.
6. Natural completion or an interruption updates that same row.

Stream resolution, HTTP range requests, prefetching, and download activity do not independently create playback sessions because none proves that audio actually started.

## API Contract

### Start a playback session

`POST /api/v1/playback/history`

Request:

```json
{
  "track": {
    "id": "stable-track-id",
    "source": "kw",
    "name": "Track name",
    "singer": "Artist"
  },
  "platform": "android"
}
```

`track` uses the existing extensible track schema. A non-empty `id` and `source` are required, and provider-specific metadata is preserved. The Service accepts only the supported platform values.

The successful response contains the complete stored session:

```json
{
  "data": {
    "playbackId": "opaque-service-generated-id",
    "track": {},
    "platform": "android",
    "startedAt": 1786665600000,
    "endedAt": null,
    "completed": false,
    "lastPositionSeconds": null,
    "durationSeconds": null
  }
}
```

The Service, rather than the client, generates `playbackId` and `startedAt`. A successful start response means the row is durable. Automatic download scheduling is best-effort and does not delay or change the response.

### End a playback session

`PATCH /api/v1/playback/history/{playbackId}`

Request:

```json
{
  "completed": false,
  "lastPositionSeconds": 37.4,
  "durationSeconds": 241.8
}
```

The numeric fields are finite, non-negative seconds. The Service generates `endedAt`. Natural media completion sends `completed=true`; switching tracks, stopping, or clearing the active queue sends `completed=false`.

Ending is idempotent and first-terminal-write-wins. Repeating an end request returns the already-ended row without changing its original terminal facts. An unknown playback ID returns the existing structured not-found error.

### Read playback history

`GET /api/v1/playback/history`

The response contains every retained session whose Service-generated `startedAt` is within the trailing 30-day window, ordered by `startedAt` descending with a deterministic database tie-breaker. There is no count limit and no `source + track_id` de-duplication.

All three operations are represented in OpenAPI. The existing `client-data` API remains available for unrelated client state.

## Persistence and Retention

The Service performs a one-time schema-shape check for `web_playback_history`. When it detects the legacy 50-row schema, it drops and recreates that table transactionally; once the new shape exists, later Service starts preserve it. Each row stores:

- `sequence`, an integer ordering tie-breaker;
- `playback_id`, the opaque unique session identifier;
- `source` and `track_id`, the stable track identity;
- `track_json`, the complete safe track snapshot;
- `platform`;
- `started_at` and nullable `ended_at`, in Unix milliseconds;
- `completed`, initially false;
- nullable `last_position_seconds` and `duration_seconds`.

The repository deletes rows with `started_at` older than the exact trailing 30-day cutoff. Cleanup runs during repository initialization and before or within history read/write operations, so an idle Service cleans up on its next playback-history interaction. The retention rule replaces the former 50-row limit.

Before persistence, the Service applies its browser-safe track projection and removes private path, opaque stream-token, request-header, and temporary audio-URL fields while retaining artwork and provider metadata needed to identify the music. Online tracks are replayable from `source + track_id + track_json`. Service-local tracks retain their stable library identity and same-origin library stream locator already exposed by the safe API DTO.

## Server-Local-First Playback

Playback resolution becomes server-local-first for normal clients:

1. refresh and match the requested track against the actual files in the Service download directory and scanned media library;
2. return `/api/v1/library/tracks/{id}/stream` when found;
3. otherwise resolve the original online provider;
4. if that provider fails, retain the existing alternative-provider fallback behavior.

The resolve API continues to expose only same-origin, safe stream paths. Existing compatibility input such as `preferLocal` may remain, but omitted/default behavior must prefer Service-local media. First-party Web and Flutter clients explicitly request local preference so their behavior is unambiguous.

Database download state is never sufficient proof that media exists. A completed record whose file was deleted or moved must be reconciled against a fresh filesystem scan. A relocated valid file may be adopted at its actual path; a missing file is treated as absent and online resolution/download may proceed.

A file counts as Service-local only when it is a regular supported audio file and passes integrity validation. Newly completed downloads retain their final post-metadata size and SHA-256 digest. If such a file later differs, it is treated as modified or damaged and is not selected for local playback or `skipExisting`. Legacy or manually added files without a retained digest must at least parse as supported audio. Invalid files are preserved for user recovery; a replacement download uses the existing collision-safe filename allocator and never overwrites the invalid file.

## Service-Owned Save While Listening

`player.autoDownloadOnPlay` remains a Service-global setting. Any client may read or toggle it through the existing settings API, but clients do not implement download policy.

After a playback session is durably created, the Service checks the setting. If enabled for an online track, the playback layer tells the download module only “download this track.” It does not pass quality, filename, directory, list/folder context, or other download-policy fields.

The download module owns the entire decision:

- when the normal download feature is enabled, use its effective download settings for naming, directory grouping, concurrency, metadata, and collision behavior;
- when the normal download feature is disabled, save-while-listening still runs and uses the download module's complete default configuration;
- request the highest quality advertised by the source, then fall back through the existing ordered quality candidates until one resolves and transfers successfully;
- force actual-file `skipExisting` behavior for save-while-listening even if the normal manual-download skip preference is off;
- serialize creation by stable track identity so simultaneous successful-start reports return or reuse one task instead of racing through the asynchronous filesystem check.

The existence check refreshes the actual filesystem and applies the integrity rules above. Database rows are reconciliation hints only. Completion records the final integrity evidence and refreshes the media library as it does today.

This is a separate server download task started after confirmed playback; it does not copy bytes from the active playback response. Download creation or transfer failure is observable through existing download state/logging but never fails the start-history response or active playback.

The Docker Web UI's current `playerPlaying` download-task hook is removed to prevent duplicate policy implementations and duplicate requests.

## Client Lifecycle Semantics

- Resolution, loading, or audio-start failure creates no session.
- Pause and resume retain the current playback ID and create no additional session.
- Natural completion ends the current session with `completed=true` before automatic next-track behavior begins.
- User next/previous/direct selection, stop, or queue clearing ends the current session with `completed=false` before the next logical playback begins.
- Repeat-one naturally completes the current session and creates a new session for the next iteration.
- A technical reload of the same logical play, including a quality change or expired stream retry, retains the existing playback ID rather than creating a new session.
- App closure, browser closure, process death, network loss, or crash may prevent the terminal request. Such a row remains `completed=false` with `endedAt=null` and is still useful as an interrupted/unknown-end signal.
- History start/end requests are best-effort from the player's perspective. Reporting failure must not interrupt playback, switching, or queue progression.

## Web Integration

The Docker-hosted Web UI reports `platform=web` and adopts the session lifecycle above. It stores only the active opaque playback ID in memory. The integration uses actual player events, not stream request activity, and covers natural completion, interruption, repeat-one, and technical reloads.

The Web UI no longer decides whether save-while-listening should create a download. It only exposes the existing Service setting and reports successful playback starts.

## Flutter Coordination Boundary

Service repository work establishes and verifies the database, routes, OpenAPI contract, local-first behavior, Service-owned automatic downloads, and Web integration first. The frozen contract is then sent through a separate coordinated Codex task rooted at `/Volumes/ext/MusicFree/flutter-client`.

That Flutter task must:

- load and follow the Flutter repository's own instructions;
- report the runtime platform using the approved enum;
- retain the Service-generated playback ID for the active logical play;
- end natural completion and interruption with position and duration;
- preserve the ID across pause/resume, quality reload, and stream retry;
- create a new session for repeat-one iterations and distinct replay actions;
- keep device-local cache behavior independent from Service-local downloads;
- explicitly request Service-local-first resolution;
- stop implementing any client-owned automatic Service download trigger if one is introduced elsewhere;
- treat reporting failure as non-fatal;
- update focused repository/controller tests.

The Flutter task may change only the Flutter repository unless it reports a concrete contract defect. Contract corrections are coordinated explicitly and verified in both repositories. Existing unrelated dirty-worktree changes in both repositories must be preserved.

## Error Handling

- Malformed tracks, unsupported platforms, negative/non-finite positions, and malformed IDs return structured validation errors without mutating history.
- Database start failures return an error and do not report a playback ID.
- Terminal updates for unknown IDs return not found.
- Repeated terminal updates return the original terminal row.
- Download scheduling failure is isolated from history persistence and playback.
- History read failure follows each client's existing partial-error or stale-state behavior.
- A failed terminal report leaves the session open; retention eventually removes it after 30 days.

## Verification

Service tests cover:

- one-time transactional replacement of the test-stage legacy table without deleting rows on later starts;
- one independent row for every successful start, including the same track repeatedly;
- Service-generated opaque IDs and timestamps;
- supported and rejected platforms;
- terminal completion and interruption updates;
- first-terminal-write-wins idempotency;
- position/duration validation;
- descending deterministic ordering;
- exact 30-day boundary cleanup with no count cap;
- persistence across Service restart;
- auto-download enabled/disabled behavior, including default download configuration when the normal download feature is disabled;
- track-only handoff from playback history to the download module, with no client/list/path/name/quality policy leakage;
- highest-to-lowest quality fallback, actual-file skip, and atomic concurrent task de-duplication;
- stale completed records, deleted files, relocated files, damaged known downloads, and invalid legacy/manual files;
- collision-safe replacement that preserves a damaged user-visible file;
- server-local-first resolution followed by online and alternative-provider fallback;
- OpenAPI request and response schemas.

Web tests cover:

- successful-start reporting with `platform=web`;
- no start record for failed playback;
- completion before automatic next;
- incomplete terminal updates for switching, stop, and queue clearing;
- no new session for pause/resume or quality reload;
- a new session for repeat-one;
- reporting failures not changing playback behavior;
- removal of the client-owned automatic-download request;
- Service-local-first playback.

The coordinated Flutter task covers the equivalent device-cached, Service-local, and online playback cases plus runtime platform mapping. A successful device-cache start still reports the playback session, allowing the Service to schedule its own download independently. Final handoff reports Service and Flutter verification separately because they are independent repositories.

After local verification, the authorized Docker deployment preserves the existing data volume and captures the pre-deploy image for rollback. Live verification covers enabled and disabled switches, normal online playback, device-cache reporting through the Flutter client, existing valid media, a deleted completed file, a relocated file, a deliberately damaged file, concurrent duplicate starts, quality fallback where the source permits it, playback fallback after an online failure, container health/restart state, and exact cleanup of test artifacts. Destructive fault injection is limited to test-created media; user media is never modified for testing.

## Non-Goals

- Multiple users or authentication.
- Exact active-listening seconds, scrobbling thresholds, or periodic heartbeat events.
- Inferring playback from stream requests.
- Storing temporary provider URLs, stream tokens, credentials, or absolute filesystem paths.
- Migrating existing test playback-history rows.
- Deleting downloaded media or adding a media-retention policy.
- Implementing the AI recommendation model in this change.
