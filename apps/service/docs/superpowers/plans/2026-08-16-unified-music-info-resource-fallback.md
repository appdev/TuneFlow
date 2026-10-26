# Unified Music Info and Resource Fallback Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bundled Web and Flutter send equivalent canonical music query context while the Service safely resolves optional resources, writes verified metadata on staged files, and publishes only verified audio.

**Architecture:** A Service-side normalizer establishes the canonical boundary and remains compatible with legacy `img`/`pic` payloads and persisted jobs. Flutter gains one Service-request serializer modeled on bundled Web conversion, while the Service resolver owns source retries and hardened artwork validation. Metadata consumes only validated resource bytes, reports bounded optional-resource warnings, and runs before ordinary or replacement publication.

**Tech Stack:** TypeScript, Node.js, Vitest, Vue/Web runtime, TagLib-WASM, Dart, Flutter test, Docker-free local verification.

**Execution status:** Completed locally on 2026-08-16. Independent review findings for published-file integrity, sidecar collisions, pause cleanup, warning persistence, and bounded replacement errors were fixed and covered by regression tests. No commit or deployment was performed.

## Global Constraints

- Work in `/Volumes/ext/lx-music-server-web` and `/Volumes/ext/MusicFree/flutter-client`; follow each repository's `AGENTS.md` independently.
- Preserve all existing uncommitted changes. Do not reset, discard, overwrite, or reformat unrelated work.
- Do not commit, push, deploy, restart containers, or mutate test-server data in this implementation pass.
- The Service remains responsible for audio, lyrics, and artwork lookup, validation, retry, metadata writing, and publication.
- Clients send identity and provider query context only; client URLs are compatibility candidates and are never trusted media.
- Artwork precedence is the first non-empty HTTP(S) value from `meta.picUrl`, `img`, then `pic`.
- Optional artwork or lyrics absence completes with bounded warnings that expose no URL or storage path.
- TagLib write, parse, or write-after-read verification failure is fatal and must publish neither a new incomplete file nor a replacement.
- Completed media is never rewritten automatically; legacy records are normalized only for resume or explicit redownload.
- Flutter display behavior and goldens remain unchanged; only Service-request serialization changes.

---

### Task 1: Service Canonical Music-Info Boundary

**Files:**
- Create: `src/server/sources/musicInfo.test.ts`
- Modify: `src/server/sources/musicInfo.ts`
- Modify: `src/server/downloads/manager.ts`

**Interfaces:**
- Produces: `normalizeMusicInfo(value: unknown): TuneFlow.Music.MusicInfoOnline | unknown`.
- Produces: `canonicalPictureUrl(value: unknown): string | undefined`.
- Preserves: all top-level and `meta` properties, including QQ, Kugou, and Migu provider fields.
- Consumed by: source adapter conversion, playback bundle resolution, download creation, and persisted-record loading.

- [ ] **Step 1: Add failing canonicalization and compatibility tests**

