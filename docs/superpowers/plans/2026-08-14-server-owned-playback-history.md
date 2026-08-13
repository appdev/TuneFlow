# Server-Owned Playback History Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record only successfully started Flutter playback in a Service-owned, globally shared recent-history list capped at 50 entries, and make Flutter read that list from dedicated Service endpoints.

**Architecture:** Flutter remains the authority for the actual-start signal because `AudioPort.playCachedTrack` and `AudioPort.playTrack` return only after the audio implementation confirms playback. It sends one best-effort event to the Service; a dedicated SQLite repository generates the timestamp, replaces the same `source + id`, trims atomically to 50, and serves the ordered history. Service work is completed first, then a coordinated task updates the separate Flutter repository at `/Volumes/ext/MusicFree/flutter-client` against the frozen API contract.

**Tech Stack:** TypeScript, Fastify, TypeBox, better-sqlite3, Vitest; Dart, Flutter, Riverpod, `http`, `flutter_test`.

## Global Constraints

- Service repository: `/Volumes/ext/lx-music-server-web`.
- Flutter repository: `/Volumes/ext/MusicFree/flutter-client`; never use the deleted Service-repository path `flutter-client/` as the active client.
- `POST /api/v1/playback/history` accepts `{ "track": <extensible track> }`; `id` and `source` are non-empty strings.
- `GET /api/v1/playback/history` returns `{ "data": [{ "track": <track>, "playedAt": <Unix milliseconds> }] }` in newest-first order.
- The Service, not Flutter, generates `playedAt`.
- Replaying the same `source + id` replaces its metadata and moves it to the front.
- Retain exactly the newest 50 distinct entries globally for the Service instance.
- Failed resolution, failed audio startup, prefetching, probes, and ordinary pause/resume do not create entries.
- Successful cached, online, and Service-library playback do create entries.
- Playback-history reporting is best-effort and must not fail or interrupt audio playback.
- Do not migrate or delete `flutter.playback-history.v1`; Flutter simply stops using it.
- Preserve both repositories' existing dirty state. In particular, Service `src/server/app.ts` and Flutter `lib/features/player/player_controller.dart` already contain unrelated edits; inspect and patch them narrowly.
- Keep `/Volumes/ext/lx-music-server-web/AGENTS.md` local and uncommitted.
- Do not commit, push, publish, or deploy unless the user separately authorizes it.

---

### Task 1: Service playback-history persistence

**Files:**
- Create: `/Volumes/ext/lx-music-server-web/src/server/playback/historyRepository.ts`
- Create: `/Volumes/ext/lx-music-server-web/src/server/playback/historyRepository.test.ts`

**Interfaces:**
- Consumes: initialized Service SQLite connection from `getDB()`.
- Produces: `PlaybackHistoryTrack`, `PlaybackHistoryEntry`, and `PlaybackHistoryRepository` with `record(track): PlaybackHistoryEntry` and `list(): PlaybackHistoryEntry[]`.
- Invariant: `record` owns the timestamp and performs replace-plus-trim in one SQLite transaction.

- [x] **Step 1: Capture the existing Service diff before touching storage code**

Run:

```bash
cd /Volumes/ext/lx-music-server-web
git status --short
git diff -- src/server/app.ts src/server/app.test.ts
```

Expected: existing download/auto-download work is visible and remains outside the new repository files.

- [x] **Step 2: Write failing repository tests**

Create `historyRepository.test.ts` with a temporary initialized database and deterministic clock. Cover replacement, ordering, metadata refresh, retention, and restart persistence. The core assertions are:

```ts
const times = [1000, 2000, 3000]
const history = new PlaybackHistoryRepository(() => times.shift()!)

history.record({ id: 'same', source: 'kw', name: 'Old' })
history.record({ id: 'other', source: 'wy', name: 'Other' })
history.record({ id: 'same', source: 'kw', name: 'New', providerOnly: { albumId: 'a1' } })

expect(history.list()).toEqual([
  {
    track: { id: 'same', source: 'kw', name: 'New', providerOnly: { albumId: 'a1' } },
    playedAt: 3000,
  },
  { track: { id: 'other', source: 'wy', name: 'Other' }, playedAt: 2000 },
])
```

