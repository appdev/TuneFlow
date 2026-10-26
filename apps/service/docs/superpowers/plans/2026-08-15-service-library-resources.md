# Service Local Library Resources Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Materialize embedded artwork and lyrics into persistent mirrored Service directories, expose safe local-library resource URLs, and never reparse audio during an HTTP resource request.

**Architecture:** A focused `LibraryResourceStore` owns persistent extraction state and the `cover/` and `lyrics/` trees. `DownloadManager` materializes resources after final metadata writes, while `LibraryScanner` backfills legacy/manual files and places the resulting optional URLs into its DTO; routes only stream already-materialized resources registered by the scanner.

**Tech Stack:** Node.js filesystem/crypto APIs, TypeScript, Fastify/TypeBox, `music-metadata`, Vitest, existing TuneFlow download and library services.

## Global Constraints

- Only embedded audio artwork is a cover source; never use `cover.jpg`, `folder.jpg`, `file://`, or arbitrary caller paths.
- Store audio under `<storageRoot>/audio`, artwork under `<storageRoot>/cover`, lyrics under `<storageRoot>/lyrics`, and preserve the audio-relative directory.
- Preserve the audio extension in derived names: `123.mp3` becomes `123.mp3.jpg`; `123.flac` becomes `123.flac.png` when the embedded MIME is PNG.
- Keep original image encoding; do not add an image transcoding dependency.
- The list returns same-origin relative resource URLs; no Service filesystem path crosses the API boundary.
- HTTP picture/lyrics handlers must not parse audio files.
- Preserve existing download grouping, collision suffixes, atomic publication, integrity, warnings, and all unrelated dirty-worktree changes.
- Do not stage or commit unless the user separately authorizes it.

---

### Task 1: Persistent Resource Store

**Files:**
- Create: `src/server/library/resources.ts`
- Create: `src/server/library/resources.test.ts`
- Modify: `src/server/config.ts`

**Interfaces:**
- Consumes: `storageRoot`, canonical audio file paths below `getAudioRoot(storageRoot)`, and `music-metadata.parseFile`.
- Produces:
  - `LibraryPictureResource { filePath: string, relativePath: string, mimeType: string, byteLength: number, etag: string }`
  - `LibraryLyricsResource { filePath: string, relativePath: string }`
  - `LibraryDerivedResources { picture?: LibraryPictureResource, lyrics?: LibraryLyricsResource }`
  - `LibraryResourceStore.ensure(audioFilePath: string): Promise<LibraryDerivedResources>`
  - `LibraryResourceStore.reconcile(activeAudioFiles: ReadonlySet<string>): Promise<void>`

- [ ] **Step 1: Add failing mapping, extraction, persistence, and negative-cache tests**

Create tests using a temporary `storageRoot`, `audio/歌单A/123.mp3`, and NodeID3-tagged copies of `src/renderer/assets/medias/Silence02s.mp3`:

```ts
const first = await store.ensure(audioPath)
expect(first.picture).toMatchObject({
  relativePath: 'cover/歌单A/123.mp3.jpg',
  mimeType: 'image/jpeg',
  byteLength: jpeg.length,
})
expect(readFileSync(path.join(storageRoot, first.picture!.relativePath))).toEqual(jpeg)

const restarted = new LibraryResourceStore(storageRoot, {
  parseFile: async() => { throw new Error('must use persisted index') },
})
expect(await restarted.ensure(audioPath)).toMatchObject({
  picture: { relativePath: 'cover/歌单A/123.mp3.jpg' },
})
```

Also cover:

```ts
expect((await store.ensure(mp3WithoutPicture)).picture).toBeUndefined()
expect(parseCalls).toBe(1)
await store.ensure(mp3WithoutPicture)
expect(parseCalls).toBe(1)

expect((await store.ensure(path.join(audioRoot, '123.flac'))).picture?.relativePath)
  .toBe('cover/123.flac.png')
```

Assert embedded lyrics are preferred, sibling `.lrc` is the lyrics fallback only, UTF-8 BOM is removed, changed audio signatures rebuild resources, and `reconcile` removes derived files for deleted audio without touching audio files.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/server/library/resources.test.ts --reporter=verbose
```

Expected: FAIL because `LibraryResourceStore` and resource-root helpers do not exist.

- [ ] **Step 3: Add resource roots and the minimal persistent store**

Add to `src/server/config.ts`:

```ts
export const getCoverRoot = (storageRoot: string): string => path.join(storageRoot, 'cover')
export const getLyricsRoot = (storageRoot: string): string => path.join(storageRoot, 'lyrics')
export const getLibraryResourceIndexRoot = (storageRoot: string): string =>
  path.join(storageRoot, 'library-resource-index')