```ts
describe('normalizeMusicInfo', () => {
  const base = { id: 'legacy-id', name: '大梦', singer: '瓦依那、任素汐', source: 'tx' }

  it.each([
    [{ meta: { songId: '1', picUrl: 'https://canonical/cover.jpg' }, img: 'https://img/cover.jpg', pic: 'https://pic/cover.jpg' }, 'https://canonical/cover.jpg'],
    [{ meta: { songId: '1', picUrl: ' ' }, img: 'https://img/cover.jpg', pic: 'https://pic/cover.jpg' }, 'https://img/cover.jpg'],
    [{ meta: { songId: '1' }, img: 'file:///tmp/private.jpg', pic: 'https://pic/cover.jpg' }, 'https://pic/cover.jpg'],
    [{ meta: { songId: '1' }, img: 'data:image/png;base64,AA==' }, undefined],
  ])('promotes the first valid artwork candidate', (input, expected) => {
    expect(normalizeMusicInfo({ ...base, ...input })).toMatchObject({
      meta: expect.objectContaining({ songId: '1', ...(expected == null ? {} : { picUrl: expected }) }),
    })
    expect(canonicalPictureUrl({ ...base, ...input })).toBe(expected)
  })

  it('preserves provider query fields and legacy adapter artwork', () => {
    const input = { ...base, img: 'https://img/cover.jpg', meta: {
      songId: '1', strMediaMid: 'mid', id: 'qq-id', albumMid: 'album-mid',
      hash: 'kg-hash', copyrightId: 'mg-id', lrcUrl: 'lrc', mrcUrl: 'mrc', trcUrl: 'trc',
      qualitys: { '128k': { size: '1' } }, _qualitys: { high: { size: '2' } },
    } }
    const normalized = normalizeMusicInfo(input) as TuneFlow.Music.MusicInfoOnline
    expect(normalized.meta).toMatchObject({ ...input.meta, picUrl: input.img })
    expect(toSourceMusicInfo(input)).toMatchObject({ img: input.img, songmid: '1' })
  })
})
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `npx vitest run src/server/sources/musicInfo.test.ts`

Expected: FAIL because `normalizeMusicInfo` and `canonicalPictureUrl` are not exported and legacy `img` is currently lost by `toOldMusicInfo`.

- [ ] **Step 3: Implement one non-mutating normalizer and route adapter conversion through it**

```ts
const HTTP_PROTOCOLS = new Set(['http:', 'https:'])

const httpUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  try {
    const url = new URL(value.trim())
    return HTTP_PROTOCOLS.has(url.protocol) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export const canonicalPictureUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value == null) return undefined
  const record = value as Record<string, unknown>
  const meta = typeof record.meta === 'object' && record.meta != null
    ? record.meta as Record<string, unknown>
    : {}
  return httpUrl(meta.picUrl) ?? httpUrl(record.img) ?? httpUrl(record.pic)
}

export const normalizeMusicInfo = (value: unknown): TuneFlow.Music.MusicInfoOnline | unknown => {
  if (typeof value !== 'object' || value == null) return value
  const record = value as Record<string, unknown>
  const existingMeta = typeof record.meta === 'object' && record.meta != null
    ? record.meta as Record<string, unknown>
    : {}
  const picUrl = canonicalPictureUrl(record)
  const meta: Record<string, unknown> = {
    ...existingMeta,
    songId: existingMeta.songId ?? record.songmid ?? record.id,
    albumName: existingMeta.albumName ?? record.albumName,
    albumId: existingMeta.albumId ?? record.albumId,
    qualitys: existingMeta.qualitys ?? record.types,
    _qualitys: existingMeta._qualitys ?? record._types,
    ...(picUrl == null ? {} : { picUrl }),
  }
  if (record.source === 'kg') meta.hash ??= record.hash
  if (record.source === 'tx') {
    meta.strMediaMid ??= record.strMediaMid
    meta.id ??= record.songId
    meta.albumMid ??= record.albumMid
  }
  if (record.source === 'mg') {
    meta.copyrightId ??= record.copyrightId
    meta.lrcUrl ??= record.lrcUrl
    meta.mrcUrl ??= record.mrcUrl
    meta.trcUrl ??= record.trcUrl
  }
  for (const [key, field] of Object.entries(meta)) if (field == null) delete meta[key]
  return { ...record, meta } as TuneFlow.Music.MusicInfoOnline
}
```

Update `toSourceMusicInfo` to normalize first and pass the normalized value to `toOldMusicInfo`. Preserve an existing canonical `id`; if it is absent, retain the current persisted-record fallback from `songmid`. Apply the same normalizer to `DownloadCreateInput.musicInfo` before quality selection, duplicate matching, filename construction, and record creation, and to each loaded `DownloadJobRecord.musicInfo` before the record enters manager state.

- [ ] **Step 4: Add persisted-record normalization coverage**

```ts
it('promotes legacy artwork when persisted records are loaded without rewriting completed media', async() => {
  await writePersistedJobs([{ ...completedRecord, musicInfo: { ...musicInfo, img: 'https://img/cover.jpg', meta: { songId: '1' } } }])
  const manager = await createManager()
  expect(manager.list()[0].musicInfo.meta.picUrl).toBe('https://img/cover.jpg')
  expect(await readFile(completedAudioPath)).toEqual(originalCompletedBytes)
})
```

- [ ] **Step 5: Run Service boundary tests**

Run: `npx vitest run src/server/sources/musicInfo.test.ts src/server/downloads/downloads.test.ts`

Expected: PASS, including no completed-file rewrite during load.

### Task 2: Flutter Canonical Service Serializer

**Files:**
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/api/models.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/player/playback_repository.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/search/search_repository.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/downloads/download_repository.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/test/api/models_test.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/test/features/repositories_test.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/test/features/downloads/download_repository_test.dart`

