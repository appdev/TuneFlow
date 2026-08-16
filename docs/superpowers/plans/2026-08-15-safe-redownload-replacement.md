# Safe Redownload Replacement Implementation Plan

> **For agentic workers:** Use the global workflow skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should workflow return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add explicit, crash-safe redownload replacement across the Service, hosted Web, and Flutter clients while preserving same-source-complete multi-source metadata preference.

**Architecture:** Keep the Service authoritative for existing-file detection through an explicit create policy and a 409 confirmation handshake. Evaluate sources once, bind validated resources to each audio candidate, prepare replacement audio and sidecars entirely in staging, and publish through a recoverable replacement transaction that never removes the old file before the new file is durable. Hosted Web and Flutter share semantic download coordinators; Flutter presentation consumes its in-progress dialog-system abstraction without defining new visual styling here.

**Tech Stack:** Node.js 24, TypeScript 5.9, Fastify 5, SQLite/better-sqlite3, Vitest 4, Vue 3, Flutter/Dart 3.9, http, shadcn_ui, and the Flutter client's shared dialog system.

## Global Constraints

- The authoritative design is docs/superpowers/specs/2026-08-15-safe-redownload-replacement-design.md.
- A replacement must not mutate, rename, retag, or delete the original before staged audio and configured metadata succeed.
- Same-format success atomically replaces the original path; cross-format success publishes the new path before retiring the old path.
- Audio candidates never share partial bytes; each candidate starts at byte zero after fallback.
- The audio candidate that completes the full transfer owns preferred lyrics and artwork; mix only its missing components.
- Explicit existingFilePolicy overrides skipExisting and download.skipExistFile; absent policy preserves legacy behavior.
- Playback-triggered automatic saves use reuse and never request confirmation.
- Public DTOs, errors, events, and logs never expose filesystem paths, resolved media URLs, headers, cookies, scripts, lyric bodies, or artwork bytes.
- Hosted Web uses the message 重新下载成功后将替换现有文件。 with 取消 and 确定.
- Flutter visual presentation is owned by the active dialog-system redesign. Do not overwrite or discard its uncommitted files, goldens, or component work.
- Preserve unrelated dirty-worktree changes in both repositories.
- Do not update Flutter visual goldens for this semantic integration.
- Commit steps run only when commit authorization exists.

## File and Responsibility Map

Service and hosted Web repository: /Volumes/ext/lx-music-server-web

