# Split Docker Storage Layout Design

**Date:** 2026-08-17

## Goal

Keep the host-visible Docker media directory clean while preserving all durable
TuneFlow state and providing a safe, explicit migration from the legacy
single-root `/data` layout.

New Docker installations expose only downloaded media and user-requested lyric
sidecars through a host bind mount. Service configuration and state live in a
Docker-managed volume. Derived resources and temporary files are not part of
the backup contract.

## Current State

The Service currently derives every path from `TUNEFLOW_STORAGE_ROOT`, which is
`/data` in the Docker image. A single mounted directory therefore contains:

- `audio/`: downloaded and scanned media, including user-requested `.lrc`
  sidecars;
- `tuneflow.data.db` and live SQLite WAL/SHM files;
- `sources/`: installed custom source scripts;
- `cover/`, `lyrics/`, and `library-resource-index/`: derived library resources
  and their index;
- `tmp/`: resumable download parts and atomic-write staging files;
- `backups/`: retained migration or operator-created backups;
- `logs/`: currently created but not used because logs go to stdout/stderr.

Only the media is intended for normal host-side access. The database and source
scripts must persist but should be treated as internal Service state. Derived
resources are reproducible, temporary data must not be backed up, and the file
log directory has no runtime purpose.

## Requirements

1. Default Docker usage exposes a clean host `./music` directory.
2. SQLite state, custom sources, and migration backups survive container
   recreation without appearing in `./music`.
3. Derived resources can be discarded and rebuilt without data loss.
4. Temporary download and atomic-write files are container-local and excluded
   from backups.
5. Existing `TUNEFLOW_STORAGE_ROOT` deployments continue to run unchanged until
   their operator explicitly migrates them.
6. Migration never mutates the legacy source volume and has a direct rollback
   path.
7. The Service continues to run as a non-root UID/GID 1000 user.

## Non-goals

- Automatically moving an existing `/data` tree during ordinary Service
  startup.
- Letting the browser or API choose arbitrary host paths.
- Persisting or backing up derived caches and partial downloads.
- Changing the application version solely for this storage refactor.
- Adding file-based application logging.

## Selected Layout

| Data | New path | Persistence | User-visible |
| --- | --- | --- | --- |
| Audio and requested `.lrc` sidecars | `/music` | Host bind mount | Yes |
| SQLite database and WAL/SHM | `/config/database` | Docker named volume | No |
| Installed custom source scripts | `/config/sources` | Docker named volume | No |
| Migration/operator backups | `/config/backups` | Docker named volume | No |
| Derived cover, lyrics, and resource index | `/cache/library` | Rebuildable container state | No |
| Download parts and non-publication staging | `/tmp/tuneflow` | Ephemeral container state | No |
| Atomic media publication staging | Hidden file beside the `/music` destination | Short-lived transaction state | No |
| Logs | stdout/stderr | Docker logging driver | Via `docker logs` |

Lowercase Linux paths are used even though the conceptual directory is called
"Config" in user-facing discussion.

## Storage Configuration

`ServerOptions` is replaced by a layout that carries explicit component paths.
Split-mode environment variables still define four base roots, but consumers do
not reconstruct their own subpaths:

```ts
interface StorageLayout {
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
```

Split mode reads these environment variables:

| Variable | Docker default | Purpose |
| --- | --- | --- |
| `TUNEFLOW_CONFIG_ROOT` | `/config` | Durable internal state |
| `TUNEFLOW_MEDIA_ROOT` | `/music` | User media |
| `TUNEFLOW_CACHE_ROOT` | `/cache` | Rebuildable derived state |
| `TUNEFLOW_TEMP_ROOT` | `/tmp/tuneflow` | Ephemeral work files |

Selecting split mode requires all four variables. Partial split configuration
is rejected before the Service creates or opens any storage path.

Legacy mode remains available when only `TUNEFLOW_STORAGE_ROOT` is set. It maps
the explicit component paths back to the existing layout:

- configuration and database root: the legacy root;
- source and backup roots: `<legacy>/sources` and `<legacy>/backups`;
- media root: `<legacy>/audio`;
- cache root: the legacy root;
- media identity prefix: `audio`, preserving existing library track IDs;
- library resource roots: `<legacy>/cover`, `<legacy>/lyrics`, and
  `<legacy>/library-resource-index`;
- temporary root: `<legacy>/tmp`.

Setting `TUNEFLOW_STORAGE_ROOT` together with any split-layout variable is an
error. The Service must fail before opening a database or writing any file so
that ambiguous configuration cannot divide state between layouts.

