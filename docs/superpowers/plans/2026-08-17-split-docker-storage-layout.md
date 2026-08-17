# Split Docker Storage Layout Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Docker default single `/data` tree with a clean host-visible `/music` bind mount, a Docker-managed `/config` volume, rebuildable `/cache` state, and ephemeral `/tmp/tuneflow`, while preserving explicit legacy-layout compatibility and providing a verified copy-only migration command.

**Architecture:** Resolve environment variables once into an explicit `StorageLayout`, then inject component-owned paths into the database, source, download, and library layers. Split-mode download records use media-relative and temp-relative paths; legacy mode retains its existing record encoding. A standalone migration command copies an offline legacy tree into empty split targets, normalizes copied records, verifies bytes and SQLite state, and commits the migration by writing a layout marker without modifying the source.

**Tech Stack:** TypeScript 5.9, Node.js 24, Fastify, better-sqlite3 13, Vitest 4, esbuild, Docker/Compose, GitHub Actions.

## Global Constraints

- Default Docker media mount: `${TUNEFLOW_MUSIC_DIR:-./music}:/music`.
- Durable internal mount: named volume `tuneflow-config:/config`.
- Split roots: `/config`, `/music`, `/cache`, and `/tmp/tuneflow`.
- Legacy `TUNEFLOW_STORAGE_ROOT` remains supported and must not be combined with any split-root variable.
- Legacy startup must preserve the current filesystem layout and current persisted download-path encoding.
- Migration is explicit, copy-only, requires stopped source state and empty targets, and never mutates the legacy source.
- `/cache` and `/tmp/tuneflow` are excluded from backup and restore.
- The runtime remains a non-root UID/GID 1000 process.
- Logs remain on stdout/stderr; no file log directory is created.
- Do not add dependencies unless current Node.js or better-sqlite3 APIs cannot satisfy a proven requirement.
- Do not trigger the Docker publishing workflow or overwrite Docker Hub tags without separate explicit authorization.

## File Structure

- `src/server/config.ts`: environment selection, `StorageLayout`, canonicalization, overlap checks, and directory initialization.
- `src/server/config.test.ts`: split/legacy selection, no-write conflict behavior, root containment, marker, permissions, and overlap tests.
- `src/server/storage/layoutMarker.ts`: layout-version marker validation and atomic creation.
- `src/server/storage/migrateLegacyStorage.ts`: copy-only migration engine, record normalization, verification, publish/cleanup, and result model.
- `src/server/storage/migrateLegacyStorage.test.ts`: success, failure, cleanup, source immutability, and rollback-fixture tests.
- `src/server/storage/migrateLegacyStorageCli.ts`: bounded command-line parsing and exit reporting.
- `src/server/db/databasePath.ts`: database-root-based current/legacy filename resolution.
- `src/server/db/settingsRepository.ts`: immutable media-root reporting.
- `src/server/sources/repository.ts`: explicit source-root ownership.
- `src/server/library/resources.ts`: explicit media/cache/temp paths.
- `src/server/library/scanner.ts`: media-root-only scanning and stable media-relative identity.
- `src/server/downloads/manager.ts`: separate media/temp resolvers and layout-aware persisted-path codec.
- `src/server/downloads/types.ts`: typed persisted-path layout revision.
- `src/server/app.ts`, `src/server/index.ts`, `src/server/api/generateOpenApi.ts`: resolved-layout wiring and help text.
- `build-config/server/build.mjs`: production migration CLI bundle.
- `build-config/server/verify-isolated-package.mjs`: packaged migration artifact and split-root runtime checks.
- `Dockerfile`, `compose.yaml`, `.dockerignore`: split Docker runtime and clean host media default.
- `.github/workflows/docker-build.yml`: split-root CI container lifecycle without changing publication semantics.
- `README.md`, `docs/server-web.md`: new install, ownership, backup/restore, legacy mode, migration, and rollback instructions.
- `build-config/server/electron-boundary.test.mjs`: static build/Docker/documentation contract checks.

---

### Task 1: Resolve and validate explicit storage layouts

**Files:**
- Create: `src/server/config.test.ts`
- Create: `src/server/storage/layoutMarker.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/index.test.ts`

**Interfaces:**
- Produces: `StorageLayout`, `ServerOptions`, `resolveStorageLayout(env)`, `createLegacyStorageLayout(root)`, `normalizeServerOptions(options)`, and `isPathInside(root, candidate)`.
- Produces: `ensureSplitLayoutMarker(configRoot)` and `readSplitLayoutMarker(configRoot)` with layout version `1`.
- Consumes: Node.js filesystem APIs only.

- [ ] **Step 1: Write failing layout-selection and no-write tests**

Add tests that construct isolated roots and assert exact component paths:

```ts
it('resolves all split roots without creating files when legacy configuration conflicts', () => {
  const root = createRoot()
  expect(() => resolveStorageLayout({
    TUNEFLOW_STORAGE_ROOT: path.join(root, 'legacy'),
    TUNEFLOW_CONFIG_ROOT: path.join(root, 'config'),
    TUNEFLOW_MEDIA_ROOT: path.join(root, 'music'),
    TUNEFLOW_CACHE_ROOT: path.join(root, 'cache'),
    TUNEFLOW_TEMP_ROOT: path.join(root, 'tmp'),
  })).toThrow('TUNEFLOW_STORAGE_ROOT cannot be combined with split storage variables')
  expect(readdirSync(root)).toEqual([])
})

it('maps legacy mode to the current directory contract', () => {
  const root = createRoot()
  const layout = createLegacyStorageLayout(root)
  expect(layout).toMatchObject({
    mode: 'legacy',
    configRoot: root,
    databaseRoot: root,
    sourceRoot: path.join(root, 'sources'),
    backupRoot: path.join(root, 'backups'),
    mediaRoot: path.join(root, 'audio'),
    cacheRoot: root,
    mediaIdentityPrefix: 'audio',
    tempRoot: path.join(root, 'tmp'),
    libraryResources: {
      coverRoot: path.join(root, 'cover'),
      lyricsRoot: path.join(root, 'lyrics'),
      indexRoot: path.join(root, 'library-resource-index'),
    },
  })
})

it('maps split roots to component-owned subdirectories', () => {
  const layout = resolveStorageLayout(splitEnvironment(createRoot()))
  expect(layout.databaseRoot).toBe(path.join(layout.configRoot, 'database'))
  expect(layout.sourceRoot).toBe(path.join(layout.configRoot, 'sources'))
  expect(layout.backupRoot).toBe(path.join(layout.configRoot, 'backups'))
  expect(layout.mediaIdentityPrefix).toBe('')
  expect(layout.libraryResources.indexRoot).toBe(path.join(layout.cacheRoot, 'library', 'index'))
})
```

Also cover partial split variables, base-root overlap, symlink overlap, read-only config/media roots, cache/temp recreation, an empty split config root, a valid marker, an unsupported marker version, and state without a marker.

- [ ] **Step 2: Run the focused test and confirm the missing API failures**

Run:

```bash
npx vitest run src/server/config.test.ts
```

Expected: FAIL because `StorageLayout`, split environment resolution, and layout marker APIs do not exist.

- [ ] **Step 3: Implement the explicit layout model**

Use these public shapes and keep the environment object injectable for tests:

```ts
export interface StorageLayout {
  mode: 'split' | 'legacy'
  configRoot: string
  databaseRoot: string
  sourceRoot: string
  backupRoot: string
  mediaRoot: string
  cacheRoot: string
  mediaIdentityPrefix: string
  libraryResources: {
    coverRoot: string
    lyricsRoot: string
    indexRoot: string
  }
  tempRoot: string
}

export interface ServerOptions {
  storage: StorageLayout
  webRoot: string
  host: string
  port: number
}

export const resolveStorageLayout: (env: NodeJS.ProcessEnv) => StorageLayout
export const createLegacyStorageLayout: (root: string) => StorageLayout
```

Implement the branch exactly as follows:

1. Detect whether `TUNEFLOW_STORAGE_ROOT` is present and whether any of the four split variables is present before calling `mkdirSync`.
2. Reject mixed legacy/split configuration.
3. If no storage variables are present, retain local-source compatibility with legacy `./data`.
4. If split mode is selected, require all four split variables and report the missing variable names.
5. In split mode, resolve base roots, reject equality/ancestor/descendant overlap, set `mediaIdentityPrefix` to an empty string, then derive component paths. In legacy mode, set `cacheRoot` to the legacy root and `mediaIdentityPrefix` to `audio`.
6. Create and probe config/media roots; create cache/temp roots; validate or create the split marker only after validation succeeds.
7. Preserve legacy directory creation exactly except that the unused `logs` directory is no longer created.

Implement `storage-layout.json` with `{ "version": 1 }`, atomic same-directory staging, `0o600` mode, and rejection of non-empty split config state without a marker. The marker does not apply to legacy mode.

Update `src/server/index.ts --help` to list the legacy variable and all four split variables without claiming Docker defaults for local source execution.

- [ ] **Step 4: Run focused layout tests**

Run:

```bash
npx vitest run src/server/config.test.ts src/server/index.test.ts
```

Expected: PASS with no filesystem artifacts left by conflict cases.

- [ ] **Step 5: Commit the layout boundary**