- src/server/playback/bundleResolver.ts and its test: shared source evaluation plus candidate-scoped download assembly.
- src/server/downloads/types.ts: request policy, candidate-scoped resources, and persisted replacement state.
- src/server/downloads/metadata.ts: metadata and sidecar staging.
- src/server/downloads/replacementPublisher.ts and its test: file-only publish and crash recovery.
- src/server/downloads/manager.ts and downloads.test.ts: policy, coalescing, transfer, staging, recovery, and record reconciliation.
- src/server/routes/downloads.ts, app.ts, app.test.ts, and api/openapi.test.ts: production contract and wiring.
- src/renderer/store/download/userDownload.ts and its test: hosted-Web conflict handshake.
- src/renderer/store/download/action.ts and common download modals: Service transport, coordinator integration, and confirmation.
- src/lang/*.json and docs/server-web.md: copy and public behavior.

Flutter repository: /Volumes/ext/MusicFree/flutter-client

- lib/features/downloads/download_repository.dart: typed request policy.
- lib/features/downloads/user_download_coordinator.dart: presentation-independent conflict handshake.
- lib/features/downloads/redownload_confirmation.dart: stable adapter boundary for the active dialog redesign.
- search, album, online-playlist, and player-provider call sites: use the semantic coordinator.
- focused repository, coordinator, screen, and player tests: request order and confirmation behavior.

---

### Task 1: Assemble Candidate-Scoped Multi-Source Download Bundles

**Files:**
- Modify: src/server/playback/bundleResolver.ts
- Modify: src/server/playback/bundleResolver.test.ts

**Interfaces:**
- Consumes: EvaluatedSource, PlaybackResources, StreamCandidate, configured priority, hedge delay, and enrichment budget.
- Produces: ResolvedBundleDownloadCandidate and PlaybackBundle.downloadCandidates; public playback JSON remains unchanged.

- [ ] **Step 1: Write failing tests for per-candidate ownership**

Add tests equivalent to:

~~~ts
expect(bundle.downloadCandidates).toMatchObject([
  {
    sourceId: 'a',
    completeness: 'complete',
    sourceIds: { audio: 'a', lyrics: 'a', picture: 'a' },
    resources: { lyrics: { lyric: '[00:00]a' }, pictureUrl: expect.any(String) },
  },
  {
    sourceId: 'b',
    completeness: 'complete',
    sourceIds: { audio: 'b', lyrics: 'b', picture: 'b' },
    resources: { lyrics: { lyric: '[00:00]b' }, pictureUrl: expect.any(String) },
  },
])
~~~

Add a mixed case where B owns audio and lyrics but receives only its missing picture from C. Add a gate-based test proving one source starts musicUrl, lyric, and pic work before any of the three resolves.

- [ ] **Step 2: Run the focused tests and confirm failure**

~~~bash
npx vitest run src/server/playback/bundleResolver.test.ts -t "download candidate|concurrently"
~~~

Expected: FAIL because the bundle has one global resource set and source evaluation awaits audio before enrichment.

- [ ] **Step 3: Define the internal candidate type**

~~~ts
export interface ResolvedBundleDownloadCandidate extends StreamCandidate {
  resources: PlaybackResources
  completeness: BundleCompleteness
  sourceIds: { audio: string, lyrics?: string, picture?: string }
}

export interface PlaybackBundle {
  // existing fields
  downloadCandidates: ResolvedBundleDownloadCandidate[]
}
~~~

Local playback returns an empty candidate list. PlaybackResolver must ignore this internal field.

- [ ] **Step 4: Start one source's actions concurrently**

Extract readAudio and start audio, lyrics, and artwork together with Promise.allSettled. Publish every fulfilled component into the retained EvaluatedSource. Preserve caller cancellation and trusted terminal error behavior.

~~~ts
const actions = [
  includeAudio && can('musicUrl') ? this.readAudio(candidate, provider, info, quality, audioSignal) : undefined,
  wantedResources.has('lyric') && can('lyric') ? this.readLyrics(candidate.id, provider, info, enrichmentSignal) : undefined,
  wantedResources.has('pic') && can('pic') ? this.readPicture(candidate.id, provider, info, enrichmentSignal) : undefined,
]
~~~

- [ ] **Step 5: Assemble candidate resources**

Add:

~~~ts
private candidateResources(
  audioOwner: EvaluatedSource,
  ordered: EvaluatedSource[],
): ResolvedBundleDownloadCandidate
~~~

Choose audioOwner lyrics and picture first; fill each missing component from the first validated ordered fallback. Compute candidate-specific sourceIds and completeness. Put the playback-selected audio first and remaining usable audio in configured order.

- [ ] **Step 6: Verify the full resolver**

~~~bash
npx vitest run src/server/playback/bundleResolver.test.ts
npx eslint src/server/playback/bundleResolver.ts src/server/playback/bundleResolver.test.ts
~~~

Expected: PASS, including existing complete, mixed, audio-only, local, budget, cancellation, and safe-diagnostic cases.

- [ ] **Step 7: Commit when authorized**

~~~bash
git add src/server/playback/bundleResolver.ts src/server/playback/bundleResolver.test.ts
git commit -m "fix(playback): bind resources to download candidates"
~~~

### Task 2: Use the Successful Audio Candidate's Resources

**Files:**
- Modify: src/server/downloads/types.ts
- Modify: src/server/downloads/manager.ts
- Modify: src/server/downloads/downloads.test.ts
- Modify: src/server/app.ts

**Interfaces:**
- Consumes: PlaybackBundle.downloadCandidates from Task 1.
- Produces: ResolvedDownloadCandidate resources retained only after that candidate passes full transfer and parsing.

- [ ] **Step 1: Write a failing A-to-B transfer test**

Make A pass resolution/probe but disconnect during full transfer. Make B complete. Give A and B distinct lyrics and picture bytes. Assert metadata receives only B resources.

~~~ts
expect(metadata).toHaveBeenCalledWith(
  expect.any(String),
  expect.anything(),
  expect.anything(),
  expect.objectContaining({ lyrics: { lyric: '[00:00]b' } }),
)
~~~

- [ ] **Step 2: Confirm the current global-resource behavior fails**

~~~bash
npx vitest run src/server/downloads/downloads.test.ts -t "successful candidate resources"
~~~

Expected: FAIL because manager stores resolved.resources rather than candidate.resources.

- [ ] **Step 3: Replace the resolved-download contract**

~~~ts
export interface ResolvedDownloadResources {
  pictureBytes?: Uint8Array
  pictureMimeType?: string
  lyrics?: TuneFlow.Music.LyricInfo
}

export interface ResolvedDownloadCandidate {
  sourceId: string
  url: string
  headers?: Record<string, string>
  resources?: ResolvedDownloadResources
}

export interface ResolvedDownload {
  candidates: ResolvedDownloadCandidate[]
}
~~~

Update all internal fixtures in the same task; remove legacy top-level URL and resources only after every caller is migrated.

- [ ] **Step 4: Map every bundle candidate in app.ts**

Resolve each candidate's opaque picture token to bytes and attach that candidate's lyrics. Never persist candidate URL, headers, tokens, or bodies.

- [ ] **Step 5: Retain resources after successful transfer**

~~~ts
await this.transfer(record, candidate, controller.signal, false)
await this.requireParseableAudio(record)
this.resolvedResources.set(record.id, candidate.resources)
transferred = true
~~~

On failure, remove .part and clear progress/validators before trying the next candidate at zero.

- [ ] **Step 6: Verify manager and composition wiring**

~~~bash
npx vitest run src/server/downloads/downloads.test.ts src/server/playback/bundleResolver.test.ts src/server/app.test.ts
npx eslint src/server/downloads/types.ts src/server/downloads/manager.ts src/server/downloads/downloads.test.ts src/server/app.ts
~~~

Expected: PASS, including B-owned metadata and existing byte-zero fallback.

- [ ] **Step 7: Commit when authorized**

~~~bash
git add src/server/downloads/types.ts src/server/downloads/manager.ts src/server/downloads/downloads.test.ts src/server/app.ts
git commit -m "fix(downloads): retain successful candidate resources"
~~~

### Task 3: Build the Recoverable Replacement Publisher

**Files:**
- Create: src/server/downloads/replacementPublisher.ts
- Create: src/server/downloads/replacementPublisher.test.ts
- Modify: src/server/downloads/types.ts
- Modify: src/server/downloads/metadata.ts
- Modify: src/server/downloads/downloads.test.ts

**Interfaces:**
- Consumes: Service-validated paths plus original/replacement integrity and optional staged LRC.
- Produces: deterministic publish and recover transitions without database or network dependencies.

- [ ] **Step 1: Write failing file-state tests**

Cover same-format replacement, cross-format publication, unrelated destination collision, original mutation, and these checkpoints:

~~~ts
const checkpoints = [
  'after-prepared',
  'after-audio-rename',
  'after-published',
  'after-original-retire',
] as const
~~~

At each checkpoint assert at least one integrity-valid audio exists, reconstruct the publisher, call recover, and assert convergence to replacement only.

- [ ] **Step 2: Confirm the module is absent**

~~~bash
npx vitest run src/server/downloads/replacementPublisher.test.ts
~~~

Expected: FAIL because the publisher and transaction types do not exist.

- [ ] **Step 3: Define persisted state**

~~~ts
export interface DownloadReplacementState {
  originalRelativePath: string
  originalIntegrity: DownloadFileIntegrity
  previousDownloadIds: string[]
  phase: 'downloading' | 'prepared' | 'published' | 'retired'
  replacementIntegrity?: DownloadFileIntegrity
  stagedLyricRelativePath?: string
  finalLyricRelativePath?: string
}
~~~

- [ ] **Step 4: Add caller-selected lyric staging**

Extend MetadataDependencies with lyricFilePath. Use that path for writeFile when supplied; ordinary downloads retain their derived final LRC path. Add a test proving replacement metadata writes only staging audio/LRC.

- [ ] **Step 5: Implement the publisher**

Export:

~~~ts
export class ReplacementConflictError extends Error {
  readonly code = 'DOWNLOAD_REPLACEMENT_CONFLICT'
}

export interface ReplacementPublicationInput {
  originalPath: string
  preparedPath: string
  finalPath: string
  originalIntegrity: DownloadFileIntegrity
  replacementIntegrity: DownloadFileIntegrity
  stagedLyricPath?: string
  finalLyricPath?: string
  phase: DownloadReplacementState['phase']
}

export class ReplacementPublisher {
  publish(input: ReplacementPublicationInput): DownloadReplacementState['phase']
  recover(input: ReplacementPublicationInput): DownloadReplacementState['phase']
}
~~~

Use hash comparisons, renameSync, directory fsync, and explicit phase callbacks. Same-path publication renames over the verified original. Cross-format publication renames new audio first, records published, then removes the still-verified original and old sidecar. Any file state matching neither persisted integrity is a conflict.

- [ ] **Step 6: Verify publisher and metadata behavior**

~~~bash
npx vitest run src/server/downloads/replacementPublisher.test.ts src/server/downloads/downloads.test.ts -t "replacement|metadata|publication|crash"
npx eslint src/server/downloads/replacementPublisher.ts src/server/downloads/replacementPublisher.test.ts src/server/downloads/types.ts src/server/downloads/metadata.ts
~~~

Expected: PASS without changing ordinary metadata-warning behavior.

- [ ] **Step 7: Commit when authorized**

~~~bash
git add src/server/downloads/replacementPublisher.ts src/server/downloads/replacementPublisher.test.ts src/server/downloads/types.ts src/server/downloads/metadata.ts src/server/downloads/downloads.test.ts
git commit -m "feat(downloads): add recoverable replacement publisher"
~~~

### Task 4: Integrate Existing-File Policies and Replacement Jobs

**Files:**
- Modify: src/server/downloads/types.ts
- Modify: src/server/downloads/manager.ts
- Modify: src/server/downloads/downloads.test.ts

**Interfaces:**
- Consumes: candidate resources from Task 2 and ReplacementPublisher from Task 3.
- Produces: reuse, error, replace, and duplicate semantics; coalesced replacement tasks; canonical completed-record reconciliation.

- [ ] **Step 1: Write failing policy and lifecycle tests**

Add a table proving explicit policy wins over the setting:

~~~ts
[
  { setting: true, request: 'duplicate', result: 'waiting' },
  { setting: false, request: 'reuse', result: 'completed' },
  { setting: false, request: 'error', error: 'DOWNLOAD_ALREADY_EXISTS' },
]
~~~

Also cover replacement snapshot, two equivalent requests returning one task ID, missing original becoming a normal download, all pre-publication failures preserving the original, same-format success, cross-format success, external mutation conflict, and every crash checkpoint recovering without a second resolve.

Include a matching library file with no database row to prove error and replace use the filesystem scan rather than completed-row presence.

- [ ] **Step 2: Confirm current manager behavior fails**

~~~bash
npx vitest run src/server/downloads/downloads.test.ts -t "explicit policy|replacement|coalesces"
~~~

Expected: FAIL because only the legacy boolean path exists.

- [ ] **Step 3: Add exact policy precedence**

~~~ts
export type ExistingFilePolicy = 'reuse' | 'error' | 'replace' | 'duplicate'

const existingPolicy = (input: DownloadCreateInput, settings: TuneFlow.AppSetting): ExistingFilePolicy =>
  input.existingFilePolicy ??
  ([input.skipExisting, settings['download.skipExistFile']].includes(true) ? 'reuse' : 'duplicate')
~~~

For error, throw ApiError 409 DOWNLOAD_ALREADY_EXISTS with only fileName and extension details. Do not create a row or resolve online sources.

Change schedulePlaybackDownload to pass existingFilePolicy: 'reuse' explicitly so automatic playback saving never inherits an interactive confirmation policy.

- [ ] **Step 4: Create and coalesce replacement records**

Use normalized track identity plus real original path as the coalescing key. Persist only Service-relative original path, captured hash/size, and exact prior completed IDs. Same-format targets the original name. Cross-format derives the configured name and reserves against unrelated files/records.

- [ ] **Step 5: Split preparation from publication**

Create focused methods:

~~~ts
private async prepareDownloadedFile(record: DownloadJobRecord): Promise<PreparedDownload>
private async publishOrdinary(record: DownloadJobRecord, prepared: PreparedDownload): Promise<void>
private async publishReplacement(record: DownloadJobRecord, prepared: PreparedDownload): Promise<void>
~~~

Replacement metadata runs against staged audio and staged LRC. Metadata failure becomes DOWNLOAD_REPLACEMENT_FAILED and deletes staging only. Ordinary download warning behavior stays unchanged.

- [ ] **Step 6: Enter the non-cancellable publish window**

After metadata succeeds, fsync staged files, compute post-metadata integrity, persist prepared, then call ReplacementPublisher. Ignore pause/cancel once prepared; finish or recover the short transaction.

- [ ] **Step 7: Reconcile records only after retired**

Delete superseded completed rows, complete the replacement record with final integrity, materialize library resources, refresh once, and publish one coherent snapshot. Startup recovers replacement transactions before ordinary recovery and queue pumping.

- [ ] **Step 8: Verify the full durable manager**

~~~bash
npx vitest run src/server/downloads/downloads.test.ts src/server/downloads/replacementPublisher.test.ts
npx eslint src/server/downloads/types.ts src/server/downloads/manager.ts src/server/downloads/downloads.test.ts
~~~

Expected: PASS, including legacy adoption, suffix reservation, missing-file reconciliation, ordinary recovery, and new replacement cases.

- [ ] **Step 9: Commit when authorized**

~~~bash
git add src/server/downloads/types.ts src/server/downloads/manager.ts src/server/downloads/downloads.test.ts
git commit -m "feat(downloads): replace existing audio safely"
~~~

### Task 5: Expose and Verify the Service Contract

**Files:**
- Modify: src/server/routes/downloads.ts
- Modify: src/server/api/openapi.test.ts
- Modify: src/server/app.test.ts
- Modify: docs/server-web.md

**Interfaces:**
- Consumes: DownloadCreateInput.existingFilePolicy and manager errors from Task 4.
- Produces: documented enum, 409 handshake, safe details, and compatible success responses.

- [ ] **Step 1: Write failing HTTP/OpenAPI tests**

~~~ts
expect(downloadSchema.properties.existingFilePolicy)
  .toMatchObject({ enum: ['reuse', 'error', 'replace', 'duplicate'] })

expect(conflict.statusCode).toBe(409)
expect(conflict.json()).toMatchObject({
  error: {
    code: 'DOWNLOAD_ALREADY_EXISTS',
    details: { fileName: expect.any(String), extension: expect.any(String) },
  },
})
expect(JSON.stringify(conflict.json())).not.toContain(storageRoot)
~~~

Also assert a legacy request retains setting behavior and replace returns 201.

Add safe envelopes for DOWNLOAD_REPLACEMENT_CONFLICT and DOWNLOAD_REPLACEMENT_FAILED. Assert conflict uses HTTP 409, neither response contains storageRoot, and trusted SOURCE_* failures retain their original code instead of being wrapped.

- [ ] **Step 2: Confirm schema rejection/current behavior fails**

~~~bash
npx vitest run src/server/api/openapi.test.ts src/server/app.test.ts -t "existingFilePolicy|DOWNLOAD_ALREADY_EXISTS|legacy download create"
~~~

Expected: FAIL because the schema rejects the new property.

- [ ] **Step 3: Extend the Fastify request schema**

~~~ts
existingFilePolicy: Type.Optional(Type.Union([
  Type.Literal('reuse'),
  Type.Literal('error'),
  Type.Literal('replace'),
  Type.Literal('duplicate'),
])),
~~~

Keep additionalProperties false, 201 success, and common error envelopes.

- [ ] **Step 4: Document behavior**

Document precedence, 409 confirmation, staging guarantees, same/cross-format recovery, candidate ownership, non-cancellable prepared window, and the requirement to drain active replacements before rolling back.

- [ ] **Step 5: Verify Service contract and build**

~~~bash
npx vitest run src/server/api/openapi.test.ts src/server/app.test.ts src/server/downloads/downloads.test.ts src/server/playback/bundleResolver.test.ts
npm run build:server
npx eslint src/server/routes/downloads.ts src/server/api/openapi.test.ts src/server/app.test.ts
~~~

Expected: PASS on Node 24.

- [ ] **Step 6: Commit when authorized**

~~~bash
git add src/server/routes/downloads.ts src/server/api/openapi.test.ts src/server/app.test.ts docs/server-web.md
git commit -m "feat(api): expose safe redownload policy"
~~~

### Task 6: Add the Hosted-Web Confirmation Handshake

**Files:**
- Create: src/renderer/store/download/userDownload.ts
- Create: src/renderer/store/download/userDownload.test.ts
- Modify: src/renderer/store/download/action.ts
- Modify: src/renderer/components/common/DownloadModal.vue
- Modify: src/renderer/components/common/DownloadMultipleModal.vue
- Modify: src/lang/zh-cn.json
- Modify: src/lang/zh-tw.json
- Modify: src/lang/en-us.json

**Interfaces:**
- Consumes: DOWNLOAD_ALREADY_EXISTS, existingFilePolicy, dialog.confirm, and existing reconciliation.
- Produces: one hosted-Web coordinator used by single and batch downloads.

- [ ] **Step 1: Write failing pure coordinator tests**

Use injected request and confirm functions. Cover normal success, confirm/retry, cancel, non-conflict error, and sequential batch behavior.

~~~ts
expect(requestedPolicies).toEqual(['error', 'replace'])
expect(confirm).toHaveBeenCalledWith('重新下载成功后将替换现有文件。')
~~~

Cancellation sends only error and returns no success job.

- [ ] **Step 2: Confirm the module is absent**

~~~bash
npx vitest run src/renderer/store/download/userDownload.test.ts
~~~

Expected: FAIL.

- [ ] **Step 3: Preserve structured Service errors**

~~~ts
export class ServiceDownloadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) { super(message) }
}
~~~

Parse code, message, and safe details before throwing.

- [ ] **Step 4: Implement the coordinator**

~~~ts
export const createUserDownload = async(dependencies, input) => {
  try {
    return { job: await dependencies.request({ ...input, existingFilePolicy: 'error' }), replaced: false }
  } catch (error) {
    if (!(error instanceof ServiceDownloadError) || error.code !== 'DOWNLOAD_ALREADY_EXISTS') throw error
    if (!await dependencies.confirm(window.i18n.t('download__replace_existing_tip'))) return { replaced: false }
    return { job: await dependencies.request({ ...input, existingFilePolicy: 'replace' }), replaced: true }
  }
}
~~~

The component supplies dialog.confirm with localized cancel/confirm labels.

- [ ] **Step 5: Route single and batch modals**

Single download awaits the coordinator. Batch remains sequential so prompts never stack; cancelling skips only that track. Add localized prompt and 已加入重新下载队列 feedback in Chinese, Traditional Chinese, and English.

- [ ] **Step 6: Verify hosted Web**

~~~bash
npx vitest run src/renderer/store/download/userDownload.test.ts
npx eslint src/renderer/store/download/userDownload.ts src/renderer/store/download/userDownload.test.ts src/renderer/store/download/action.ts src/renderer/components/common/DownloadModal.vue src/renderer/components/common/DownloadMultipleModal.vue
npm run build:web
~~~

Expected: PASS.

- [ ] **Step 7: Commit when authorized**

~~~bash
git add src/renderer/store/download/userDownload.ts src/renderer/store/download/userDownload.test.ts src/renderer/store/download/action.ts src/renderer/components/common/DownloadModal.vue src/renderer/components/common/DownloadMultipleModal.vue src/lang/zh-cn.json src/lang/zh-tw.json src/lang/en-us.json
git commit -m "feat(web): confirm safe redownload replacement"
~~~

### Task 7: Add the Flutter Semantic Download Coordinator

**Execution dependency:** Before editing /Volumes/ext/MusicFree/flutter-client, inspect its dirty worktree. The active dialog redesign currently owns app_action_sheet.dart, app_glass_surface.dart, player surfaces, design.md, and visual goldens. Do not execute this task while overlapping changes are unresolved. Once the redesign exposes a stable semantic Future<bool> confirmation entry, bind the adapter below without changing its geometry, colors, motion, or goldens.

**Files:**
- Modify: lib/features/downloads/download_repository.dart
- Create: lib/features/downloads/user_download_coordinator.dart
- Create: lib/features/downloads/redownload_confirmation.dart
- Modify: lib/features/search/search_screen.dart
- Modify: lib/features/discovery/album_detail_screen.dart
- Modify: lib/features/discovery/online_playlist_detail_screen.dart
- Modify: lib/app/player_providers.dart
- Create: test/features/downloads/download_repository_test.dart
- Create: test/features/downloads/user_download_coordinator_test.dart
- Modify focused search, discovery, and player tests.

**Interfaces:**
- Consumes: ServiceException, Service policy contract, and the redesigned dialog system's stable semantic confirmation function.
- Produces: ExistingFilePolicy, UserDownloadCoordinator, and RedownloadConfirmation used by every Flutter user-download entry.

- [ ] **Step 1: Write failing repository serialization tests**

~~~dart
await repository.create(
  track,
  'flac',
  existingFilePolicy: ExistingFilePolicy.replace,
);
expect(jsonDecode(request.body)['existingFilePolicy'], 'replace');
~~~

Cover all four exact wire values.

- [ ] **Step 2: Write failing coordinator tests**

~~~dart
final result = await coordinator.create(
  track,
  'flac',
  confirmReplacement: (_) async => true,
);
expect(policies, [ExistingFilePolicy.error, ExistingFilePolicy.replace]);
expect(result.replaced, isTrue);
~~~

Add normal success, cancellation, and non-conflict error. The callback receives exactly 重新下载成功后将替换现有文件。.

- [ ] **Step 3: Confirm types/coordinator are absent**

~~~bash
flutter test test/features/downloads/download_repository_test.dart test/features/downloads/user_download_coordinator_test.dart
~~~

Expected: FAIL.

- [ ] **Step 4: Implement typed repository policy**

~~~dart
enum ExistingFilePolicy {
  reuse('reuse'),
  error('error'),
  replace('replace'),
  duplicate('duplicate');

  const ExistingFilePolicy(this.wireName);
  final String wireName;
}
~~~

Add optional existingFilePolicy to DownloadRepository.create and serialize wireName only when present.

- [ ] **Step 5: Implement the semantic coordinator**

~~~dart
typedef ConfirmRedownload = Future<bool> Function(String message);

final class UserDownloadResult {
  const UserDownloadResult({this.job, required this.replaced});
  final DownloadJob? job;
  final bool replaced;
}

final class UserDownloadCoordinator {
  const UserDownloadCoordinator(this.repository);
  final DownloadRepository repository;

  Future<UserDownloadResult> create(
    Track track,
    String quality, {
    Object? qualityList,
    String? listId,
    required ConfirmRedownload confirmReplacement,
  }) async {
    try {
      final job = await repository.create(
        track,
        quality,
        qualityList: qualityList,
        listId: listId,
        existingFilePolicy: ExistingFilePolicy.error,
      );
      return UserDownloadResult(job: job, replaced: false);
    } on ServiceException catch (error) {
      if (error.code != 'DOWNLOAD_ALREADY_EXISTS') rethrow;
      if (!await confirmReplacement('重新下载成功后将替换现有文件。')) {
        return const UserDownloadResult(replaced: false);
      }
      final job = await repository.create(
        track,
        quality,
        qualityList: qualityList,
        listId: listId,
        existingFilePolicy: ExistingFilePolicy.replace,
      );
      return UserDownloadResult(job: job, replaced: true);
    }
  }
}
~~~

- [ ] **Step 6: Bind only the dialog abstraction**

~~~dart
abstract interface class RedownloadConfirmation {
  Future<bool> confirm(BuildContext context, String message);
}
~~~

The redesigned dialog system implements this interface. redownload_confirmation.dart contains only the adapter and approved copy; it must not recreate popup routes, geometry, colors, or animation locally.

- [ ] **Step 7: Replace all raw interactive create calls**

Update search, album, online playlist, and player provider. Afterward:

~~~bash
rg -n "downloads\\.create|repositories\\.downloads\\.create" lib --glob '*.dart'
~~~

Expected: no interactive screen/provider matches. Automatic playback saving remains Service-owned reuse behavior.

- [ ] **Step 8: Verify Flutter semantics without golden updates**

~~~bash
flutter test test/features/downloads/download_repository_test.dart test/features/downloads/user_download_coordinator_test.dart
flutter test test/features/search/search_screen_test.dart test/features/discovery/album_detail_screen_test.dart test/features/discovery/online_playlist_detail_screen_test.dart test/features/player/player_screen_test.dart test/features/player/current_track_actions_controller_test.dart
flutter analyze lib/features/downloads lib/features/search/search_screen.dart lib/features/discovery/album_detail_screen.dart lib/features/discovery/online_playlist_detail_screen.dart lib/app/player_providers.dart
~~~

Expected: PASS. Do not use --update-goldens.

- [ ] **Step 9: Commit isolated semantic files when authorized**

Stage only Task 7 files after comparing against the pre-task dirty snapshot.

~~~bash
git commit -m "feat(downloads): confirm safe redownloads in Flutter"
~~~

### Task 8: Freeze and Verify the Cross-Repository Result

**Files:**
- Review all Task 1-7 files.
- Do not modify unrelated Flutter goldens or generated artifacts.

**Interfaces:**
- Consumes: completed Service, hosted Web, and Flutter changes.
- Produces: frozen tree identities and final evidence for every acceptance criterion.

- [ ] **Step 1: Review final diffs**

In each repository:

~~~bash
git status --short
git diff --check
git diff --stat
~~~

Confirm no sensitive paths/targets are persisted or exposed. Confirm Flutter excludes pre-existing dialog/golden changes from this task's scoped diff.

- [ ] **Step 2: Run final Service integration**

~~~bash
npx vitest run src/server/playback/bundleResolver.test.ts src/server/downloads/replacementPublisher.test.ts src/server/downloads/downloads.test.ts src/server/api/openapi.test.ts src/server/app.test.ts src/renderer/store/download/userDownload.test.ts
npm run lint
npm run build:service
~~~

Expected: all pass.

- [ ] **Step 3: Freeze Service identity**

~~~bash
git rev-parse HEAD
git diff --binary | shasum -a 256
~~~

Record both in the handoff.

- [ ] **Step 4: Run final Flutter semantic verification after its dialog dependency is stable**

~~~bash
flutter test test/features/downloads/download_repository_test.dart test/features/downloads/user_download_coordinator_test.dart test/features/search/search_screen_test.dart test/features/discovery/album_detail_screen_test.dart test/features/discovery/online_playlist_detail_screen_test.dart test/features/player/player_screen_test.dart test/features/player/current_track_actions_controller_test.dart
flutter analyze
~~~

Expected: all pass without golden updates.

- [ ] **Step 5: Freeze the scoped Flutter identity**

Hash only Task 7 paths and separately list pre-existing dirty files. Do not report a whole-tree dirty hash as Task 7 evidence.

- [ ] **Step 6: Run an isolated API smoke test**

Use a disposable storage root, never a real library:

~~~text
existingFilePolicy=error   -> 409 DOWNLOAD_ALREADY_EXISTS
existingFilePolicy=replace -> 201 replacement task
failed replacement         -> original hash unchanged
successful replacement     -> final post-metadata hash persisted
cross-format replacement   -> old extension absent, new extension present
~~~

- [ ] **Step 7: Prepare the handoff**

Report changed files per repository, frozen identities, verification commands/results, confirmation that no real library was mutated, residual filesystem risk, Flutter dialog dependency state, and actual commit hashes only if commits were authorized.
