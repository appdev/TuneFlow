# Playback Session History Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store every successful playback as an independent 30-day Service-owned session, prefer server-local media, centralize save-while-listening in the Service, integrate the Docker Web player, and hand the frozen contract to a coordinated Flutter task.

**Architecture:** SQLite stores one row per logical playback with Service-generated identity and timestamps. Clients report only actual playback lifecycle facts; after a durable start, the Service passes only the online track to a download-module entrypoint that owns effective settings, highest-to-lowest quality fallback, actual-file validation, and atomic creation de-duplication. Playback resolution refreshes and validates the Service library before online sources, while Web and Flutter explicitly request that behavior.

**Tech Stack:** TypeScript, Fastify, TypeBox/OpenAPI, better-sqlite3, Vue renderer event hooks, Vitest, Playwright, and Dart/Flutter in a separately coordinated repository.

## Global Constraints

- One Service instance represents one user; do not add authentication or user tables.
- Retain sessions for an exact trailing 30 days with no row-count limit and no track de-duplication.
- Supported platforms are exactly android, ios, macos, windows, linux, web, and other.
- Do not store provider audio URLs, opaque stream tokens, request headers, credentials, or absolute filesystem paths.
- Exact pause-adjusted listening seconds, AI recommendation logic, download deletion, and media-retention policy are out of scope.
- Reporting and automatic-download failures must never fail or interrupt playback.
- Playback and both clients must not pass download quality, filename, directory, list ID, or grouping policy; the download module receives only the track.
- When `download.enable=true`, save-while-listening uses current download settings; when false, it uses the complete download defaults while retaining the Service-owned `/data/audio` root.
- Save-while-listening always checks actual files, always skips a valid existing file, and tries advertised qualities from highest to lowest.
- A database row is never proof that media exists. Missing, moved, and damaged files are reconciled against a fresh scan.
- Damaged files are preserved and never overwritten; replacement uses collision-safe naming.
- Existing history may be discarded once during legacy schema replacement, but the new table must survive later restarts.
- Preserve unrelated dirty-worktree changes in both repositories.
- Do not stage, commit, push, or publish. The user has authorized deployment only to the established Docker host after all local Service/Web checks pass; preserve the data volume and record a rollback image.

---

## File Map

- src/server/playback/historyRepository.ts: session types, one-time schema replacement, CRUD, and retention.
- src/server/playback/historyRepository.test.ts: migration, lifecycle, ordering, persistence, and retention proof.
- src/server/playback/historyTrack.ts: safe playback-track snapshot projection.
- src/server/playback/historyTrack.test.ts: sensitive-field stripping tests.
- src/server/routes/playbackHistory.ts: TypeBox start/list/end routes and async start callback.
- src/server/downloads/types.ts: persisted final-file integrity evidence.
- src/server/downloads/manager.ts: track-only playback-download entrypoint, effective settings, integrity reconciliation, and atomic creation de-duplication.
- src/server/downloads/downloads.test.ts: download defaults, quality fallback, races, and missing/moved/damaged file proof.
- src/server/library/scanner.ts: exclude invalid audio and validate known download integrity against actual files.
- src/server/app.ts: inject the track-only playback download boundary and scanner integrity lookup.
- src/server/app.test.ts: HTTP contract, persistence, idempotency, and auto-download integration.
- src/server/api/openapi.test.ts: frozen external contract assertions.
- src/server/playback/resolver.ts and src/server/playback/proxy.test.ts: Service-local-first resolution.
- src/renderer/core/music/online.ts: explicit first-party local preference.
- src/renderer/core/useApp/usePlayer/playbackSession.ts: Web session state machine and request adapter.
- src/renderer/core/useApp/usePlayer/playbackSession.test.ts: Web lifecycle tests.
- src/renderer/core/useApp/usePlayer/usePlaybackSession.ts: Web player-event wiring.
- src/renderer/core/useApp/usePlayer/usePlayer.ts: install the new lifecycle hook.
- src/renderer/core/useApp/usePlayer/useAutoDownload.ts: delete after Service ownership is active.
- /Volumes/ext/MusicFree/flutter-client: changed only by the coordinated Flutter task after contract freeze.
- Remote Docker deployment: rebuild from the frozen Service tree, preserve the existing `/data` volume, verify health, and clean only test-created artifacts.

---

### Task 1: Persist independent 30-day playback sessions

**Files:**
- Modify: src/server/playback/historyRepository.ts
- Modify: src/server/playback/historyRepository.test.ts
- Create: src/server/playback/historyTrack.ts
- Create: src/server/playback/historyTrack.test.ts