**Interfaces:**
- Produces: `Track.toServiceMusicInfoJson(): Map<String, Object?>`.
- Preserves: `Track.raw` and `Track.toJson()` for local display/state compatibility.
- Consumed by: Service playback resolve, lyrics, picture, and download request bodies.

- [ ] **Step 1: Write failing serializer tests matching bundled Web semantics**

```dart
test('serializes legacy catalog data into canonical Service musicInfo', () {
  final track = Track.fromJson({
    'id': 'legacy-id', 'name': '大梦', 'singer': '瓦依那、任素汐', 'source': 'tx',
    'songmid': 'song-mid', 'strMediaMid': 'media-mid', 'albumMid': 'album-mid',
    'albumName': '专辑', 'img': 'https://img/cover.jpg',
    'types': <String, Object?>{'128k': <String, Object?>{'size': '123'}},
  });
  expect(track.toServiceMusicInfoJson(), containsPair('meta', containsPair('picUrl', 'https://img/cover.jpg')));
  expect(track.toServiceMusicInfoJson()['meta'], containsPair('songId', 'song-mid'));
  expect(track.toServiceMusicInfoJson()['meta'], containsPair('strMediaMid', 'media-mid'));
  expect(track.toServiceMusicInfoJson()['meta'], containsPair('albumMid', 'album-mid'));
  expect(track.raw['pic'], 'https://img/cover.jpg');
})
```

Add separate cases for `meta.picUrl > img > pic`, non-HTTP rejection, Kugou `hash`, and Migu `copyrightId/lrcUrl/mrcUrl/trcUrl`.

- [ ] **Step 2: Run model tests and confirm the red state**

Run: `flutter test test/api/models_test.dart`

Expected: FAIL because `toServiceMusicInfoJson` does not exist.

- [ ] **Step 3: Implement the centralized serializer without changing display normalization**

```dart
Map<String, Object?> toServiceMusicInfoJson() {
  final output = Map<String, Object?>.from(raw);
  final existingMeta = raw['meta'] is Map
      ? Map<String, Object?>.from(raw['meta'] as Map)
      : <String, Object?>{};
  final meta = <String, Object?>{
    ...existingMeta,
    'songId': existingMeta['songId'] ?? raw['songmid'] ?? raw['id'],
    'albumName': existingMeta['albumName'] ?? raw['albumName'],
    'albumId': existingMeta['albumId'] ?? raw['albumId'],
    'qualitys': existingMeta['qualitys'] ?? raw['types'],
    '_qualitys': existingMeta['_qualitys'] ?? raw['_types'],
  };
  final picture = _firstHttpUrl(<Object?>[existingMeta['picUrl'], raw['img'], raw['pic']]);
  if (picture != null) meta['picUrl'] = picture;
  _copyProviderQueryFields(raw, meta, source);
  output['meta'] = meta..removeWhere((_, value) => value == null);
  return output;
}
```