```bash
git add src/server/config.ts src/server/config.test.ts src/server/storage/layoutMarker.ts src/server/index.ts src/server/index.test.ts
git commit -m "refactor(storage): define split storage layout"
```

---

### Task 2: Move durable repositories onto config and media roots

**Files:**
- Modify: `src/server/db/databasePath.ts`
- Modify: `src/server/db/databasePath.test.ts`
- Modify: `src/server/db/core/db.ts`
- Modify: `src/server/db/settingsRepository.ts`
- Modify: `src/server/sources/repository.ts`
- Modify: `src/server/sources/source.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`
- Modify: `src/server/api/generateOpenApi.ts`
- Modify: `src/server/api/openapi.test.ts`

**Interfaces:**
- Consumes: `ServerOptions.storage` from Task 1.
- Produces: `resolveDatabasePath(databaseRoot)`, `migrateLegacyDatabaseFiles(databaseRoot)`, `new SettingsRepository(mediaRoot)`, and `new SourceRepository(sourceRoot)`.
- Produces: a running Service whose database and source writes are confined to config-owned paths.

- [ ] **Step 1: Write failing repository placement tests**

Update the app fixture to create separate config, media, cache, temp, and web roots. Add assertions after startup and source installation:

```ts
expect(existsSync(path.join(configRoot, 'database', 'tuneflow.data.db'))).toBe(true)
expect(settings.data['download.savePath']).toBe(realpathSync(mediaRoot))
expect(readdirSync(mediaRoot)).toEqual([])
expect(readdirSync(path.join(configRoot, 'sources'))).toContain(`${sourceHash}.js`)
expect(existsSync(path.join(mediaRoot, 'tuneflow.data.db'))).toBe(false)
```

Retain the database filename migration tests, but pass an explicit
`databaseRoot`. Add a source repository test proving a script cannot escape
`sourceRoot` through a database-controlled `script_path` value.

- [ ] **Step 2: Run the repository tests and verify old constructor failures**

Run:

```bash
npx vitest run src/server/db/databasePath.test.ts src/server/sources/source.test.ts src/server/app.test.ts src/server/api/openapi.test.ts
```

Expected: FAIL where repositories still accept or derive a shared storage root.

- [ ] **Step 3: Inject component roots through app creation**

Make the database functions treat their argument as `databaseRoot`. Change
constructors to these signatures:

```ts
export class SettingsRepository {
  constructor(private readonly mediaRoot: string) {}
}

export class SourceRepository {
  constructor(private readonly sourceRoot: string) {}
}
```

In `createServer`, initialize and wire them from `serverOptions.storage`:

```ts
const { storage } = serverOptions
if (initDatabase(storage.databaseRoot) == null) throw new Error('Unable to initialize TuneFlow database')
const settings = new SettingsRepository(storage.mediaRoot)
const sources = new SourcesService(new SourceRepository(storage.sourceRoot), publishAlert, sourceOptions)
```

Update OpenAPI generation and every programmatic server fixture to use
`storage: createLegacyStorageLayout(root)` or an explicit split fixture. Do not
leave a fallback `storageRoot` property in `ServerOptions`.

- [ ] **Step 4: Run focused state-placement tests**

Run:

```bash
npx vitest run src/server/db/databasePath.test.ts src/server/sources/source.test.ts src/server/app.test.ts src/server/api/openapi.test.ts
```

Expected: PASS; config-owned files do not appear under the media root.

- [ ] **Step 5: Commit durable-state placement**

```bash
git add src/server/db src/server/sources/repository.ts src/server/sources/source.test.ts src/server/app.ts src/server/app.test.ts src/server/api/generateOpenApi.ts src/server/api/openapi.test.ts
git commit -m "refactor(storage): isolate durable service state"
```

---

### Task 3: Isolate library media from rebuildable resources

**Files:**
- Modify: `src/server/library/resources.ts`
- Modify: `src/server/library/resources.test.ts`
- Modify: `src/server/library/scanner.ts`
- Modify: `src/server/library/scanner.test.ts`
- Modify: `src/server/library/metadataEnricher.ts`
- Modify: `src/server/library/metadataEnricher.test.ts`
- Modify: `src/server/routes/library-resources.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`

**Interfaces:**
- Consumes: `StorageLayout.mediaRoot`, `StorageLayout.mediaIdentityPrefix`, `StorageLayout.libraryResources`, and `StorageLayout.tempRoot`.
- Produces: `LibraryResourcePaths` and a scanner that accepts `mediaRoot` rather than a shared storage root.
- Produces: derived resources only under cache-owned paths and requested sidecars only under media.

- [ ] **Step 1: Write failing split media/cache tests**

Replace the shared-root resource fixture with explicit roots and assert exact
locations:

```ts
const store = new LibraryResourceStore({
  mediaRoot,
  coverRoot: path.join(cacheRoot, 'library', 'cover'),
  lyricsRoot: path.join(cacheRoot, 'library', 'lyrics'),
  indexRoot: path.join(cacheRoot, 'library', 'index'),
  tempRoot,
}, dependencies)

expect(resources.picture?.filePath.startsWith(path.join(cacheRoot, 'library', 'cover'))).toBe(true)
expect(resources.lyrics?.filePath.startsWith(path.join(cacheRoot, 'library', 'lyrics'))).toBe(true)
expect(readdirSync(mediaRoot)).toEqual(['track.flac'])
```

Add a cache deletion/restart test that removes the entire cache root, recreates
the store, refreshes the library, and verifies resources are regenerated from
the unchanged audio and visible `.lrc` sidecar.

- [ ] **Step 2: Run the focused library tests and confirm shared-root assumptions fail**

Run:

```bash
npx vitest run src/server/library/resources.test.ts src/server/library/scanner.test.ts src/server/library/metadataEnricher.test.ts src/server/routes/library-resources.test.ts
```

Expected: FAIL until constructors and containment checks accept explicit roots.

- [ ] **Step 3: Implement explicit library paths**

Use this interface:

```ts
export interface LibraryResourcePaths {
  mediaRoot: string
  coverRoot: string
  lyricsRoot: string
  indexRoot: string
  tempRoot: string
}
```

Remove derived-path calls to `getCoverRoot`, `getLyricsRoot`, and
`getLibraryResourceIndexRoot`. Resolve marker-relative cover/lyrics entries
against their explicit expected roots rather than a shared parent. Change
`LibraryScanner` to use `mediaRoot` for containment and an injected
`mediaIdentityPrefix` for stable identity:

```ts
const logicalPath = mediaIdentityPrefix === ''
  ? relative
  : `${mediaIdentityPrefix}/${relative}`
const identity = `${logicalPath}\0${stat.dev}\0${stat.ino}\0${stat.size}\0${stat.mtimeMs}`
```

Use an empty prefix in split mode and `audio` in legacy mode, preserving legacy
track IDs while making new split IDs media-relative. Keep recursive directory
scanning, sidecar behavior, and symlink rejection.
Wire `LibraryMetadataEnricher` and the app from `storage.mediaRoot`.

- [ ] **Step 4: Run focused library and app tests**

Run:

```bash
npx vitest run src/server/library/resources.test.ts src/server/library/scanner.test.ts src/server/library/metadataEnricher.test.ts src/server/routes/library-resources.test.ts src/server/app.test.ts
```

Expected: PASS with cache resources absent from media.

- [ ] **Step 5: Commit library isolation**

```bash
git add src/server/library src/server/routes/library-resources.test.ts src/server/app.ts src/server/app.test.ts
git commit -m "refactor(storage): isolate rebuildable library resources"
```

---

### Task 4: Separate final-download and temporary path codecs

**Files:**
- Modify: `src/server/downloads/types.ts`
- Modify: `src/server/downloads/manager.ts`
- Modify: `src/server/downloads/downloads.test.ts`
- Modify: `src/server/downloads/replacementPublisher.test.ts`
- Modify: `src/server/playback/proxy.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`

**Interfaces:**
- Consumes: `StorageLayout.mode`, `databaseRoot`, `mediaRoot`, and `tempRoot`.
- Produces: `DownloadRoots` and layout-aware `mediaRelative`, `tempRelative`, `resolveMedia`, and `resolveTemp` behavior.
- Preserves: legacy record strings such as `audio/name.flac` and `tmp/id.part` in legacy mode.
- Produces: split record strings such as `name.flac` and `id.part` in split mode.

- [ ] **Step 1: Add failing path-codec and containment tests**

Add paired legacy and split fixtures:

```ts
it('stores split final and partial paths relative to their owning roots', async() => {
  const manager = createManager({ mode: 'split', databaseRoot, mediaRoot, tempRoot })
  const job = await manager.create(createInput)
  const record = readStoredRecord(job.id)
  expect(record.finalRelativePath).toBe(`${job.fileName}`)
  expect(record.partRelativePath).toBe(`${job.id}.part`)
})

it('preserves legacy persisted path encoding', async() => {
  const manager = createManager({ mode: 'legacy', databaseRoot: root, mediaRoot: path.join(root, 'audio'), tempRoot: path.join(root, 'tmp') })
  const job = await manager.create(createInput)
  const record = readStoredRecord(job.id)
  expect(record.finalRelativePath).toBe(`audio/${job.fileName}`)
  expect(record.partRelativePath).toBe(`tmp/${job.id}.part`)
})
```