**Interfaces:**
- Consumes: getDB() and projectBrowserDto(value).
- Produces: PlaybackPlatform, PlaybackSession, PlaybackSessionEnd, sanitizePlaybackTrack(track), and PlaybackHistoryRepository.start/end/list.

- [ ] **Step 1: Replace repository tests with failing session-lifecycle coverage**

Use deterministic clocks and IDs:

~~~ts
const DAY = 86_400_000
const history = new PlaybackHistoryRepository({
  now: () => now,
  createId: () => 'play-' + ++id,
})

const first = history.start({ id: 'same', source: 'kw', name: 'First' }, 'android')
const second = history.start({ id: 'same', source: 'kw', name: 'Second' }, 'web')
expect(history.list().map(item => item.playbackId))
  .toEqual([second.playbackId, first.playbackId])

expect(history.end(first.playbackId, {
  completed: false,
  lastPositionSeconds: 12.5,
  durationSeconds: 180,
})).toMatchObject({ completed: false, endedAt: now })
~~~

Add cases for first-terminal-write-wins, unknown ID, persistence after reopen, equality at the 30-day cutoff, deletion just outside it, more than 50 retained rows, and one-time replacement of a manually created legacy table.

- [ ] **Step 2: Run repository tests and verify the current implementation fails**

~~~bash
npx vitest run src/server/playback/historyRepository.test.ts src/server/playback/historyTrack.test.ts
~~~

Expected: failures because session lifecycle, retention, and sanitizer APIs do not exist.

- [ ] **Step 3: Implement safe snapshot projection**

Start from projectBrowserDto. Preserve stable identity, title, artist, album, artwork, provider IDs, and a safe same-origin library stream path. Recursively remove filePath, path, url, headers, authorization, cookie, token, and streamToken. Retain streamUrl only when it matches the approved library path.

~~~ts
export const sanitizePlaybackTrack = (
  track: PlaybackHistoryTrack,
): PlaybackHistoryTrack => {
  const projected = projectBrowserDto(track)
  if (projected == null || typeof projected !== 'object' || Array.isArray(projected)) {
    throw new TypeError('Playback track projection is invalid')
  }
  return sanitizeObject(projected as Record<string, unknown>) as PlaybackHistoryTrack
}
~~~

- [ ] **Step 4: Implement the repository**

Use these exact public interfaces:

~~~ts
export const PLAYBACK_PLATFORMS = [
  'android', 'ios', 'macos', 'windows', 'linux', 'web', 'other',
] as const
export type PlaybackPlatform = typeof PLAYBACK_PLATFORMS[number]

export interface PlaybackSessionEnd {
  completed: boolean
  lastPositionSeconds: number
  durationSeconds: number
}

export interface PlaybackSession {
  playbackId: string
  track: PlaybackHistoryTrack
  platform: PlaybackPlatform
  startedAt: number
  endedAt: number | null
  completed: boolean
  lastPositionSeconds: number | null
  durationSeconds: number | null
}

export class PlaybackHistoryRepository {
  start(track: PlaybackHistoryTrack, platform: PlaybackPlatform): PlaybackSession
  end(playbackId: string, terminal: PlaybackSessionEnd): PlaybackSession | undefined
  list(): PlaybackSession[]
}
~~~

Use PRAGMA table_info(web_playback_history) to detect the old shape. Transactionally drop and recreate only when the shape is legacy or invalid. Generate IDs with randomUUID() by default. Delete rows where started_at is less than now minus 30 days during initialization and every public operation. Return an already-ended row unchanged.

- [ ] **Step 5: Run focused repository tests**

~~~bash
npx vitest run src/server/playback/historyRepository.test.ts src/server/playback/historyTrack.test.ts
~~~

Expected: all pass, including 51+ rows, restart persistence, one-time replacement, and cutoff behavior.

- [ ] **Step 6: Review the task diff without staging**

~~~bash
git diff --check -- src/server/playback/historyRepository.ts src/server/playback/historyRepository.test.ts src/server/playback/historyTrack.ts src/server/playback/historyTrack.test.ts
~~~

Expected: no whitespace errors. Do not commit.

---

### Task 2: Make the download module authoritative for save-while-listening

**Files:**
- Modify: src/server/downloads/types.ts
- Modify: src/server/downloads/manager.ts
- Modify: src/server/downloads/downloads.test.ts
- Modify: src/server/library/scanner.ts