For retention, record IDs `track-0` through `track-50`, then assert length `50`, first ID `track-50`, and absence of `track-0`. Close and reopen the same temporary database before asserting persistence.

- [x] **Step 3: Run the repository test and confirm the expected failure**

Run:

```bash
npm run test:unit -- src/server/playback/historyRepository.test.ts
```

Expected: FAIL because `historyRepository.ts` and its exported types do not exist.

- [x] **Step 4: Implement the dedicated repository**

Create these public types and class:

```ts
export type PlaybackHistoryTrack = Record<string, unknown> & {
  id: string
  source: string
}

export interface PlaybackHistoryEntry {
  track: PlaybackHistoryTrack
  playedAt: number
}

export class PlaybackHistoryRepository {
  constructor(private readonly now: () => number = Date.now) {
    getDB().exec(`
      CREATE TABLE IF NOT EXISTS web_playback_history (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        track_id TEXT NOT NULL,
        track_json TEXT NOT NULL,
        played_at INTEGER NOT NULL,
        UNIQUE(source, track_id)
      );
      CREATE INDEX IF NOT EXISTS index_web_playback_history_order
      ON web_playback_history(played_at DESC, sequence DESC);
    `)
  }

  record(track: PlaybackHistoryTrack): PlaybackHistoryEntry {
    const playedAt = this.now()
    const db = getDB()
    db.transaction(() => {
      db.prepare('DELETE FROM web_playback_history WHERE source=? AND track_id=?').run(track.source, track.id)
      db.prepare('INSERT INTO web_playback_history(source, track_id, track_json, played_at) VALUES (?, ?, ?, ?)')
        .run(track.source, track.id, JSON.stringify(track), playedAt)
      db.prepare(`DELETE FROM web_playback_history WHERE sequence NOT IN (
        SELECT sequence FROM web_playback_history ORDER BY played_at DESC, sequence DESC LIMIT 50
      )`).run()
    })()
    return { track, playedAt }
  }

  list(): PlaybackHistoryEntry[] {
    const rows = getDB().prepare(`
      SELECT track_json AS trackJson, played_at AS playedAt
      FROM web_playback_history
      ORDER BY played_at DESC, sequence DESC
      LIMIT 50
    `).all() as Array<{ trackJson: string, playedAt: number }>
    return rows.map(row => ({ track: JSON.parse(row.trackJson) as PlaybackHistoryTrack, playedAt: row.playedAt }))
  }
}
```

Use a dedicated table with a monotonic tie-breaker:

```sql
CREATE TABLE IF NOT EXISTS web_playback_history (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  track_id TEXT NOT NULL,
  track_json TEXT NOT NULL,
  played_at INTEGER NOT NULL,
  UNIQUE(source, track_id)
);
CREATE INDEX IF NOT EXISTS index_web_playback_history_order
ON web_playback_history(played_at DESC, sequence DESC);
```

Inside one `better-sqlite3` transaction, delete the matching `source + track_id`, insert the new JSON with `this.now()`, then trim rows not selected by:

```sql
SELECT sequence
FROM web_playback_history
ORDER BY played_at DESC, sequence DESC
LIMIT 50
```

Return parsed JSON without dropping provider-specific fields. Sort `list()` by `played_at DESC, sequence DESC` and apply `LIMIT 50` defensively.

- [x] **Step 5: Run the focused repository tests**

Run:

```bash
npm run test:unit -- src/server/playback/historyRepository.test.ts
```

Expected: PASS for replacement, ordering, exact retention, metadata preservation, and restart persistence.

- [x] **Step 6: Review the Task 1 diff without committing**

Run:

```bash
git diff --check -- src/server/playback/historyRepository.ts src/server/playback/historyRepository.test.ts
git diff -- src/server/playback/historyRepository.ts src/server/playback/historyRepository.test.ts
```

Expected: only the dedicated repository and its tests are present; leave them uncommitted.

---

### Task 2: Service record/read API and OpenAPI contract