Add malicious record fixtures for absolute paths, `..`, symlink escapes,
media-as-temp, temp-as-media, replacement paths, publication lyric paths, and
metadata-patch paths. Each must fail without reading or deleting outside its
own root. Add a split-layout completion test that keeps the part under
`tempRoot`, requires publication staging under the final media directory, and
injects a rename guard that throws `EXDEV` for any cross-root rename. Add crash
recovery cases before and after the media-local staging rename, plus bounded
cleanup of orphaned `.tuneflowtmp` files.

- [ ] **Step 2: Run the download tests and verify the split fixture fails**

Run:

```bash
npx vitest run src/server/downloads/downloads.test.ts src/server/downloads/replacementPublisher.test.ts
```

Expected: FAIL because `DownloadManager` still derives media and temp from
`storageRoot`.

- [ ] **Step 3: Implement an explicit layout-aware path codec**

Change the options boundary to:

```ts
export interface DownloadRoots {
  mode: 'split' | 'legacy'
  databaseRoot: string
  mediaRoot: string
  tempRoot: string
}

interface DownloadManagerOptions {
  roots: DownloadRoots
  // retain the existing callbacks and dependencies unchanged
}
```

Implement four private operations and route every persisted path field through
the correct pair:

```ts
private mediaRelative(filePath: string): string
private tempRelative(filePath: string): string
private resolveMedia(relativePath: string): string
private resolveTemp(relativePath: string): string
```

In legacy mode, encode relative to `databaseRoot` so existing strings remain
unchanged, but still require the resolved result to remain inside `mediaRoot`
or `tempRoot`. In split mode, encode and resolve directly against the owning
root. Do not use a generic resolver for both categories.

Cover `finalRelativePath`, `partRelativePath`, replacement originals,
publication staged/final media and lyrics, replacement staged/final media and
lyrics, and metadata-patch staging paths. Final `.lrc` paths and hidden
`.tuneflowtmp` publication paths are media paths; `.part` and `.part.lrc` paths
are temporary paths.

For split mode, never call `renameSync` from `tempRoot` to `mediaRoot`:

1. fsync and checksum the completed temp part;
2. copy it with exclusive creation to a hidden `.tuneflowtmp` file beside the
   final destination, fsync it, and verify its checksum;
3. persist the media-relative staging path in the publication/replacement
   marker;
4. atomically rename the media-local staging file to the final path;
5. fsync the destination directory, mark publication complete, and remove the
   temp part.

Apply the same sequence to requested lyrics. Recovery accepts only a verified
media-local staging file or a verified final file. `LibraryMetadataEnricher`
keeps its existing destination-local transaction and rollback files because
same-filesystem rename is part of its safety contract; these are the explicit
exception to general `tempRoot` placement. Startup cleanup removes only bounded
orphan names after checking that no active marker references them.

- [ ] **Step 4: Run download, app, and library integration tests**

Run:

```bash
npx vitest run src/server/downloads/downloads.test.ts src/server/downloads/replacementPublisher.test.ts src/server/app.test.ts src/server/playback/proxy.test.ts
```

Expected: PASS in both storage modes, including recovery and cleanup cases.

- [ ] **Step 5: Commit download root separation**

```bash
git add src/server/downloads src/server/app.ts src/server/app.test.ts src/server/playback/proxy.test.ts
git commit -m "refactor(storage): separate media and temporary downloads"
```

---

### Task 5: Build the copy-only legacy migration command