Implement `_firstHttpUrl` with `Uri.tryParse`, accepting only `http` and `https`. Implement `_copyProviderQueryFields` with the exact bundled Web mappings: QQ `strMediaMid`, `id`, `albumMid`; Kugou `hash`; Migu `copyrightId`, `lrcUrl`, `mrcUrl`, `trcUrl`.

- [ ] **Step 4: Change every Service music-info request to the serializer**

```dart
final musicInfo = track.toServiceMusicInfoJson();
```

Use `musicInfo` for playback resolve `info`, search lyrics/picture requests, download creation `musicInfo`, and download picture requests. Do not replace local caching, persistence, artwork widget reads, or `Track.toJson()`.

- [ ] **Step 5: Add request-body assertions**

```dart
expect(requestBody['musicInfo'], containsPair('meta', containsPair('picUrl', 'https://img/cover.jpg')));
expect(requestBody['musicInfo'], isNot(containsPair('meta', isNot(isA<Map>()))));
```

Assert this contract for playback, lyrics, picture, download creation, and download picture. Retain an assertion that `track.raw['pic']` is unchanged for display.

- [ ] **Step 6: Run Flutter contract and repository tests**

Run: `flutter test test/api/models_test.dart test/features/repositories_test.dart test/features/downloads/download_repository_test.dart`

Expected: PASS with unchanged widget/golden files.

### Task 3: Resolver-Owned Resource Fallback

**Files:**
- Modify: `src/server/playback/bundleResolver.ts`
- Modify: `src/server/playback/bundleResolver.test.ts`
- Modify: `src/server/app.ts`

**Interfaces:**
- Consumes: `normalizeMusicInfo` and `canonicalPictureUrl` from Task 1.
- Preserves: `ResolvedDownloadCandidate.resources` as validated `pictureBytes`, `pictureMimeType`, and lyrics.
- Produces: independently resolved built-in and snapshot fallback resources with bounded provenance IDs.

- [ ] **Step 1: Add failing fallback-isolation tests**

```ts
it('falls back from provider artwork HTTP 404 to the validated canonical snapshot', async() => {
  const result = await resolver.resolve({ ...musicInfo, meta: { ...musicInfo.meta, picUrl: 'https://snapshot/cover.jpg' } }, '128k')
  expect(mediaClient.fetchArtwork).toHaveBeenCalledWith('https://provider/missing.jpg')
  expect(mediaClient.fetchArtwork).toHaveBeenCalledWith('https://snapshot/cover.jpg')
  expect(result.downloadCandidates?.[0].resources?.pictureBytes).toEqual(snapshotBytes)
  expect(result.downloadCandidates?.[0].sourceIds?.picture).toBe('snapshot')
})

it('keeps valid lyrics when every artwork candidate fails', async() => {
  const result = await resolver.resolve(musicInfo, '128k')
  expect(result.downloadCandidates?.[0].resources?.lyrics?.lyric).toContain('[00:00]')
  expect(result.downloadCandidates?.[0].resources?.pictureBytes).toBeUndefined()
})
```

Add an inverse test proving artwork survives lyrics failure, and retain existing same-source-complete and mixed-fill ordering tests.

- [ ] **Step 2: Run resolver tests and confirm the red state**

Run: `npx vitest run src/server/playback/bundleResolver.test.ts`

Expected: FAIL because a failed built-in/provider artwork path currently prevents snapshot fallback and raw legacy input is not normalized at every resolver boundary.

- [ ] **Step 3: Normalize once and isolate each optional fallback**

```ts
const normalizedInfo = normalizeMusicInfo(info) as TuneFlow.Music.MusicInfoOnline
const original = originalMusicInfo(normalizedInfo)

if (lyrics == null) lyrics = await tryBuiltInLyrics(original)
if (picture == null) picture = await tryBuiltInPicture(original)
if (picture == null) picture = await trySnapshotPicture(canonicalPictureUrl(normalizedInfo))
```