```

Ensure `normalizeServerOptions` creates `cover`, `lyrics`, and the internal
`library-resource-index` directory together with existing storage directories.

Implement `LibraryResourceStore` with one small JSON marker per audio-relative path under
`library-resource-index/<sha256(relative-audio-path)>.json`; this avoids rewriting one growing
index file for every item in a large first-run backfill. Each marker records
`{ audioRelativePath, signature, picture, lyrics, pictureMissing, lyricsMissing }`. Compute the
signature from relative path, size, and `mtimeMs`. A signature/index/file hit returns without
parsing.

On a miss, call:

```ts
const metadata = await parseFile(audioFilePath, { duration: false, skipCovers: false })
const picture = metadata.common.picture?.[0]
```

Accept `image/jpeg`, `image/png`, and `image/webp`, cap embedded picture data at 20 MiB, keep only one picture buffer during extraction, and append `.jpg`, `.png`, or `.webp` to the complete audio basename including its audio extension. Write derived content and the per-audio JSON marker through unique files below `tmp/`, `fsync`, then rename atomically. Coalesce concurrent `ensure` calls in `Map<string, Promise<LibraryDerivedResources>>`.

For lyrics, select the first non-empty `common.lyrics[].text`; otherwise read the same-directory `.lrc` if present. Strip a UTF-8 BOM and write UTF-8 to `lyrics/<mirrored>/<audio-basename>.lrc`. Do not inspect sibling images.

- [ ] **Step 4: Run the resource-store tests and verify GREEN**

Run:

```bash
npx vitest run src/server/library/resources.test.ts --reporter=verbose
```

Expected: PASS with one parse for an unchanged resource, one parse for an unchanged negative result, collision-free MP3/FLAC paths, and safe orphan cleanup.

- [ ] **Step 5: Review the isolated diff**

Run:

```bash
git diff --check -- src/server/config.ts src/server/library/resources.ts src/server/library/resources.test.ts
git diff -- src/server/config.ts src/server/library/resources.ts src/server/library/resources.test.ts
```

Expected: no whitespace errors; no changes outside the resource-store boundary.

---

### Task 2: Download Completion Materializes Resources

**Files:**
- Modify: `src/server/downloads/manager.ts`
- Modify: `src/server/downloads/downloads.test.ts`
- Modify: `src/server/app.ts`

**Interfaces:**
- Consumes: `LibraryResourceStore.ensure(finalAudioPath)` from Task 1 and the existing final metadata stage.
- Produces: optional `DownloadManager` dependency `materializeResources?: (filePath: string) => Promise<void>` invoked after metadata writes and before completed publication.

- [ ] **Step 1: Add a failing finalization-order test**

In `downloads.test.ts`, create a manager with instrumented metadata and resource callbacks:

```ts
const order: string[] = []
const manager = new DownloadManager({
  ...options,
  metadata: async() => { order.push('metadata') },
  materializeResources: async filePath => {
    order.push('resources')
    expect(existsSync(filePath)).toBe(true)
  },
  onCompleted: async() => { order.push('refresh') },
})

await manager.start(job.id)
await manager.waitForIdle()
expect(order).toEqual(['metadata', 'resources', 'refresh'])
expect(manager.get(job.id)?.status).toBe('completed')
```

Add a failure case asserting a resource exception produces a completed job warning prefixed with `Resources:` and preserves the final audio.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run src/server/downloads/downloads.test.ts -t "materializes resources|resource failure" --reporter=verbose
```

Expected: FAIL because the manager ignores `materializeResources`.

- [ ] **Step 3: Add the dependency and invoke it at the correct boundary**

Extend `DownloadManagerOptions`:

```ts
materializeResources?: (filePath: string) => Promise<void>
```

In `finalize`, call it after the existing metadata try/catch and before final integrity/status publication. Append warnings without discarding an earlier metadata warning:

```ts
try {
  await this.options.materializeResources?.(final)
} catch (error) {
  const resourceWarning = `Resources: ${error instanceof Error ? error.message : String(error)}`
  warning = warning == null ? resourceWarning : `${warning}; ${resourceWarning}`
}
```

In `app.ts`, create one `LibraryResourceStore` and pass `filePath => resources.ensure(filePath).then(() => undefined)` to the manager. Preserve the existing integrity lookup and `onCompleted: library.refresh` wiring.

- [ ] **Step 4: Verify GREEN and existing publication behavior**

Run:

```bash
npx vitest run src/server/downloads/downloads.test.ts --reporter=dot
```

Expected: PASS, including metadata failures, crash recovery, collision suffixes, list grouping, and final-integrity tests.

- [ ] **Step 5: Review the integration diff**

Run:

```bash
git diff --check -- src/server/downloads/manager.ts src/server/downloads/downloads.test.ts src/server/app.ts
```