**Files:**
- Create: `src/server/storage/migrateLegacyStorage.ts`
- Create: `src/server/storage/migrateLegacyStorage.test.ts`
- Create: `src/server/storage/migrateLegacyStorageCli.ts`
- Modify: `build-config/server/build.mjs`
- Modify: `build-config/server/verify-isolated-package.mjs`
- Modify: `build-config/server/electron-boundary.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: legacy layout creation and split layout paths from Task 1.
- Consumes: the path-category rules from Task 4.
- Produces: `migrateLegacyStorage(options): Promise<MigrationResult>`.
- Produces: `dist/server/migrate-storage.cjs` and `npm run migrate:storage -- --from ... --config-root ... --media-root ...`.

- [ ] **Step 1: Create a failing representative migration fixture**

Build a stopped legacy fixture containing:

- a valid SQLite database with settings, source metadata, one completed
  download, one unfinished download, publication/replacement/metadata-patch
  path fields, and playback/list state;
- matching custom source scripts;
- nested audio and `.lrc` files;
- derived cover/lyrics/index files that must be omitted;
- temporary partials and logs that must be omitted;
- backups that must be retained.

Assert the successful result exactly:

```ts
const result = await migrateLegacyStorage({ legacyRoot, configRoot, mediaRoot, now: () => fixedTime })
expect(result).toMatchObject({ layoutVersion: 1, mediaFiles: 3, sourceFiles: 2 })
expect(readFileSync(path.join(configRoot, 'storage-layout.json'), 'utf8')).toContain('"version":1')
expect(existsSync(path.join(configRoot, 'database', 'tuneflow.data.db'))).toBe(true)
expect(existsSync(path.join(mediaRoot, 'nested', 'track.flac'))).toBe(true)
expect(existsSync(path.join(configRoot, 'cover'))).toBe(false)
expect(existsSync(path.join(mediaRoot, 'tmp'))).toBe(false)
expect(snapshotTree(legacyRoot)).toEqual(beforeMigration)
```

Read the copied `web_downloads` rows and assert completed media-relative paths,
paused unfinished jobs with zero progress, cleared ETag/Last-Modified fields,
and normalized nested path fields.

- [ ] **Step 2: Add failure and rollback tests before implementation**

Add separate tests for non-empty targets, overlapping roots, insufficient
space through an injected `statfs` dependency, corrupt SQLite, missing source
script, source mutation between manifests, injected copy interruption,
checksum mismatch, and injected failure during target publication. For every
case assert:

```ts
expect(snapshotTree(legacyRoot)).toEqual(sourceBefore)
expect(readdirSync(configRoot)).toEqual([])
expect(readdirSync(mediaRoot)).toEqual([])
```

Add a rollback fixture that starts the legacy Service against the unchanged
legacy root after a successful copy migration.

- [ ] **Step 3: Run migration tests and confirm the API is missing**

Run:

```bash
npx vitest run src/server/storage/migrateLegacyStorage.test.ts
```

Expected: FAIL because the migration engine does not exist.

- [ ] **Step 4: Implement preflight, staging, normalization, verification, and commit point**

Use this boundary:

```ts
export type MigrationPhase = 'preflight' | 'copy' | 'normalize' | 'verify' | 'publish'

export interface MigrationOptions {
  legacyRoot: string
  configRoot: string
  mediaRoot: string
  now?: () => number
  createId?: () => string
  statfs?: typeof import('node:fs').statfsSync
  onPhase?: (phase: MigrationPhase) => void
}

export interface MigrationResult {
  layoutVersion: 1
  mediaFiles: number
  mediaBytes: number
  sourceFiles: number
  sourceManifestDigest: string
}

export const migrateLegacyStorage = async(options: MigrationOptions): Promise<MigrationResult> => {}
```

Implementation order is fixed:

1. Canonicalize roots and require the old container to be stopped by taking two
   stable source manifests around preflight; reject changes.
2. Require empty destination roots and calculate required bytes with streaming
   file traversal and `statfsSync` available bytes.
3. Create hidden staging directories inside each destination filesystem.
4. Stream-copy media, database/sidecars, sources, and backups with source and
   destination SHA-256 calculation; preserve file modes without following
   symlinks.
5. Open only the staged copied database, run `PRAGMA integrity_check`, normalize
   every download path category, and verify source-table/script consistency.
6. Recompute the legacy manifest and reject any source change.
7. Publish known top-level artifacts with same-filesystem `renameSync`.
8. Write and fsync the layout marker last; it is the commit point.
9. Before the marker exists, catch any failure and remove both staging paths and
   every final artifact created by this run. Never remove source paths.

The CLI accepts only `--from`, `--config-root`, `--media-root`, and `--help`.
It prints phases, counts, byte totals, and final target roots without printing
settings, scripts, credentials, or media contents.

- [ ] **Step 5: Bundle and verify the migration CLI**

Add a fourth esbuild entry that produces
`dist/server/migrate-storage.cjs`, sharing the Service aliases and external
package policy. Add:

```json
"migrate:storage": "node dist/server/migrate-storage.cjs"
```

Extend isolated-package verification to assert the CLI artifact exists and its
`--help` command exits zero without creating storage directories.

- [ ] **Step 6: Run migration and build-config tests**

Run:

```bash
npx vitest run src/server/storage/migrateLegacyStorage.test.ts src/server/downloads/downloads.test.ts src/server/db/databasePath.test.ts
npm run build:server
node dist/server/migrate-storage.cjs --help
npm run test:build-config
```

Expected: all commands exit `0`; the migration fixture leaves its legacy tree
byte-identical and all negative cases leave empty targets.

- [ ] **Step 7: Commit the migration tool**

```bash
git add src/server/storage build-config/server package.json
git commit -m "feat(storage): add explicit legacy layout migration"
```

---

### Task 6: Switch Docker defaults and document the durability contract

**Files:**
- Modify: `Dockerfile`
- Modify: `compose.yaml`
- Modify: `.dockerignore`
- Modify: `.github/workflows/docker-build.yml`
- Modify: `README.md`
- Modify: `docs/server-web.md`
- Modify: `build-config/server/electron-boundary.test.mjs`
- Add: `docs/superpowers/specs/2026-08-17-split-docker-storage-layout-design.md`
- Add: `docs/superpowers/plans/2026-08-17-split-docker-storage-layout.md`

**Interfaces:**
- Consumes: the four split environment variables and migration CLI from Tasks 1 and 5.
- Produces: a new-install Compose contract with only `./music` host-visible and `tuneflow-config` Docker-managed.
- Preserves: existing image build, health endpoint, amd64 publication tags, and non-root runtime.

- [ ] **Step 1: Write failing static Docker/documentation contract checks**

Extend `electron-boundary.test.mjs` to assert:

```js
assert.match(dockerfile, /TUNEFLOW_CONFIG_ROOT=\/config/)
assert.match(dockerfile, /TUNEFLOW_MEDIA_ROOT=\/music/)
assert.match(dockerfile, /TUNEFLOW_CACHE_ROOT=\/cache/)
assert.match(dockerfile, /TUNEFLOW_TEMP_ROOT=\/tmp\/tuneflow/)
assert.doesNotMatch(dockerfile, /TUNEFLOW_STORAGE_ROOT=\/data/)
assert.match(compose, /\$\{TUNEFLOW_MUSIC_DIR:-\.\/music\}:\/music/)
assert.match(compose, /tuneflow-config:\/config/)
assert.doesNotMatch(compose, /:\/data/)
```

Also assert README and Service documentation name `/config/database`,
`/music`, `/cache/library`, `/tmp/tuneflow`, UID/GID 1000, the two-part backup,
and the explicit migration/rollback command.

- [ ] **Step 2: Run the static test and confirm old `/data` assertions fail**

Run:

```bash
node --test build-config/server/electron-boundary.test.mjs
```

Expected: FAIL against the current Dockerfile and Compose mounts.

- [ ] **Step 3: Update Dockerfile and Compose**

In the runtime image:

```dockerfile
RUN mkdir -p /config /music /cache /tmp/tuneflow \
 && chown -R node:node /config /music /cache /tmp/tuneflow