Each helper catches only its own acquisition failure and returns `undefined`. `tryBuiltInPicture` and `trySnapshotPicture` must call `mediaClient.fetchArtwork`; neither may use global `fetch`. Store successful bytes in the existing opaque playback resource store and record snapshot provenance as the literal `snapshot`.

- [ ] **Step 4: Remove metadata-time Service lookups from `app.ts`**

```ts
metadata: async(filePath, job, settings, resources, lyricFilePath) =>
  applyDownloadMetadata(filePath, job, settings, { ...resources, lyricFilePath })
```

The metadata callback must consume only the candidate bundle selected by the successful audio transfer. It must not call `getPicture`, `getLyric`, or global `fetch`.

- [ ] **Step 5: Run resolver and app-adjacent tests**

Run: `npx vitest run src/server/playback/bundleResolver.test.ts src/server/app.test.ts`

Expected: PASS, including the existing app integration coverage for the download metadata callback.

### Task 4: Independent Metadata Enrichment and Bounded Warnings

**Files:**
- Modify: `src/server/downloads/metadata.ts`
- Modify: `src/server/downloads/metadata-writer.test.ts`
- Modify: `src/server/downloads/manager.ts`

**Interfaces:**
- Produces: `MetadataWriteResult = { warnings: string[] }`.
- Consumes: only already validated `pictureBytes`, `pictureMimeType`, and lyrics.
- Changes: `DownloadManagerOptions.metadata(filePath, job, settings, resources?, lyricFilePath?): Promise<MetadataWriteResult>`.
- Fatal errors: metadata writer, parser, verification, or sidecar write rejection.
- Non-fatal outcomes: missing requested artwork and/or lyrics, returned as fixed warning strings.

- [ ] **Step 1: Add failing isolation, tag, and warning tests**

```ts
it('writes basic tags and lyrics when requested artwork is absent', async() => {
  const write = vi.fn().mockResolvedValue(undefined)
  const result = await applyDownloadMetadata(filePath, job, embedAllSettings, {
    lyrics: { lyric: '[00:00]梦' }, writeAudioMetadata: write,
  })
  expect(write).toHaveBeenCalledWith(filePath, expect.objectContaining({
    title: '大梦', artist: '瓦依那;任素汐', picture: undefined, lyrics: expect.stringContaining('梦'),
  }))
  expect(result.warnings).toEqual(['Artwork unavailable'])
})

it('does not fetch URLs during metadata writing', async() => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  await applyDownloadMetadata(filePath, jobWithSnapshotUrl, embedAllSettings, { writeAudioMetadata: vi.fn() })
  expect(fetchSpy).not.toHaveBeenCalled()
})

it('propagates TagLib verification failure', async() => {
  await expect(applyDownloadMetadata(filePath, job, embedAllSettings, {
    writeAudioMetadata: vi.fn().mockRejectedValue(new Error('Metadata verification failed')),
  })).rejects.toThrow('Metadata verification failed')
})
```

Add cases for artwork surviving lyrics absence, both optional resources absent, MP3/FLAC/APE/WAV behavior already supported by the real writer, and warnings containing neither `http` nor an absolute storage path.

- [ ] **Step 2: Run metadata tests and confirm the red state**

Run: `npx vitest run src/server/downloads/metadata-writer.test.ts`

Expected: FAIL because metadata currently fetches URLs, `Promise.all` couples acquisition, and the function returns `void`.

- [ ] **Step 3: Reduce metadata dependencies and always write supported-file basic tags**