Expected: no whitespace errors and no reordering of unrelated playback-history changes in `app.ts`.

---

### Task 3: Scanner Backfill and Resource-bearing DTOs

**Files:**
- Modify: `src/server/library/scanner.ts`
- Modify: `src/server/downloads/downloads.test.ts`
- Modify: `src/server/api/schemas/domain.ts`
- Modify: `src/server/app.ts`

**Interfaces:**
- Consumes: `LibraryResourceStore.ensure`/`reconcile` and current scanner integrity callback.
- Produces:
  - optional `pictureUrl` and `lyricsUrl` on `LibraryTrackDto`;
  - `musicInfo.pic` when artwork exists;
  - `musicInfo.meta.lyricsUrl` when lyrics exist;
  - scanner private entries carrying `resources: LibraryDerivedResources` for Task 4 routes.

- [ ] **Step 1: Add failing scanner backfill and stable-hit tests**

Extend scanner tests to inject a real resource store and assert:

```ts
const [item] = await scanner.refresh()
expect(item.pictureUrl).toBe(`/api/v1/library/tracks/${encodeURIComponent(item.id)}/picture`)
expect(item.musicInfo.pic).toBe(item.pictureUrl)
expect(item.lyricsUrl).toBe(`/api/v1/library/tracks/${encodeURIComponent(item.id)}/lyrics`)
expect(item.musicInfo.meta.lyricsUrl).toBe(item.lyricsUrl)
```

Refresh twice and assert the injected parser count does not increase. Add a no-cover fixture and assert `pictureUrl` and `musicInfo.pic` are absent.

- [ ] **Step 2: Run the scanner tests and verify RED**

Run:

```bash
npx vitest run src/server/downloads/downloads.test.ts -t "library.*resource|backfills" --reporter=verbose
```

Expected: FAIL because scanner DTOs do not contain resource URLs.

- [ ] **Step 3: Integrate the resource store without disturbing integrity work**

Add an optional fourth constructor dependency after the current integrity callback:

```ts
constructor(
  storageRoot: string,
  getRoots: () => string[],
  getExpectedIntegrity: (filePath: string) => DownloadFileIntegrity | undefined = () => undefined,
  resourceStore?: LibraryResourceStore,
)
```

During scanning, call `resourceStore?.ensure(filePath)` only after the file passes current validity and integrity checks. Build URLs from the final scanner ID, add them only when the resource exists, and store the descriptor in `PrivateEntry`. After a successful full scan, call `resourceStore.reconcile(seenFiles)`.

Update TypeBox `LibraryTrack` with optional `pictureUrl` and `lyricsUrl` strings while retaining the extensible `Track` schema.
Pass the same app-level `LibraryResourceStore` instance into `LibraryScanner` in `app.ts`; do not
create separate scanner and download resource stores.

- [ ] **Step 4: Run scanner/download tests and verify GREEN**

Run:

```bash
npx vitest run src/server/downloads/downloads.test.ts src/server/library/resources.test.ts --reporter=dot
```

Expected: PASS; invalid/integrity-failed audio remains excluded and existing scanner matching still works.

- [ ] **Step 5: Review DTO/API-schema changes**

Run:

```bash
git diff --check -- src/server/library/scanner.ts src/server/api/schemas/domain.ts src/server/downloads/downloads.test.ts
```

Expected: no whitespace errors and no loss of the current `valid` or integrity checks.

---

### Task 4: Safe Picture and Lyrics Routes

**Files:**
- Modify: `src/server/routes/library.ts`
- Modify: `src/server/routes/library-resources.test.ts`

**Interfaces:**
- Consumes: `scanner.get(id)` entries with already-materialized resource descriptors.
- Produces:
  - `GET`/`HEAD /api/v1/library/tracks/:id/picture`
  - `GET /api/v1/library/tracks/:id/lyrics`

- [ ] **Step 1: Repair and extend the existing failing route draft**

Preserve the user-owned `library-resources.test.ts` intent. Replace its invalid-audio 404 fixtures with valid copies of `Silence02s.mp3` that have no embedded resources, because current scanner integrity work correctly excludes unparseable audio.

Add list assertions:

```ts
expect(track.pictureUrl).toBe(`/api/v1/library/tracks/${track.id}/picture`)
expect(track.musicInfo.pic).toBe(track.pictureUrl)
```

Add `HEAD`, `etag`, `cache-control`, `content-length`, and “handler does not call parseFile” coverage. Keep the existing path-leak and unknown-ID checks.

- [ ] **Step 2: Run the route test and verify RED**

Run:

```bash
npx vitest run src/server/routes/library-resources.test.ts --reporter=verbose
```