**Interfaces:**
- Consumes: `defaultSetting`, `QUALITYS`, `getMusicTypes`, actual filesystem state, `music-metadata.parseFile`, and existing collision-safe publication.
- Produces: `DownloadManager.createForPlayback(musicInfo): Promise<DownloadDto>`, `DownloadManager.expectedIntegrity(filePath): DownloadFileIntegrity | undefined`, persisted `finalIntegrity`, and a scanner that returns only usable audio.

- [ ] **Step 1: Add failing effective-settings and track-only entrypoint tests**

Create the manager with customized download settings and assert the public playback method accepts only a track:

~~~ts
const job = await manager.createForPlayback(track)
expect(job.fileName).toBe('Song - Artist.flac')
~~~

Cover `download.enable=true` using the configured filename/grouping/metadata settings and `download.enable=false` using the corresponding values from `defaultSetting`. In both cases assert the destination remains under the Service audio root, no list directory is inferred without a list ID, and a valid existing file is skipped even when `download.skipExistFile=false`.

- [ ] **Step 2: Add failing quality and concurrent-creation tests**

Give the track advertised `flac24bit`, `flac`, `320k`, and `128k` qualities. Make resolution fail for the first two and succeed for `320k`, then assert exact attempt order:

~~~ts
expect(attemptedQualities).toEqual(['flac24bit', 'flac', '320k'])
~~~

Gate `findExistingFile` with a deferred promise and call `createForPlayback(track)` twice concurrently. Assert both calls return the same ID and only one record exists after the gate opens. This must fail against the current check-then-insert race.

- [ ] **Step 3: Add failing actual-file and integrity tests**

Use `src/renderer/assets/medias/Silence02s.mp3` as the parseable audio fixture rather than arbitrary bytes. Cover:

- completed database record plus deleted final file creates a fresh task;
- a moved valid file is found and adopted at its actual path;
- a known completed file whose bytes no longer match retained size/SHA-256 is rejected;
- an invalid manually named `.mp3` with no database row is rejected;
- the invalid original remains byte-for-byte unchanged while the replacement receives a collision-safe sibling filename;
- a valid actual file with no database row is adopted and prevents transfer.

- [ ] **Step 4: Run the focused tests and verify the new cases fail**

~~~bash
npx vitest run src/server/downloads/downloads.test.ts
~~~

Expected: failures for the missing entrypoint, disabled-feature defaults, concurrent race, final integrity, and invalid-audio filtering.

- [ ] **Step 5: Add persisted final integrity and scanner validation**

Extend the record without exposing absolute paths:

~~~ts
export interface DownloadFileIntegrity {
  size: number
  sha256: string
}

finalIntegrity?: DownloadFileIntegrity
~~~

Add `finalIntegrity` to `DownloadJobRecord`. Compute it only after metadata writing completes, so it describes the published user-visible bytes. Compute it as well when adopting a parseable actual file. Retain it across restart and relocated-file adoption only when the actual bytes match. Expose `expectedIntegrity(filePath)` by resolving completed record paths inside the audio root.

Update `LibraryScanner` with an optional integrity lookup callback. On every changed filesystem signature, reject zero-length/unparseable supported extensions. When expected integrity exists, require both size and SHA-256 to match. Do not delete or rename rejected files. Existing tests that intentionally need valid audio must use the checked-in silence fixture.

- [ ] **Step 6: Implement one authoritative playback-download entrypoint**

Add this exact public boundary:

~~~ts
async createForPlayback(
  musicInfo: TuneFlow.Music.MusicInfoOnline,
): Promise<DownloadDto>
~~~

It must select effective download settings internally, request `QUALITYS[0]`, use `qualityPolicy: 'highest'`, force `skipExisting: true`, and omit `listId`. Extract `effectiveSettings()` and use it consistently for filename/grouping, concurrency, fallback filename extension, and metadata. When `download.enable=false`, replace every `download.*` policy value with `defaultSetting` while preserving the Service audio root invariant.

Serialize the complete existing-file-check plus record-insert critical section by `source + id`. Concurrent callers await the same promise and the entry is removed in `finally`; this is manager-owned synchronization, not a second playback-policy cache.

- [ ] **Step 7: Run download and library regression tests**

~~~bash
npx vitest run src/server/downloads/downloads.test.ts src/server/playback/proxy.test.ts
~~~

Expected: all quality fallback, publication recovery, actual-file, integrity, and concurrent de-duplication tests pass.