```ts
export interface MetadataWriteResult { warnings: string[] }

export interface MetadataDependencies {
  pictureBytes?: Uint8Array
  pictureMimeType?: string
  lyrics?: TuneFlow.Music.LyricInfo
  writeAudioMetadata?: (filePath: string, meta: AudioMetadata) => Promise<void>
  lyricFilePath?: string
}

export const applyDownloadMetadata = async(
  filePath: string,
  job: DownloadJobRecord,
  settings: TuneFlow.AppSetting,
  dependencies: MetadataDependencies = {},
): Promise<MetadataWriteResult> => {
  const warnings: string[] = []
  const wantsPicture = settings['download.isEmbedPic']
  const wantsLyrics = settings['download.isEmbedLyric'] || settings['download.isDownloadLrc']
  if (wantsPicture && dependencies.pictureBytes == null) warnings.push('Artwork unavailable')
  if (wantsLyrics && dependencies.lyrics == null) warnings.push('Lyrics unavailable')
  if (canEmbed) await (dependencies.writeAudioMetadata ?? writeAudioMetadata)(filePath, meta)
  if (settings['download.isDownloadLrc'] && dependencies.lyrics?.lyric) {
    const lrc = buildLyrics(
      { ...dependencies.lyrics, lyric: fixKgLyric(dependencies.lyrics.lyric) },
      settings['download.isDownloadVerbatimLyric'],
      settings['download.isDownloadTLrc'],
      settings['download.isDownloadRLrc'],
    )
    const encoded = iconv.encode(lrc, settings['download.lrcFormat'] === 'gbk' ? 'gbk' : 'utf8', { addBOM: true })
    await writeFile(dependencies.lyricFilePath ?? filePath.slice(0, -path.extname(filePath).length) + '.lrc', encoded)
  }
  return { warnings }
}
```

Build `meta.picture` only when `pictureBytes` exists and its hinted/detected MIME is supported; this is a local byte check, not an acquisition attempt. Delete URL parsing, global artwork fetch, and `getPicture`/`getLyrics` dependencies from this layer. Do not catch writer or sidecar errors. Update `DownloadManagerOptions.metadata` to return `Promise<MetadataWriteResult>` and make the default callback return `applyDownloadMetadata(...)` directly.

- [ ] **Step 4: Merge returned warnings into one bounded job warning**

```ts
const metadata = await this.options.metadata(
  part,
  record,
  this.effectiveSettings(record.useDefaultDownloadSettings === true),
  resources,
  stagedLyric,
)
const warningParts = metadata.warnings.map(value => `Metadata: ${value}`)
job.warning = [...warningParts, resourceWarning].filter(Boolean).join('; ') || undefined
```

Never append caught exception messages for optional-resource misses; those may include upstream URLs. Existing unrelated bounded warnings may remain.

- [ ] **Step 5: Run metadata tests**

Run: `npx vitest run src/server/downloads/metadata-writer.test.ts`

Expected: PASS with exact warnings `Artwork unavailable` and `Lyrics unavailable`.

### Task 5: Stage Ordinary Downloads Before Publication

**Files:**
- Modify: `src/server/downloads/types.ts`
- Modify: `src/server/downloads/manager.ts`
- Modify: `src/server/downloads/downloads.test.ts`

**Interfaces:**
- Extends: ordinary `publication` with optional `stagedLyricRelativePath` and `finalLyricRelativePath`.
- Consumes: `MetadataWriteResult` from Task 4.
- Produces: `ordinaryStagedLyricPath(job): string`, `ordinaryFinalLyricPath(job): string`, `recoverPublicationAudio(record, final, part): void`, and `recoverPublicationSidecar(job): void`; all resolve explicit paths beneath `storageRoot`.
- Guarantees: publication marker is persisted only after staged audio metadata verification and staged sidecar creation succeed.

- [ ] **Step 1: Replace the old ordinary-metadata-failure expectation with fatal staging tests**