Expected: picture/lyrics routes return 404 `NOT_FOUND` because they are not registered.

- [ ] **Step 3: Implement read-only resource handlers**

In `library.ts`, resolve only through `scanner.get(id)`. Unknown IDs throw `LIBRARY_TRACK_NOT_FOUND`; missing descriptors/files throw `LIBRARY_TRACK_PICTURE_NOT_FOUND` or `LIBRARY_TRACK_LYRICS_NOT_FOUND`.

Picture response headers:

```ts
reply.headers({
  'content-type': picture.mimeType,
  'content-length': String(picture.byteLength),
  etag: `"${picture.etag}"`,
  'cache-control': 'private, max-age=31536000, immutable',
})
```

Return `createReadStream(picture.filePath)` for GET and no body for HEAD. Read the already-derived UTF-8 lyrics file and return `{ data: { lyric } }`. Never call `parseFile` inside either handler.

- [ ] **Step 4: Run the route tests and verify GREEN**

Run:

```bash
npx vitest run src/server/routes/library-resources.test.ts --reporter=verbose
```

Expected: all embedded-resource, sidecar-lyrics, cache-header, safe-404, and unknown-ID tests pass.

- [ ] **Step 5: Run the existing stream regressions**

Run:

```bash
npx vitest run src/server/playback/proxy.test.ts src/server/downloads/downloads.test.ts --reporter=dot
```

Expected: existing Range, HEAD, local resolution, download, and integrity behavior passes unchanged.

---

### Task 5: OpenAPI Contract

**Files:**
- Modify: `src/server/api/openapi.test.ts`
- Modify: `src/server/routes/library.ts`
- Modify: `src/server/api/schemas/domain.ts`

**Interfaces:**
- Consumes: Task 3 DTO fields and Task 4 routes.
- Produces: generated OpenAPI entries for picture/lyrics paths and optional library resource URLs.

- [ ] **Step 1: Add failing OpenAPI assertions**

Require these paths:

```ts
'/api/v1/library/tracks/{id}/picture'
'/api/v1/library/tracks/{id}/lyrics'
```

Assert `LibraryTrack` response items expose optional `pictureUrl` and `lyricsUrl`, picture GET/HEAD advertise binary responses, and lyrics GET uses the `{ data: { lyric } }` schema.

- [ ] **Step 2: Run the OpenAPI test and verify RED**

Run:

```bash
npx vitest run src/server/api/openapi.test.ts --reporter=verbose
```

Expected: FAIL with missing library resource paths/schemas.

- [ ] **Step 3: Add exact Fastify schemas**

Use `IdParams`; describe picture success as
`Type.String({ contentEncoding: 'binary', contentMediaType: 'application/octet-stream' })` and
lyrics success as `ApiSuccess(Type.Object({ lyric: Type.String() }))`. Keep `ErrorResponses` on
both routes.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run src/server/api/openapi.test.ts src/server/routes/library-resources.test.ts --reporter=dot
```

Expected: PASS.

---

### Task 6: Service Verification and Frozen Diff

**Files:**
- Verify all Service files changed in Tasks 1–5.

**Interfaces:**
- Consumes: completed Service implementation.
- Produces: verified Service contract ready for Flutter consumption.

- [ ] **Step 1: Format/lint only affected source files**

Run the repository-native lint against the affected paths:

```bash
npx eslint src/server/config.ts src/server/library/resources.ts src/server/library/resources.test.ts src/server/library/scanner.ts src/server/routes/library.ts src/server/routes/library-resources.test.ts src/server/downloads/manager.ts src/server/downloads/downloads.test.ts src/server/api/schemas/domain.ts src/server/api/openapi.test.ts src/server/app.ts
```

Expected: exit 0 with no new warnings.

- [ ] **Step 2: Run focused Service tests**

Run:

```bash
npx vitest run \
  src/server/library/resources.test.ts \
  src/server/routes/library-resources.test.ts \
  src/server/downloads/downloads.test.ts \
  src/server/playback/proxy.test.ts \
  src/server/api/openapi.test.ts \
  src/server/app.test.ts \
  --reporter=dot
```

Expected: PASS.

- [ ] **Step 3: Build the Service**

Run:

```bash
npm run build:server
```

Expected: exit 0.

- [ ] **Step 4: Freeze and inspect the Service diff**

Run:

```bash
git diff --check
git status --short
git diff -- src/server/config.ts src/server/library/resources.ts src/server/library/scanner.ts src/server/routes/library.ts src/server/downloads/manager.ts src/server/api/schemas/domain.ts src/server/app.ts
```

Expected: no whitespace errors; unrelated playback-history/download-integrity edits remain present and unmodified except at deliberately coordinated integration lines. Leave all changes unstaged and uncommitted.