- [ ] **Step 8: Review the task diff without staging**

~~~bash
git diff --check -- src/server/downloads/types.ts src/server/downloads/manager.ts src/server/downloads/downloads.test.ts src/server/library/scanner.ts
~~~

Expected: no whitespace errors. Do not commit.

---

### Task 3: Expose start/end/list APIs and trigger the download module

**Files:**
- Modify: src/server/routes/playbackHistory.ts
- Modify: src/server/app.ts
- Modify: src/server/app.test.ts
- Modify: src/server/api/openapi.test.ts

**Interfaces:**
- Consumes: PlaybackHistoryRepository.start/end/list, SettingsRepository.getSettings(), and `DownloadManager.createForPlayback(musicInfo)`.
- Produces: POST and GET /api/v1/playback/history plus PATCH /api/v1/playback/history/{playbackId}.

- [ ] **Step 1: Write failing HTTP and OpenAPI tests**

Start the same track twice and assert distinct IDs, then end one:

~~~ts
const started = await app.inject({
  method: 'POST',
  url: '/api/v1/playback/history',
  payload: { track, platform: 'web' },
})
const playbackId = started.json().data.playbackId

const ended = await app.inject({
  method: 'PATCH',
  url: '/api/v1/playback/history/' + encodeURIComponent(playbackId),
  payload: {
    completed: true,
    lastPositionSeconds: 180,
    durationSeconds: 180,
  },
})
expect(ended.json().data).toMatchObject({ playbackId, completed: true })
~~~

Add unsupported-platform and negative-number rejection, unknown-ID 404, repeated-end idempotency, 30-day list behavior, and restart persistence. Update OpenAPI expected paths and required request/response properties.

Add integration cases that toggle `player.autoDownloadOnPlay` through settings, post a successful start, flush queued async work, and assert exactly one download when enabled and none when disabled or source is local. Set `download.enable=false` in the enabled-auto-download case and assert the resulting task uses default naming. Spy on `createForPlayback` and assert its only argument is the track snapshot.

- [ ] **Step 2: Run focused API tests and verify failure**

~~~bash
npx vitest run src/server/app.test.ts src/server/api/openapi.test.ts
~~~

Expected: failures on the new request, response, PATCH route, and Service-owned download policy.

- [ ] **Step 3: Implement TypeBox schemas and a narrow route options boundary**

~~~ts
interface PlaybackHistoryRouteOptions {
  history: PlaybackHistoryRepository
  onStarted?: (session: PlaybackSession) => void | Promise<void>
}

export const registerPlaybackHistoryRoutes = (
  app: ApiFastifyInstance,
  options: PlaybackHistoryRouteOptions,
): void => {
  // GET, POST, PATCH
}
~~~

Use a TypeBox literal union for platforms, non-negative number schemas, and strict ID params. POST must persist before invoking onStarted. Invoke the callback as a caught, unawaited promise. PATCH returns ApiError(404, 'NOT_FOUND', ...) for an unknown ID.

- [ ] **Step 4: Wire global save-while-listening in createServer**

Register with an injected callback:

~~~ts
registerPlaybackHistoryRoutes(app, {
  history: playbackHistory,
  onStarted: async session => {
    if (!settings.getSettings()['player.autoDownloadOnPlay']) return
    if (session.track.source === 'local') return
    await downloads.createForPlayback(session.track)
  },
})
~~~

Catch and log callback failures at the route boundary. Do not add quality, path, filename, list, or skip policy to this callback; all such decisions belong to `createForPlayback`.

Wire the scanner's optional expected-integrity lookup through a closure assigned after `DownloadManager` construction. The initial startup scan may validate parseability without database integrity; every matching/local-first refresh after construction must also consult `downloads.expectedIntegrity(filePath)`.

- [ ] **Step 5: Run API, OpenAPI, and download tests**

~~~bash
npx vitest run src/server/app.test.ts src/server/api/openapi.test.ts src/server/downloads/downloads.test.ts
~~~

Expected: all pass.

- [ ] **Step 6: Review the task diff without staging**

Run git diff --check on the four files. Do not commit.

---

### Task 4: Make playback resolution Service-local-first

**Files:**
- Modify: src/server/playback/resolver.ts
- Modify: src/server/playback/proxy.test.ts
- Modify: src/renderer/core/music/online.ts

**Interfaces:**
- Consumes: existing findLocal(musicInfo) and preferLocal compatibility input.
- Produces: omitted/default and first-party resolve calls prefer Service-local media; provider and alternative fallbacks remain intact.