```ts
it('does not publish an ordinary download when metadata verification fails', async() => {
  metadata.mockRejectedValueOnce(new Error('Metadata verification failed'))
  await manager.create(input)
  await waitForStatus(manager, 'error')
  expect(await exists(finalPath)).toBe(false)
  expect(await exists(partPath)).toBe(false)
  expect(manager.list()[0].error).toBe('Metadata processing failed')
})

it('publishes staged audio and sidecar only after metadata succeeds', async() => {
  metadata.mockImplementation(async(partPath, _job, _settings, _resources, lyricPath) => {
    await appendFile(partPath, verifiedTagBytes)
    await writeFile(lyricPath, lyricBytes)
    return { warnings: [] }
  })
  await waitForStatus(manager, 'completed')
  expect(await readFile(finalPath)).toContainEqual(verifiedTagBytes[0])
  expect(await readFile(finalLyricPath)).toEqual(lyricBytes)
})
```

Retain and update replacement tests to prove original audio and sidecar bytes remain identical after fatal metadata failure. Add crash-recovery coverage for a prepared ordinary publication containing a staged sidecar.

- [ ] **Step 2: Run download manager tests and confirm the red state**

Run: `npx vitest run src/server/downloads/downloads.test.ts`

Expected: FAIL because ordinary finalize currently renames audio before metadata and completes after metadata failure.

- [ ] **Step 3: Move metadata before the ordinary publication marker**

```ts
await fsyncFile(partPath)
const stagedLyricPath = ordinaryStagedLyricPath(job)
const finalLyricPath = ordinaryFinalLyricPath(job)
const metadata = await this.options.metadata(partPath, job, settings, resources, stagedLyricPath)
await fsyncFile(partPath)
if (await pathExists(stagedLyricPath)) await fsyncFile(stagedLyricPath)
job.publication = {
  phase: 'prepared', sha256: integrity.sha256, size: integrity.size,
  stagedLyricRelativePath: this.relative(stagedLyricPath),
  finalLyricRelativePath: this.relative(finalLyricPath),
}
await this.persist()
await rename(partPath, finalPath)
if (await pathExists(stagedLyricPath)) await rename(stagedLyricPath, finalLyricPath)
```

On metadata or sidecar failure, remove only this job's explicit staged audio/sidecar paths, set the job to `error`, expose the fixed message `Metadata processing failed`, and leave no final library item. Recompute integrity after metadata writing, because tags change bytes.

- [ ] **Step 4: Extend prepared-publication recovery for the sidecar**

```ts
if (marker.phase === 'prepared') {
  this.recoverPublicationAudio(record, final, part)
  this.recoverPublicationSidecar(record)
}
```

Implement the three named path/recovery helpers plus synchronous `recoverPublicationAudio(record, final, part): void` in `manager.ts`, because constructor recovery is synchronous. `ordinaryStagedLyricPath` appends `.lrc` to the explicit job part path; `ordinaryFinalLyricPath` replaces the explicit final-file extension with `.lrc`; `recoverPublicationSidecar` resolves both stored relative paths through the existing safe-path helper and uses `renameSync`/`fsyncDirectory`. Recovery must be idempotent: staged exists/final absent publishes; final exists/staged absent accepts; both absent is acceptable only when no staged sidecar was recorded; no path may escape the root. Call `completeRecovered` only after audio and any recorded sidecar have both recovered.

- [ ] **Step 5: Apply the same warning result to replacement publication**

```ts
const metadata = await this.options.metadata(partPath, job, settings, resources, stagedLyricPath)
job.warning = formatMetadataWarnings(metadata.warnings)
```

Keep the existing replacement publisher and original-integrity guard. A thrown metadata error removes replacement staging and preserves original audio and sidecar.

- [ ] **Step 6: Run manager and metadata suites together**

Run: `npx vitest run src/server/downloads/downloads.test.ts src/server/downloads/metadata-writer.test.ts`

Expected: PASS for ordinary staging, replacement rollback, warnings, and recovery.

### Task 6: Cross-Client Contract, Documentation, and Frozen Verification