Every configured base root is resolved and canonicalized independently. In
split mode, the four base roots must be distinct and non-overlapping; component
directories are then intentionally nested beneath their owning base root.
Legacy mode intentionally maps several component roots beneath or equal to the
single legacy root. The containment helpers must validate paths against the
explicit component path instead of a former shared parent.

## Component Boundaries

### Database and settings

The database path becomes
`<configRoot>/database/tuneflow.data.db`. WAL and SHM remain beside the database.
`SettingsRepository` receives `mediaRoot` separately and always reports it as
the immutable `download.savePath`; a stale persisted value cannot override the
layout.

### Custom sources

`SourceRepository` stores scripts under `<configRoot>/sources`. Source metadata
remains in SQLite. Scripts remain accessible through the controlled export API,
so normal operation never requires direct filesystem access to the config
volume.

### Downloads

`DownloadManager` receives `mediaRoot` and `tempRoot` instead of a shared
storage root. Final paths and hidden publication staging paths are relative to
`mediaRoot`; resumable parts and preprocessing paths are relative to
`tempRoot`. Each resolver accepts only its own relative path kind and rejects
absolute paths, traversal, symlink escapes, and cross-root references.

Because `/tmp/tuneflow` and `/music` may be separate filesystems, publication
never renames a part directly across those roots. It copies the verified part
to a uniquely named hidden staging file beside the final media destination,
fsyncs and verifies that copy, persists a recovery marker, and then performs a
same-filesystem atomic rename. Lyrics use the same two-stage publication. On
success the temp part is removed; after a crash the marker recovers the media
staging file or the already-published final file.

Requested `.lrc` sidecars are published beside their final audio file in
`mediaRoot`, making them intentional user-visible media artifacts. Failed or
in-progress parts remain under `tempRoot`.

### Library and derived resources

`LibraryScanner` scans only `mediaRoot`. `LibraryResourceStore` reads audio from
`mediaRoot` and writes derived resources under:

- `<cacheRoot>/library/cover`;
- `<cacheRoot>/library/lyrics`;
- `<cacheRoot>/library/index`.

Cache marker paths are relative to the cache layout. In split mode, audio
identity uses the path relative to `mediaRoot`; in legacy mode, the logical
`audio/` prefix is retained so existing library track IDs do not change.
Missing, stale, or malformed cache entries are deleted or regenerated from
media metadata and visible `.lrc` sidecars.

### Temporary files and logs

Resumable downloads and general Service temporary files use `tempRoot`.
Short-lived atomic publication and metadata-replacement transaction files are
the explicit exception: they must be created beside their media destination so
that the commit rename cannot fail with `EXDEV`. They use the bounded
`.tuneflowtmp` naming convention, are never backup inputs, and are recovered or
removed during startup cleanup. The unused `logs` directory is no longer
created; application logs continue to stdout/stderr.

## Docker and Compose Defaults

The runtime image creates `/config`, `/music`, `/cache`, and `/tmp/tuneflow`
with UID/GID 1000 ownership, declares `/config` and `/music` as durable volume
locations, and declares the four split-layout environment variables. It no
longer declares or uses `/data` as the default Service root.

Compose exposes two durable mounts:

```yaml
services:
  tuneflow-web:
    volumes:
      - ${TUNEFLOW_MUSIC_DIR:-./music}:/music
      - tuneflow-config:/config

volumes:
  tuneflow-config:
```

`/cache` stays in the container writable layer and is regenerated after a
container replacement. `/tmp/tuneflow` stays ephemeral. Neither path is part of
the volume or backup contract.

The image continues to run as the non-root `node` user. Documentation requires
operators to create the host music directory before startup and make it
writable by UID/GID 1000. The Service never elevates privileges or changes host
ownership from inside the container.

## Explicit Legacy Migration

Migration is a separate command, not a normal startup side effect. The old
container must be stopped. The source volume is mounted read-only at a legacy
path, while the new config volume and host music directory are mounted as
writable targets.

The migration command performs these phases:

1. **Preflight**
   - verify that the source is a recognizable legacy layout;
   - reject a running or uncleanly changing source database;
   - require empty destination config and media roots;
   - verify distinct, non-overlapping roots and sufficient free space;
   - create no target data until all checks pass.
2. **Copy**
   - copy `audio/` into `mediaRoot`;
   - copy the database and any required SQLite sidecars into
     `<configRoot>/database`;
   - copy `sources/` and `backups/` into `configRoot`;
   - deliberately skip derived cover/lyrics/index data, `tmp/`, and `logs/`.
3. **Normalize copied state**
   - convert completed download paths from legacy `audio/...` form to paths
     relative to `mediaRoot`;
   - convert all temporary path fields to paths relative to `tempRoot`;
   - preserve completed records and integrity metadata;
   - retain unfinished jobs but set them to paused, clear partial byte progress
     and transport validators, and assign fresh empty temporary paths;
   - normalize replacement, publication, staged lyric, and metadata-patch path
     fields using their media or temporary root semantics.