**Files:**
- Create: `/Volumes/ext/lx-music-server-web/src/server/routes/playbackHistory.ts`
- Modify: `/Volumes/ext/lx-music-server-web/src/server/app.ts`
- Modify: `/Volumes/ext/lx-music-server-web/src/server/app.test.ts`
- Modify: `/Volumes/ext/lx-music-server-web/src/server/api/openapi.test.ts`

**Interfaces:**
- Consumes: `PlaybackHistoryRepository.record` and `.list` from Task 1.
- Produces: `POST /api/v1/playback/history` and `GET /api/v1/playback/history` with operation IDs `recordPlaybackHistory` and `listPlaybackHistory`.
- Produces the frozen contract that the Flutter coordination task consumes.

- [x] **Step 1: Write failing Service API tests**

Add focused cases to `app.test.ts` using `createTestServer()`:

```ts
const track = {
  id: 'song-1',
  source: 'kw',
  name: 'Night Wind',
  singer: 'Artist',
  providerOnly: { albumId: 'album-1' },
}
const recorded = await app.inject({
  method: 'POST',
  url: '/api/v1/playback/history',
  payload: { track },
})
expect(recorded.statusCode).toBe(200)
expect(recorded.json().data.track).toEqual(track)
expect(recorded.json().data.playedAt).toEqual(expect.any(Number))

const listed = await app.inject({ method: 'GET', url: '/api/v1/playback/history' })
expect(listed.json()).toEqual({ data: [recorded.json().data] })
```

Also assert that missing/empty `id` or `source` returns `400 VALIDATION_ERROR`, replay replaces rather than duplicates, and the same data remains after closing and recreating the Service with the same `storageRoot`.

- [x] **Step 2: Extend the failing OpenAPI expectations**

Add `/api/v1/playback/history` to `expectedPaths` in `openapi.test.ts`. Assert GET returns an array whose item requires `track` and `playedAt`, POST request requires `track`, and the nested track requires both `id` and `source` while retaining `additionalProperties: true`.

- [x] **Step 3: Run the route and contract tests and confirm failure**

Run:

```bash
npm run test:unit -- src/server/app.test.ts src/server/api/openapi.test.ts
```

Expected: FAIL with the history path missing or returning `404`.

- [x] **Step 4: Implement the route module**

In `playbackHistory.ts`, build a history-specific track schema without making `source` required on every existing `Track` consumer:

```ts
const PlaybackHistoryTrack = Type.Object({
  ...Track.properties,
  source: Identifier,
}, { additionalProperties: true })

const PlaybackHistoryEntry = Type.Object({
  track: PlaybackHistoryTrack,
  playedAt: Type.Number(),
}, { additionalProperties: false })
```

Register:

```ts
export const registerPlaybackHistoryRoutes = (
  app: ApiFastifyInstance,
  history: PlaybackHistoryRepository,
): void => {
  app.get('/api/v1/playback/history', {
    schema: {
      operationId: 'listPlaybackHistory',
      tags: ['Playback'],
      summary: 'List recent playback history',
      response: { 200: ApiSuccess(Type.Array(PlaybackHistoryEntry)), ...ErrorResponses },
    },
  }, async() => ({
    data: history.list(),
  }))
  app.post('/api/v1/playback/history', {
    schema: {
      operationId: 'recordPlaybackHistory',
      tags: ['Playback'],
      summary: 'Record a successfully started playback',
      body: Type.Object({ track: PlaybackHistoryTrack }, { additionalProperties: false }),
      response: { 200: ApiSuccess(PlaybackHistoryEntry), ...ErrorResponses },
    },
  }, async(request) => ({
    data: history.record(request.body.track),
  }))
}
```

The POST body is `Type.Object({ track: PlaybackHistoryTrack }, { additionalProperties: false })`. Reuse `ApiSuccess` and `ErrorResponses`; do not accept `playedAt` in the request.

- [x] **Step 5: Wire the repository into Service startup**

In `app.ts`, import `PlaybackHistoryRepository` and `registerPlaybackHistoryRoutes`, construct the repository after database initialization, and register the history routes before the `/api/v1/*` fallback. Patch only adjacent startup lines so the existing download-manager changes remain intact:

```ts
const playbackHistory = new PlaybackHistoryRepository()
registerPlaybackHistoryRoutes(app, playbackHistory)
```

- [x] **Step 6: Run focused Service verification**

Run:

```bash
npm run test:unit -- src/server/playback/historyRepository.test.ts src/server/app.test.ts src/server/api/openapi.test.ts
npm run lint
```

Expected: focused tests PASS and lint completes without changing files.

- [x] **Step 7: Freeze and communicate the Service contract**

Read `/openapi.json` through `openapi.test.ts` evidence and prepare this exact coordination payload:

```text
POST /api/v1/playback/history
body: {"track": Track}; Track requires non-empty id and source and preserves extra metadata
success data: {"track": Track, "playedAt": number}

GET /api/v1/playback/history
success data: [{"track": Track, "playedAt": number}], newest first, maximum 50

Flutter reports only after AudioPort cached/stream playback returns successfully.
Reporting failure is best-effort and must not alter player state.
Pause/resume does not report.
```

Do not start Flutter edits until the Service tests above pass.

- [x] **Step 8: Review the Task 2 diff without committing**

Run:

```bash
git diff --check -- src/server/routes/playbackHistory.ts src/server/app.ts src/server/app.test.ts src/server/api/openapi.test.ts
git diff -- src/server/routes/playbackHistory.ts src/server/app.ts src/server/app.test.ts src/server/api/openapi.test.ts
```

Expected: the history contract is complete and unrelated existing `app.ts`/test changes are preserved; leave changes uncommitted.

---

### Task 3: Coordinated Flutter migration to the Service history API

**Files:**
- Create: `/Volumes/ext/MusicFree/flutter-client/lib/features/playback_history/playback_history_repository.dart`
- Create: `/Volumes/ext/MusicFree/flutter-client/test/features/playback_history/playback_history_repository_test.dart`
- Delete: `/Volumes/ext/MusicFree/flutter-client/lib/features/client_data/client_data_repository.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/player/player_controller.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/app/player_providers.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/home/home_controller.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/app/app_router.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/test/features/player/player_controller_test.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/test/features/home/home_controller_test.dart`

**Interfaces:**
- Consumes: the frozen Service API from Task 2 and existing `ServiceApi.request` envelope handling.
- Produces: `PlaybackHistoryRepository.recordPlayback(Track)` and `.readPlaybackHistory()` plus `PlaybackHistoryEntry`.
- Preserves: `AudioPort.playCachedTrack`/`playTrack` success is the actual-start boundary; `resume()` does not invoke reporting.

- [x] **Step 1: Dispatch the Flutter work as a coordination task after Service tests pass**

Create one bounded coordination task with working directory `/Volumes/ext/MusicFree/flutter-client`. Give it the frozen contract from Task 2, this task's file list and tests, and explicitly instruct it to:

```text
Inspect local AGENTS.md instructions and git diff first. Preserve all current dirty changes,
especially player_controller.dart and service_audio_handler.dart. Do not edit the Service repo.
Do not commit. Report changed files, focused test output, and any contract mismatch.
```

The primary task retains ownership of Service files. Do not dispatch another agent that edits the same Flutter files.

- [x] **Step 2: Inspect the Flutter overlap before edits**

The coordination task runs:

```bash
cd /Volumes/ext/MusicFree/flutter-client
git status --short
git diff -- lib/features/player/player_controller.dart lib/features/player/service_audio_handler.dart lib/app/app_router.dart
rg -n "ClientDataRepository|recordHistory|PlaybackHistoryEntry|playback-history" lib test
```

Expected: current player/cache/UI work is visible; the task records the relevant existing hunks and does not revert them.

- [x] **Step 3: Write failing repository tests for the new contract**

Create `playback_history_repository_test.dart`. Capture outbound requests and assert:

```dart
await repository.recordPlayback(track);
expect(call.method, 'POST');
expect(call.url.path, '/api/v1/playback/history');
expect(jsonDecode(call.body), {'track': track.toJson()});
```

For GET, return:

```dart
data([
  {
    'track': {
      'id': 'history-1',
      'source': 'kw',
      'name': 'Night Wind',
      'providerOnly': {'albumId': 'a1'},
    },
    'playedAt': 123,
  },
  {'track': {'id': 'broken', 'source': 'kw'}},
])
```

Assert one valid decoded entry, millisecond timestamp `123`, and preservation of `providerOnly`. Malformed entries are ignored.

- [x] **Step 4: Write failing player and home migration tests**

In `player_controller_test.dart`, inject a callback that appends reported IDs and verify:

```dart
final reports = <String>[];
final controller = PlayerController(
  resolver: resolver,
  audio: audio,
  reportPlayback: (track) async => reports.add(track.id),
);
```

Cover successful cached playback, successful streamed playback, failed stream startup, ordinary pause/resume, and a callback that throws. After `await Future<void>.delayed(Duration.zero)`, successful starts report once; failures and pause/resume add nothing; callback failure leaves `controller.state.error` null.

In `home_controller_test.dart`, change the mock path to `/api/v1/playback/history`, use the nested `{track, playedAt}` response, instantiate `PlaybackHistoryRepository(api)`, and assert the home track remains `history-1`. Assert no request path contains `client-data`.

- [x] **Step 5: Run the Flutter tests and confirm contract failures**

Run:

```bash
flutter test \
  test/features/playback_history/playback_history_repository_test.dart \
  test/features/player/player_controller_test.dart \
  test/features/home/home_controller_test.dart
```

Expected: FAIL because the new repository and `reportPlayback` integration do not exist.

- [x] **Step 6: Implement the dedicated Flutter repository**

Create:

```dart
final class PlaybackHistoryRepository {
  const PlaybackHistoryRepository(this.api);
  final ServiceApi api;

  Future<void> recordPlayback(Track track) async {
    await api.request(
      'POST',
      '/api/v1/playback/history',
      body: {'track': track.toJson()},
    );
  }

  Future<List<PlaybackHistoryEntry>> readPlaybackHistory() async {
    final value = await api.request('GET', '/api/v1/playback/history');
    if (value is! List) return const [];
    final result = <PlaybackHistoryEntry>[];
    for (final item in value) {
      if (item is! Map) continue;
      final json = Map<String, Object?>.from(item);
      final trackJson = json['track'];
      final playedAt = json['playedAt'];
      if (trackJson is! Map || playedAt is! num) continue;
      try {
        result.add(
          PlaybackHistoryEntry(
            track: Track.fromJson(Map<String, Object?>.from(trackJson)),
            playedAt: DateTime.fromMillisecondsSinceEpoch(playedAt.toInt()),
          ),
        );
      } on Object {
        continue;
      }
      if (result.length == 50) break;
    }
    return List.unmodifiable(result);
  }
}
```

`PlaybackHistoryEntry` retains `Track track` and `DateTime playedAt`. Decode `playedAt` with `DateTime.fromMillisecondsSinceEpoch`. Delete `ClientDataRepository` after all imports have migrated; do not call or delete the legacy server key.

- [x] **Step 7: Wire reporting to successful playback without changing the audio boundary**

Rename the controller injection from `recordHistory` to `reportPlayback` and preserve the existing unawaited best-effort behavior:

```dart
void _reportPlayback(Track track) {
  final report = _reportPlaybackCallback;
  if (report != null) unawaited(report(track).catchError((_) {}));
}
```

Invoke it only in the two existing success branches immediately after `audio.playCachedTrack(track, quality)` returns `true` or `audio.playTrack(track, streamUri, quality)` returns. Do not add reporting to `resume`, stream resolution, audio snapshots, prefetch, or `ServiceAudioHandler` itself. In `player_providers.dart`, inject:

```dart
reportPlayback: PlaybackHistoryRepository(connected.api).recordPlayback,
```

- [x] **Step 8: Migrate home reads from client data**

Change `HomeController.history` to `PlaybackHistoryRepository?`, update imports, and instantiate `PlaybackHistoryRepository(connected.api)` in `app_router.dart`. Preserve the existing partial-error behavior and `continueListening` mapping.