- [ ] **Step 1: Add failing resolver tests**

Assert that omitted preferLocal checks local first and does not call the source when a local match exists. Add no-local coverage proving original provider resolution still runs and existing alternative-provider fallback still works.

- [ ] **Step 2: Run resolver tests and verify the default-local case fails**

~~~bash
npx vitest run src/server/playback/proxy.test.ts
~~~

- [ ] **Step 3: Implement local-first default and explicit Web intent**

~~~ts
if (input.preferLocal !== false) {
  const localUrl = await this.findLocal?.(originalMusicInfo(input.info))
  if (localUrl != null) {
    return this.createResolvedTrack({ url: localUrl }, input.quality)
  }
}
~~~

Change the first-party Web resolve body to send preferLocal: true for normal resolution and retry. When no local file exists, retry still refreshes the online stream.

- [ ] **Step 4: Run resolver and renderer runtime tests**

~~~bash
npx vitest run src/server/playback/proxy.test.ts src/renderer/core/music/runtime.test.ts
~~~

Expected: local-first, online fallback, alternative fallback, and renderer runtime tests pass.

- [ ] **Step 5: Review the task diff without staging**

Run git diff --check on the three files. Do not commit.

---

### Task 5: Integrate playback sessions into the Docker Web player

**Files:**
- Create: src/renderer/core/useApp/usePlayer/playbackSession.ts
- Create: src/renderer/core/useApp/usePlayer/playbackSession.test.ts
- Create: src/renderer/core/useApp/usePlayer/usePlaybackSession.ts
- Modify: src/renderer/core/useApp/usePlayer/usePlayer.ts
- Delete: src/renderer/core/useApp/usePlayer/useAutoDownload.ts
- Modify: tests/e2e/play-search-download.spec.ts when it is the narrowest existing fixture.

**Interfaces:**
- Consumes: player events, playMusicInfo.musicInfo, getCurrentTime(), getDuration(), and same-origin fetch.
- Produces: one active logical Web playback session with platform web.

- [ ] **Step 1: Write failing pure state-machine tests**

~~~ts
const manager = createPlaybackSessionManager({
  start: async track => session('play-1', track),
  end: async(playbackId, terminal) => {
    ends.push({ playbackId, terminal })
  },
})

await manager.started(track)
await manager.interrupted({ position: 12, duration: 100 })
expect(ends).toEqual([{
  playbackId: 'play-1',
  terminal: {
    completed: false,
    lastPositionSeconds: 12,
    durationSeconds: 100,
  },
}])
~~~

Add natural completion, duplicate playerPlaying, pause/resume, technical reload, start failure, terminal failure, and a different track after interruption.

- [ ] **Step 2: Run the test and verify module-not-found failure**

~~~bash
npx vitest run src/renderer/core/useApp/usePlayer/playbackSession.test.ts
~~~

- [ ] **Step 3: Implement the request adapter and state machine**

~~~ts
export interface PlaybackSessionManager {
  started(track: TuneFlow.Music.MusicInfo): Promise<void>
  completed(progress: PlaybackProgress): Promise<void>
  interrupted(progress: PlaybackProgress): Promise<void>
  technicalReload(): void
  dispose(progress: PlaybackProgress): void
}
~~~

started creates only when no logical session is active. completed and interrupted detach the current ID before awaiting PATCH, preventing duplicate ends. All request failures are caught and logged. dispose uses a PATCH fetch with keepalive enabled; do not use sendBeacon because it cannot preserve the PATCH method required by the frozen endpoint.

- [ ] **Step 4: Wire actual Web events**

Install usePlaybackSession() from usePlayer.ts. The hook must:

- create on playerPlaying with the current track;
- complete on playerEnded before the existing handler advances the queue;
- interrupt on a different-track musicToggled and on stop/queue clearing;
- ignore pause and buffering;
- retain the session across stream retry and quality reload;
- read current time and duration at terminal events;
- best-effort interrupt during page teardown.

Remove useAutoDownload() from usePlayer.ts and delete its file.

- [ ] **Step 5: Run Web tests and lint changed renderer files**

~~~bash
npx vitest run src/renderer/core/useApp/usePlayer/playbackSession.test.ts src/renderer/core/music/runtime.test.ts
npx eslint src/renderer/core/useApp/usePlayer/playbackSession.ts src/renderer/core/useApp/usePlayer/playbackSession.test.ts src/renderer/core/useApp/usePlayer/usePlaybackSession.ts src/renderer/core/useApp/usePlayer/usePlayer.ts src/renderer/core/music/online.ts
~~~