ENV TUNEFLOW_CONFIG_ROOT=/config \
    TUNEFLOW_MEDIA_ROOT=/music \
    TUNEFLOW_CACHE_ROOT=/cache \
    TUNEFLOW_TEMP_ROOT=/tmp/tuneflow

VOLUME ["/config", "/music"]
```

Keep the existing host, port, web-root, runtime-module, user, healthcheck, and
command settings. Remove `/data` creation and `TUNEFLOW_STORAGE_ROOT` from the
image.

Change Compose to the approved mounts and keep the existing service name,
ports, init, restart, and healthcheck. Add `music` to `.dockerignore` so host
media never enters a build context.

- [ ] **Step 4: Keep GitHub Actions health checks aligned without publishing**

Replace the single CI data volume with `CI_CONFIG_VOLUME` and
`CI_MUSIC_VOLUME`, mount them at `/config` and `/music`, and remove both in the
existing `if: always()` cleanup. Do not run the workflow in this task because
its successful path publishes Docker Hub tags.

- [ ] **Step 5: Rewrite Docker usage, backup, migration, and rollback documentation**

Document exact new-install preparation:

```bash
mkdir -p ./music
sudo chown -R 1000:1000 ./music
docker compose up -d
```

Document `docker run` with `./music:/music` and
`tuneflow-config:/config`. Document a stopped two-part backup and restore.
Document an explicit one-shot migration command that mounts the old volume
read-only, the new config volume, and `./music`, then invokes
`migrate-storage.cjs`. State that `/cache`, `/tmp/tuneflow`, and logs are not
backup inputs, and that rollback reattaches the untouched old volume to the
prior image/Compose definition.

- [ ] **Step 6: Run static, YAML, and focused documentation checks**

Run:

```bash
ruby -e "require 'yaml'; ARGV.each { |path| YAML.load_file(path, aliases: true) }" compose.yaml .github/workflows/docker-build.yml
npm run test:build-config
git diff --check
```

Expected: all commands exit `0`, with no `/data` default remaining in Docker
runtime configuration and with legacy `/data` mentioned only in migration and
compatibility documentation.

- [ ] **Step 7: Commit Docker defaults and approved documentation**

```bash
git add Dockerfile compose.yaml .dockerignore .github/workflows/docker-build.yml README.md docs/server-web.md build-config/server/electron-boundary.test.mjs docs/superpowers/specs/2026-08-17-split-docker-storage-layout-design.md docs/superpowers/plans/2026-08-17-split-docker-storage-layout.md
git commit -m "feat(storage): split Docker media and config volumes"
```

---

### Task 7: Freeze and verify the integrated result

**Files:**
- Review only: all files changed by Tasks 1–6.

**Interfaces:**
- Consumes: the frozen split-layout implementation, migration fixture, Docker configuration, and documentation.
- Produces: evidence for Service behavior, migration safety, build integrity, and any remaining Docker-runtime limitation.

- [ ] **Step 1: Run the complete project verification**

```bash
npm test
```

Expected: production Web and Service builds succeed; all Vitest and build-config
tests pass. If the known source-worker 100 ms timing test flakes under load,
run that exact focused test once to classify it, then rerun the full suite only
after recording the evidence; do not hide a reproducible failure.

- [ ] **Step 2: Build and inspect the production Docker image locally**

```bash
docker build --tag tuneflow-server-web:split-storage-check .
```

Expected: exit `0`; the Service and migration CLI are present in the runtime
image. If no Docker daemon is available, record Docker runtime verification as
not run and do not substitute a publishing GitHub Action without authorization.

- [ ] **Step 3: Run the split-mount Docker health and location check**

Run this bounded check, which creates uniquely named disposable resources and
cleans only those resources on exit:

```bash
TF_MUSIC_TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tuneflow-music-check.XXXXXX")"
case "$TF_MUSIC_TEST_DIR" in
  "${TMPDIR:-/tmp}"/tuneflow-music-check.*) ;;
  *) echo "unexpected temporary path: $TF_MUSIC_TEST_DIR" >&2; exit 1 ;;