4. **Verify**
   - run SQLite `PRAGMA integrity_check` against the copied database;
   - verify every installed source referenced by SQLite has its copied script;
   - compare media file counts, byte sizes, and streaming SHA-256 checksums;
   - confirm every completed download record resolves inside `mediaRoot`;
   - confirm no config record resolves into the legacy root.
5. **Publish targets**
   - fsync copied files and parent directories where supported;
   - stage data inside each destination filesystem, then atomically rename each
     top-level config or media artifact into its final path; no cross-filesystem
     rename is assumed;
   - write `<configRoot>/storage-layout.json` with layout version `1`, migration
     time, and a source manifest digest;
   - leave the legacy volume untouched.

Migration refuses to merge into non-empty targets and never deletes source
files. Until the layout marker is written, a failed run removes its staging
paths and every final target artifact created by that run; this is safe because
preflight required empty targets. The marker is the migration commit point.
After a successful migration, rollback consists of stopping the new container
and starting the prior Compose configuration with the untouched legacy volume.

## New-install and Startup Behavior

For a new split-layout installation, the Service creates the config database,
source, and backup directories; media, cache, and temp roots; and a layout
marker. Existing split installations require a supported marker version.

Startup fails before serving traffic when:

- legacy and split environment variables conflict;
- roots overlap or resolve through symlinks into one another;
- config or media roots are not writable;
- a config root contains state but lacks a valid layout marker;
- the database is invalid or a required source script is missing.

Cache corruption is not a startup failure. Invalid cache entries are removed
and rebuilt. A missing temp root is recreated. These behaviors are bounded to
their configured roots.

## Backup and Restore Contract

A complete durable backup has two coordinated parts:

1. the stopped `tuneflow-config` volume; and
2. the host `music` directory.

Both are captured while the Service is stopped so SQLite records and media
files describe the same point in time. `/cache` and `/tmp/tuneflow` are never
backed up. Restore targets must be empty, preserve UID/GID 1000 write access,
and pass the same layout/database/source validation before the Service starts.

## Security and Privacy

- Only `/music` is intended for normal host-side browsing.
- Config files are kept in a Docker-managed named volume and are not served as
  static files.
- Custom source export remains API-controlled and bounded by existing size and
  validation rules.
- Root separation and per-root containment checks prevent a source, download,
  cache marker, or database record from redirecting writes across boundaries.
- Migration output and diagnostics report paths and counts but never print
  source-script contents, credentials, settings values, or media contents.

## Verification

### Configuration tests

- split defaults resolve to the four Docker roots;
- legacy-only configuration reproduces the current layout;
- mixed legacy/split variables fail before filesystem mutation;
- overlapping, symlinked, missing, and read-only roots are handled as designed.

### Component tests

- database and source writes remain under `configRoot`;
- final audio and requested sidecars remain under `mediaRoot`;
- download parts and preprocessing files remain under `tempRoot`;
- media publication transaction files are hidden, destination-local, bounded,
  and removed or recovered on startup;
- cover, derived lyrics, and indexes remain under their explicit
  `libraryResources` roots derived from the configured cache base;
- cache deletion followed by a library refresh regenerates resources;
- no component can resolve a stored path into another root.

### Migration tests

- a representative legacy fixture migrates database, sources, backups, media,
  completed downloads, unfinished downloads, sidecars, and replacement states;
- cache, temp, and logs are omitted;
- source media and legacy state remain byte-identical;
- destination non-empty, insufficient-space, corrupt-database, missing-source,
  interrupted-copy, and checksum-mismatch cases fail without publication;
- rerunning after a failed unpublished attempt is safe;
- rollback starts successfully against the untouched legacy fixture.

### Docker tests

- build the production image;
- run it with `./music:/music` and a named `/config` volume;
- require a healthy container;
- create a download or deterministic fixture and assert only user media appears
  under the host music directory;
- assert database and source files exist only in the config volume;
- assert cache and temp files are absent from both durable mounts;
- remove and recreate the container, then verify durable state and cache
  regeneration.

### Documentation checks

README, `docs/server-web.md`, Dockerfile, Compose examples, `docker run`
commands, backup instructions, and migration commands must use the same paths,
environment variables, ownership rules, and durability classification.

## Rollout

1. Implement root separation and retain legacy mode.
2. Add the migration command and fixture-driven verification.
3. Update Docker defaults and documentation for new installations.
4. Run focused Service tests, the full project suite, and Docker split-mount
   health/write-location verification.
5. Publish only after the migration and rollback paths are proven against an
   unchanged legacy fixture.