Expected: pass with no ESLint errors.

- [ ] **Step 6: Extend and run one focused Web E2E flow**

Assert successful playback creates a web session, switching ends it incomplete, and enabled Service auto-download creates one task.

~~~bash
npx playwright test tests/e2e/play-search-download.spec.ts
~~~

Expected: pass.

- [ ] **Step 7: Review the task diff without staging**

Run git diff --check on the renderer and E2E files. Do not commit.

---

### Task 6: Freeze and verify the Service/Web contract

**Files:**
- Modify only if verification exposes a defect: files from Tasks 1–5.
- Read: docs/superpowers/specs/2026-08-14-server-owned-playback-history-design.md

**Interfaces:**
- Consumes: all Service/Web deliverables.
- Produces: a frozen contract for Docker deployment and Flutter.

- [ ] **Step 1: Run the focused integrated test set**

~~~bash
npx vitest run \
  src/server/playback/historyRepository.test.ts \
  src/server/playback/historyTrack.test.ts \
  src/server/playback/proxy.test.ts \
  src/server/app.test.ts \
  src/server/api/openapi.test.ts \
  src/server/downloads/downloads.test.ts \
  src/renderer/core/useApp/usePlayer/playbackSession.test.ts \
  src/renderer/core/music/runtime.test.ts
~~~

- [ ] **Step 2: Run static and build checks**

~~~bash
npm run lint
npm run build:server
npm run build:web
~~~

If unrelated pre-existing lint failures exist, record exact files and run ESLint on all changed files. Do not edit unrelated failures.

- [ ] **Step 3: Run the focused E2E check**

~~~bash
npx playwright test tests/e2e/play-search-download.spec.ts
~~~

If browsers cannot run, record the environment failure and retain unit/integration/build evidence.

- [ ] **Step 4: Freeze the verified diff identity**

~~~bash
git diff --check
git status --short
git diff --name-only
~~~

Record changed files. Do not alter the contract afterward unless Flutter reports a reproduced incompatibility.

---

### Task 7: Implement and verify the coordinated Flutter client changes

**Files:**
- Modify: /Volumes/ext/MusicFree/flutter-client/lib/features/playback_history/playback_history_repository.dart
- Modify: /Volumes/ext/MusicFree/flutter-client/test/features/playback_history/playback_history_repository_test.dart
- Create: /Volumes/ext/MusicFree/flutter-client/lib/features/playback_history/playback_platform.dart
- Create: /Volumes/ext/MusicFree/flutter-client/test/features/playback_history/playback_platform_test.dart
- Modify: /Volumes/ext/MusicFree/flutter-client/lib/features/player/player_controller.dart
- Modify: /Volumes/ext/MusicFree/flutter-client/test/features/player/player_controller_test.dart
- Modify: /Volumes/ext/MusicFree/flutter-client/lib/features/player/playback_repository.dart
- Modify: /Volumes/ext/MusicFree/flutter-client/test/features/player/playback_repository_test.dart
- Modify: /Volumes/ext/MusicFree/flutter-client/lib/app/player_providers.dart

**Interfaces:**
- Consumes: frozen POST/PATCH/GET contract and lifecycle rules.
- Produces: `PlaybackSessionPort.start/end`, runtime platform mapping, one active logical session in `PlayerController`, and explicit `preferLocal:true`; Flutter never calls a Service download endpoint.

- [ ] **Step 1: Snapshot Flutter scope and write failing repository/platform tests**

Read the Flutter repository's applicable instructions and preserve its existing dirty files. Record `git status --short` before editing. Define these exact boundaries:

~~~dart
abstract interface class PlaybackSessionPort {
  Future<String> start(Track track);
  Future<void> end(
    String playbackId, {
    required bool completed,
    required Duration position,
    required Duration duration,
  });
}

String playbackPlatformFor({
  required bool isWeb,
  required TargetPlatform platform,
})

String currentPlaybackPlatform()
~~~

Assert POST sends only `{track, platform}` and returns `playbackId`; PATCH sends completed and second values; GET maps `startedAt` to the existing UI-facing `playedAt` property. Test `playbackPlatformFor` by mapping `kIsWeb` to `web`, the five supported native targets to their lowercase values, and any remaining target to `other`; `currentPlaybackPlatform` delegates with the runtime values.

- [ ] **Step 2: Run repository/platform tests and verify failure**