- [x] **Step 9: Format and run focused Flutter verification**

Run:

```bash
dart format \
  lib/features/playback_history/playback_history_repository.dart \
  lib/features/player/player_controller.dart \
  lib/app/player_providers.dart \
  lib/features/home/home_controller.dart \
  lib/app/app_router.dart \
  test/features/playback_history/playback_history_repository_test.dart \
  test/features/player/player_controller_test.dart \
  test/features/home/home_controller_test.dart

flutter test \
  test/features/playback_history/playback_history_repository_test.dart \
  test/features/player/player_controller_test.dart \
  test/features/home/home_controller_test.dart

flutter analyze \
  lib/features/playback_history \
  lib/features/player/player_controller.dart \
  lib/app/player_providers.dart \
  lib/features/home/home_controller.dart \
  lib/app/app_router.dart
```

Expected: formatting succeeds, all focused tests PASS, and targeted analysis reports no issues.

- [x] **Step 10: Return the coordination result for primary review**

The coordination task reports:

- exact Flutter files changed/deleted;
- exact test and analysis commands with pass/fail output;
- confirmation that existing dirty hunks were preserved;
- any mismatch with the frozen Service contract.

It must not commit or push.

---

### Task 4: Cross-repository integration review and frozen verification

**Files:**
- Review all files from Tasks 1-3.
- No new production files expected.

**Interfaces:**
- Consumes: passing Service API contract and coordinated Flutter implementation.
- Produces: evidence that actual-start reporting, server retention, and server-backed reads work together without relying on legacy client data.

- [x] **Step 1: Review both final diffs and exclude unrelated work**

Run:

```bash
cd /Volumes/ext/lx-music-server-web
git diff --check
git diff -- src/server/playback/historyRepository.ts src/server/playback/historyRepository.test.ts src/server/routes/playbackHistory.ts src/server/app.ts src/server/app.test.ts src/server/api/openapi.test.ts

cd /Volumes/ext/MusicFree/flutter-client
git diff --check
git diff -- lib/features/playback_history/playback_history_repository.dart lib/features/client_data/client_data_repository.dart lib/features/player/player_controller.dart lib/app/player_providers.dart lib/features/home/home_controller.dart lib/app/app_router.dart test/features/playback_history/playback_history_repository_test.dart test/features/player/player_controller_test.dart test/features/home/home_controller_test.dart
```

Expected: no whitespace errors; reviewed hunks implement only playback history and preserve pre-existing dirty changes.

- [x] **Step 2: Run the frozen Service verification set**

Run:

```bash
cd /Volumes/ext/lx-music-server-web
npm run test:unit -- src/server/playback/historyRepository.test.ts src/server/app.test.ts src/server/api/openapi.test.ts
npm run build:server
```

Expected: focused tests PASS and the Service build completes successfully.

- [x] **Step 3: Run the frozen Flutter verification set**

Run:

```bash
cd /Volumes/ext/MusicFree/flutter-client
flutter test \
  test/features/playback_history/playback_history_repository_test.dart \
  test/features/player/player_controller_test.dart \
  test/features/home/home_controller_test.dart
flutter analyze \
  lib/features/playback_history \
  lib/features/player/player_controller.dart \
  lib/app/player_providers.dart \
  lib/features/home/home_controller.dart \
  lib/app/app_router.dart
```

Expected: focused tests PASS and targeted analysis has no issues.

- [x] **Step 4: Verify removal of the legacy playback-history dependency**

Run:

```bash
cd /Volumes/ext/MusicFree/flutter-client
rg -n "flutter\.playback-history\.v1|ClientDataRepository|client-data.*history|recordHistory" lib test
```

Expected: no playback-history production references remain. Any test-fixture reference must be removed or explicitly unrelated before completion.

- [x] **Step 5: Report completion without committing**

Report:

- Service endpoints and SQLite retention behavior;
- Flutter actual-start reporting and Service-backed home reads;
- focused test/build/analyze evidence;
- confirmation that no commits, pushes, or deployments occurred;
- residual limitation that history is global until user identity exists.