**Files:**
- Modify: `src/web-runtime/runtime.test.ts` or `src/renderer/core/music/runtime.test.ts` (select the existing test that directly imports bundled Web conversion)
- Modify: `docs/server-web.md`
- Verify only: all files changed in Tasks 1–5

**Interfaces:**
- Verifies: bundled Web conversion, Flutter serializer, and Service normalizer agree on core `musicInfo` fields.
- Documents: canonical request contract, compatibility order, Service ownership, warning semantics, and staged publication.

- [ ] **Step 1: Add the shared contract case to the existing Web/Service test surface**

```ts
const catalogResult = {
  id: 'legacy-id', name: '大梦', singer: '瓦依那、任素汐', source: 'tx',
  songmid: 'song-mid', strMediaMid: 'media-mid', albumMid: 'album-mid',
  albumName: '专辑', img: 'https://img/cover.jpg',
  types: [], _types: {},
}
const web = toNewMusicInfo(catalogResult as never)
const service = normalizeMusicInfo(catalogResult) as TuneFlow.Music.MusicInfoOnline
expect(pickCore(service)).toEqual(pickCore(web))
```

`pickCore` compares `source`, `name`, `singer`, and canonical `meta.songId`, `albumName`, `picUrl`, `strMediaMid`, and `albumMid`. The Flutter test in Task 2 uses the identical catalog values and expected fields.

- [ ] **Step 2: Run the cross-client focused tests**

Run in Service: `npx vitest run src/server/sources/musicInfo.test.ts src/web-runtime/runtime.test.ts src/renderer/core/music/runtime.test.ts`

Run in Flutter: `flutter test test/api/models_test.dart test/features/repositories_test.dart test/features/downloads/download_repository_test.dart`

Expected: PASS with equivalent core payloads.

- [ ] **Step 3: Update Service documentation with the exact boundary contract**

```markdown
- Clients send canonical query context under `musicInfo.meta`; `meta.picUrl` is the artwork snapshot candidate.
- Compatibility input promotes the first valid HTTP(S) value from `meta.picUrl`, `img`, then `pic`.
- The Service resolves and validates resources; clients do not send trusted artwork or lyrics bytes.
- Missing optional artwork/lyrics completes with bounded warnings. Metadata write or verification failure prevents publication.
```

Integrate these lines into the existing download/API sections without replacing unrelated user edits.

- [ ] **Step 4: Review both diffs and reject unintended UI or deployment changes**

Run in each repository: `git diff --check`

Run in Flutter: `git diff --name-only | rg '(golden|\.png$|design/|widget)'`

Expected: `git diff --check` exits 0; the Flutter UI/golden scan returns no paths attributable to this task. Existing unrelated dirty paths must be identified as pre-existing, not modified or reverted.

- [ ] **Step 5: Run final Service verification on the frozen tree**

Run: `npx vitest run src/server/sources/musicInfo.test.ts src/server/playback/bundleResolver.test.ts src/server/downloads/metadata-writer.test.ts src/server/downloads/downloads.test.ts src/web-runtime/runtime.test.ts src/renderer/core/music/runtime.test.ts`

Run: `npm run lint`

Run: `npm run build:service`

Expected: all selected Vitest tests pass, ESLint exits 0, and the production Service/Web build completes.

- [ ] **Step 6: Run final Flutter verification on the frozen tree**

Run: `flutter test test/api/models_test.dart test/features/repositories_test.dart test/features/downloads/download_repository_test.dart`

Run: `flutter analyze`

Expected: all selected tests pass and analysis reports no new issue caused by this task. If the dirty baseline has pre-existing analysis failures, capture the exact diagnostics and prove no diagnostic points to a task-modified line.

- [ ] **Step 7: Record the handoff without external mutation**

Report the changed files, exact verification outputs, existing unrelated dirty-worktree constraints, and any residual risk. State explicitly that no commit, deployment, container restart, or completed-media rewrite occurred.