~~~bash
flutter test test/features/playback_history/playback_history_repository_test.dart test/features/playback_history/playback_platform_test.dart
~~~

Expected: failure because playback IDs, terminal PATCH, session DTOs, and platform mapping do not exist.

- [ ] **Step 3: Implement repository and platform mapping**

`PlaybackHistoryRepository` implements `PlaybackSessionPort`, owns its `platform` value, validates non-empty returned IDs, and converts `Duration` to finite non-negative seconds. Keep malformed GET entries isolated. Do not add any download method or fields.

- [ ] **Step 4: Add failing player lifecycle and local-first tests**

Cover cached and online successful starts, failed cache followed by online success, total startup failure, natural completion before automatic next, interruption before next/previous/direct selection/stop/queue clear/current-item removal, pause/resume, quality reload, stream-expiry retry, repeat-one, reporting failures, and dispose best-effort interruption. Assert one retained ID per logical play and position/duration values from the latest snapshot.

In `playback_repository_test.dart`, assert every resolve request contains `preferLocal: true` and still rejects unsafe returned URLs.

- [ ] **Step 5: Run focused player tests and verify failure**

~~~bash
flutter test test/features/player/player_controller_test.dart test/features/player/playback_repository_test.dart
~~~

Expected: lifecycle assertions fail against the current fire-and-forget start-only callback and missing `preferLocal` field.

- [ ] **Step 6: Implement the Flutter session state machine**

Inject `PlaybackSessionPort? sessions` into `PlayerController`. After `playCachedTrack` or `playTrack` succeeds, best-effort await `sessions.start(track)` only for a new logical play and retain the returned ID. Detach the ID before awaiting a terminal report so duplicate terminal events cannot end twice.

Natural completion ends with `completed=true` before repeat/next. User replacement, current-item removal, stop, and queue clear end with `completed=false` before changing the logical current track. Pause/resume, quality reload, and expired-stream retry retain the ID. Repeat-one ends the old session and starts a new one. Synchronous or asynchronous reporting errors are swallowed after becoming observable through the existing diagnostics, and never alter player state.

Update `player_providers.dart` to inject `PlaybackHistoryRepository(connected.api, platform: currentPlaybackPlatform())`. Add `preferLocal: true` to `PlaybackRepository.resolve`. Do not read the save-while-listening setting in the player and do not call `/api/v1/downloads`.

- [ ] **Step 7: Run focused Flutter verification**

Run:

~~~bash
flutter test test/features/playback_history/playback_history_repository_test.dart test/features/playback_history/playback_platform_test.dart test/features/player/player_controller_test.dart test/features/player/playback_repository_test.dart
flutter analyze
~~~

If analyze reports unrelated pre-existing failures, record exact files and run `dart analyze` on every changed Dart file. Run `dart format --output=none --set-exit-if-changed` on the changed Dart files, then `git diff --check` and `git status --short`. Do not touch unrelated Flutter changes.

---

### Task 8: Deploy the frozen workspace and run live Service/Flutter fault tests

**Files:**
- Read: Dockerfile, docker-compose.yml or compose.yaml when present, .dockerignore, package.json, and deployment documentation.
- Remote target: the already authorized Docker host at 192.168.0.172.
- Persistent data: reuse the active container's exact volume or bind mount; never create a clean store.

**Interfaces:**
- Consumes: frozen Service/Web workspace manifest, verified Flutter build, existing container runtime contract, and test-created online tracks/files.
- Produces: active healthy candidate deployment, preserved rollback container/image/data attachment, installed Flutter client where a compatible device is available, and positive/negative live evidence.

- [ ] **Step 1: Freeze and validate deployment inputs**

Use workspace source mode because the approved implementation is uncommitted. Record the complete `git ls-files -co --exclude-standard -z` manifest with path, mode, symlink target, and SHA-256; derive a `.dockerignore`-filtered build-context manifest. Reject credentials, `.git`, local data, caches, build output, fault-test files, or unrelated Flutter files in the archive. Recompute manifests after packaging and require the workspace identity to be unchanged.

- [ ] **Step 2: Run read-only target preflight**

Using the deployment skill's password helper with credentials only in process environment, inspect architecture, Docker version, free space, port ownership, active container/image, restart policy, runtime user, environment names, health check, port binding, and every mount. Record the rollback image/container identity and require the current persistent data attachment to match the established deployment.

- [ ] **Step 3: Build and verify a uniquely tagged candidate**

