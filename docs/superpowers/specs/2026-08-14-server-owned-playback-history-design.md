# Server-Owned Playback History Design

**Date:** 2026-08-14

## Goal

Move recent-playback ownership from Flutter client data into a dedicated Service API and persistent store. A history entry is created only after the Flutter audio player confirms that a newly loaded track has actually started playing. The Service keeps at most 50 entries and becomes the source of truth for all clients.

## Current Behavior

Flutter currently writes the full `Track.toJson()` payload plus a client-generated `playedAt` timestamp to the opaque `flutter.playback-history.v1` client-data key. It de-duplicates entries by `source + id`, retains 50 entries, and reads the same value for the home screen.

The Service can observe online and library stream requests, but it cannot observe playback from Flutter's local media cache. Stream requests are also an imperfect playback signal because probes, range requests, and prefetching do not prove that the player started.

## Architecture

Playback history uses a client-event/server-ownership split:

- Flutter determines when actual playback starts because it owns the audio player state.
- Flutter reports the track metadata, but does not generate the playback timestamp or maintain the history list.
- The Service validates, timestamps, de-duplicates, limits, persists, and returns history.
- The Service does not independently infer playback from stream-resolution or stream-transfer requests.

This produces one playback signal for online streams, Service library streams, and Flutter cache hits without duplicate server and client detection paths.

## API Contract

### Record playback

`POST /api/v1/playback/history`

The request contains one track using the existing extensible track schema. The Service requires a non-empty track identity and source while preserving provider-specific metadata accepted by that schema.

The Service generates `playedAt` at request handling time. A client-supplied timestamp is neither required nor trusted.

On success, the endpoint returns the stored history entry containing:

- `track`: the normalized/preserved track object;
- `playedAt`: the Service-generated Unix timestamp in milliseconds.

### Read playback history

`GET /api/v1/playback/history`

The response contains at most 50 entries ordered by `playedAt` descending. Each entry has the same `track` and `playedAt` shape returned by the record endpoint.

The endpoints are added to the OpenAPI contract. The existing `client-data` API remains available for unrelated opaque client state.

## Persistence and Retention

Playback history is stored in a dedicated SQLite table rather than `web_app_data`. Each row stores the stable identity fields, the complete track JSON, and the Service-generated playback time.

Recording is atomic:

1. remove or replace the existing row matching `source + id`;
2. store the new metadata and timestamp;
3. delete every row outside the newest 50.

Ordering uses the playback timestamp plus a deterministic database tie-breaker so simultaneous writes have stable results. Replaying a track moves it to the front and updates its stored metadata. This Service currently has no user identity, so the table represents one global history for the Service instance.

No migration is performed from `flutter.playback-history.v1`. Existing opaque data remains untouched but is no longer read or written by Flutter after migration. The new history therefore begins empty.

## Flutter Integration

The Flutter client is a separate project rooted at `/Volumes/ext/MusicFree/flutter-client` rather than this Service repository's former `flutter-client/` directory.

The playback reporting path is attached to successful startup of a newly loaded track. `ServiceAudioHandler._startPlayback()` already waits until the audio player reports `playing=true` and is used by both cached and streamed tracks. The controller invokes the Service history reporter only after the corresponding cached or streamed playback method succeeds.

The integration must preserve these semantics:

- cached playback is reported;
- online and Service-library playback is reported;
- resolution, loading, or playback failures are not reported;
- prefetching and stream probes are not reported;
- pausing and resuming the already loaded track does not create another entry;
- selecting the same track as a new playback action may report it again and move it to the front;
- reporting failure never interrupts or marks audio playback as failed.

Flutter replaces the playback-history-specific behavior in `ClientDataRepository` with a dedicated playback-history repository backed by the two new endpoints. The home controller reads recent playback from that repository. Other client-data uses remain unchanged.

## Coordination Boundary

Service work establishes the database repository, routes, schemas, OpenAPI contract, and tests first. Once that contract is available, a separate coordinated Flutter task receives:

- the exact request and response contract;
- the actual-playback reporting rules;
- the requirement to remove playback-history reads and writes from client data;
- the home-screen repository migration;
- required controller, repository, and home tests.

The Flutter task is constrained to `/Volumes/ext/MusicFree/flutter-client` unless a contract defect requires coordination with the Service implementation. It must load and follow that project's own instructions. Service and Flutter files are in separate repositories; any contract correction is coordinated explicitly rather than silently changing both sides of the interface.

## Error Handling

- Invalid track identities or malformed payloads return the existing structured API validation errors and do not change history.
- Persistence errors return a Service error and do not report a successful write.
- Flutter treats recording as best-effort and swallows the reporting failure after making it observable through existing diagnostic mechanisms where available.
- History read failures participate in the home screen's existing partial-error/stale-state behavior.

## Verification

Service tests cover:

- record and read response schemas;
- Service-generated timestamps;
- descending order;
- `source + id` de-duplication and metadata replacement;
- retention of exactly the newest 50 entries;
- persistence across Service restart;
- rejection of malformed records;
- OpenAPI route and schema exposure.

Flutter tests cover:

- reporting after successful cached playback;
- reporting after successful streamed playback;
- no reporting on resolve or audio startup failure;
- no duplicate report on pause/resume;
- reporting failure does not fail playback;
- history repository decoding and malformed-entry handling;
- home screen loading from the new history endpoint rather than client data.

A final integration pass runs the focused Service and Flutter suites and checks the combined diff for accidental changes to the user's existing download and auto-download work.

## Non-Goals

- Per-user playback history before the Service has an identity/authentication model.
- Playback position, listened duration, completion state, play counts, or scrobbling thresholds.
- Inferring playback from stream GET/HEAD/range activity.
- Migrating the legacy Flutter client-data history.
- Changing the retention limit from 50.