esac
TF_TEST_ID="$(basename "$TF_MUSIC_TEST_DIR" | tr -cd '[:alnum:]')"
TF_TEST_CONTAINER="tuneflow-split-check-$TF_TEST_ID"
TF_TEST_CONFIG_VOLUME="tuneflow-split-config-$TF_TEST_ID"
cleanup_split_check() {
  docker rm -f "$TF_TEST_CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$TF_TEST_CONFIG_VOLUME" >/dev/null 2>&1 || true
  find "$TF_MUSIC_TEST_DIR" -mindepth 1 -delete
  rmdir "$TF_MUSIC_TEST_DIR"
}
trap cleanup_split_check EXIT
chmod 0777 "$TF_MUSIC_TEST_DIR"
docker volume create "$TF_TEST_CONFIG_VOLUME"
docker run -d --name "$TF_TEST_CONTAINER" \
  -v "$TF_TEST_CONFIG_VOLUME:/config" \
  -v "$TF_MUSIC_TEST_DIR:/music" \
  tuneflow-server-web:split-storage-check
for attempt in $(seq 1 30); do
  TF_HEALTH_STATUS="$(docker inspect --format '{{.State.Health.Status}}' "$TF_TEST_CONTAINER")"
  [ "$TF_HEALTH_STATUS" = healthy ] && break
  [ "$TF_HEALTH_STATUS" = unhealthy ] && break
  sleep 2
done
[ "$TF_HEALTH_STATUS" = healthy ] || { docker logs "$TF_TEST_CONTAINER"; exit 1; }
docker exec "$TF_TEST_CONTAINER" test -f /config/database/tuneflow.data.db
docker exec "$TF_TEST_CONTAINER" test ! -e /music/tuneflow.data.db
docker exec "$TF_TEST_CONTAINER" test ! -e /music/sources
docker exec "$TF_TEST_CONTAINER" test -f /config/storage-layout.json
```

Do not use or modify the repository's existing `data/` tree or any active
deployment.

- [ ] **Step 4: Verify copy-only migration and packaged CLI behavior**

Run the exact automated fixture and packaged-command checks:

```bash
npx vitest run src/server/storage/migrateLegacyStorage.test.ts
docker run --rm tuneflow-server-web:split-storage-check \
  node dist/server/migrate-storage.cjs --help
```

Expected: the migration suite proves the legacy manifest is identical,
migrated media is discoverable, completed downloads resolve, unfinished jobs
are paused at zero bytes, and config/cache files are absent from the target
music directory; the packaged CLI help exits `0` without creating storage.

- [ ] **Step 5: Review final diff and repository state**

```bash
git diff --check
git status --short --branch
git log -6 --oneline
```

Expected: no unstaged implementation changes or untracked task artifacts;
commits correspond to the approved tasks; no secrets, debug files, test media,
Docker volumes, or generated cache/temp data are tracked.

- [ ] **Step 6: Report the frozen result without external publication**

Report exact test/build commands and outcomes, migration source/target manifest
evidence, Docker image identity if built, changed durability/backup behavior,
legacy compatibility, and any unverified boundary. Do not push, publish, deploy,
or run the Docker publishing workflow unless the user separately authorizes
those external actions.