Upload only the hashed frozen context, verify its SHA-256 remotely, extract into a new mode-0700 temporary directory, and build without stopping the active container. Inspect architecture, entrypoint, command, exposed port, health check, runtime user, and runtime-only contents. Run the narrowest isolated candidate health probe supported by the image.

- [ ] **Step 4: Switch with automatic rollback containment**

Stop and rename the active container to a timestamped rollback name only after candidate verification. Start the candidate with the exact prior port, restart policy, environment names, security options, and persistent mount. On creation/start/health failure, capture bounded logs, remove only the failed candidate, restore the rollback container name, restart it, and verify rollback health.

- [ ] **Step 5: Verify deployment health twice**

Require `running`, configured health `healthy`, `RestartCount=0`, candidate image ID match, exact port/mount/restart/user contract, successful `/api/v1/health`, and no startup-fatal bounded log entries on two condition-based checks. Preserve the rollback container/image/data attachment.

- [ ] **Step 6: Run live positive save-while-listening tests**

Create uniquely identifiable test tracks and snapshot baseline settings, download rows, library entries, and audio files. Verify:

- setting off plus successful Web playback creates a session but no download;
- setting on plus `download.enable=false` creates exactly one default-config task from the session start;
- setting on plus configured download settings follows those rules;
- two simultaneous start reports for the same track create one task;
- a valid actual file skips transfer even without a matching database row;
- a Flutter device-cache start reports a session and causes the Service-owned download without a Flutter download request;
- the client setting can turn the global switch off and on.

Where the active source advertises multiple qualities, capture resolution attempts proving highest-to-lower fallback. If the source cannot deterministically force a higher-quality failure, retain the deterministic manager test as proof and report the live limitation rather than manipulating a real provider.

- [ ] **Step 7: Run live abnormal filesystem and playback tests**

Use only test-created media. Record each exact path, size, and SHA-256 before mutation. Verify:

- deleting a completed test file makes the next start download again despite its database row;
- moving a valid test file within the scanned audio root makes the Service find/adopt the actual path;
- damaging a copied test file makes local-first and skip-existing reject it, preserves its damaged bytes, and downloads a collision-safe replacement;
- an invalid manually named audio extension is not treated as playable/downloaded;
- when online resolution fails but a valid local file exists, playback resolves to the local library stream first;
- when neither valid local media nor online resolution succeeds, playback fails cleanly while history/download scheduling errors remain non-fatal;
- after every fault, the container remains healthy with `RestartCount=0`.

- [ ] **Step 8: Build, install, and run Flutter integration checks**

Run `flutter devices`, select an already authorized compatible device, build the appropriate debug artifact, install it, connect to the deployed Service, toggle save-while-listening, and exercise cached plus streamed starts and terminal events. Capture Service API/download evidence rather than relying only on visible UI state. If no compatible device is available, run the verified Flutter tests/build and report installation as the only blocked portion; do not substitute an unrequested target.

- [ ] **Step 9: Restore test state and remove only exact artifacts**

Restore the baseline settings. Remove download records through the API by exact captured IDs. Remove playback rows by exact captured `playback_id` values in one bounded SQLite transaction because the API has no delete route; never delete by date, wildcard, or broad source. Remove only files created by the unique test identities after verifying their canonical paths remain inside the audio root. Refresh the library and prove baseline user file count/bytes plus all non-test records are unchanged. Remove uploaded archive/extraction directory and clear credential environment. Keep the active and rollback deployment artifacts.

---

### Task 9: Final cross-repository handoff

**Files:**
- No new files unless a verified contract correction requires updating the spec and plan.

**Interfaces:**
- Consumes: frozen Service/Web evidence, Flutter verification, deployment identity, and cleaned live-test evidence.
- Produces: one handoff separating repository results and residual risks.

- [ ] **Step 1: Confirm no late Service changes invalidated verification**

Compare git diff --name-only with the frozen list. Rerun only checks affected by a coordinated correction.

- [ ] **Step 2: Report outcomes and residual risk**

State Service database/API/local-first/auto-download changes, download integrity behavior, Docker Web lifecycle behavior, Flutter implementation result, exact verification commands, deployed and rollback image/container identities, live fault-test results, cleanup evidence, E2E status, and both repositories' uncommitted state.

Explicitly retain these limitations: process death may leave endedAt null, and exact active-listening seconds are not recorded.

- [ ] **Step 3: Leave all work uncommitted**

Do not stage, commit, push, or publish. Do not remove the preserved rollback deployment without separate authorization.
