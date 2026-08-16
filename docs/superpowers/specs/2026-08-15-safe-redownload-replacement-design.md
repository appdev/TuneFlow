# Safe Redownload Replacement Design

**Date:** 2026-08-15

**Status:** Approved design; implementation has not started.

## Goal

Let a user explicitly redownload a track that already exists in the Service
library. The Service keeps the existing file usable until the replacement has
been fully downloaded, validated, and tagged. A successful replacement becomes
the only retained format; any failure leaves the existing file unchanged.

Preserve the multi-source policy established by the approved fallback design:
prefer audio, lyrics, and artwork from one complete source, mix validated
components only when necessary, never join audio bytes from different sources,
and bind final metadata to the audio candidate that actually completed the
download.

## Scope

This design changes:

- The Service download-create contract and existing-file policy.
- Download job persistence, replacement publication, crash recovery, and
  completed-record reconciliation.
- The internal multi-source download candidate model and bundle assembly.
- User-initiated download coordination in the hosted Web client and the
  independent Flutter client.
- Focused Service, Web, and Flutter tests for the new behavior.

This design does not define the Flutter mobile dialog's final component,
layout, motion, or colors. That client is redesigning its dialog system. This
work supplies a shared confirmation abstraction and behavior contract that the
new dialog system can render without changing the Service API.

## Confirmed Product Decisions

- A user-initiated download checks for a matching local file before online
  source resolution.
- When a matching file exists, the client asks for confirmation instead of
  silently adopting or overwriting it.
- The shared confirmation message is `重新下载成功后将替换现有文件。` and the
  actions are `取消` and `确定`.
- Confirming creates a replacement download. Cancelling creates no task.
- The existing file remains available throughout resolution, transfer,
  validation, and metadata writing.
- A replacement is published only after the new audio is complete, parseable,
  synchronized, and successfully processed by the configured metadata writer.
- Failure, pause, cancellation, or a publication conflict never removes or
  mutates the existing file.
- When the replacement changes format, publish the new format first and then
  remove the old format. After recovery completes, only the new format remains.
- Playback-triggered automatic saving reuses an existing local file and never
  opens a confirmation UI.
- Hosted Web participates in the same confirmation behavior. Flutter uses a
  confirmation abstraction while its platform presentation remains owned by
  the dialog-system redesign.

## Existing-File Policy Contract

Extend `POST /api/v1/downloads` with an optional field:

```ts
type ExistingFilePolicy = 'reuse' | 'error' | 'replace' | 'duplicate'

interface DownloadCreateInput {
  // Existing fields remain unchanged.
  existingFilePolicy?: ExistingFilePolicy
}
```

The policies mean:

- `reuse`: adopt the matching local file and return a completed download job.
- `error`: return `409 DOWNLOAD_ALREADY_EXISTS` without creating a task or
  performing online source resolution.
- `replace`: snapshot the current matching file and create a replacement job.
  If no matching file exists by the time this request is handled, create a
  normal download job.
- `duplicate`: keep the matching file and create a collision-safe sibling such
  as `Song (1).flac`.

An explicit `existingFilePolicy` takes precedence over both the legacy
`skipExisting` request field and `download.skipExistFile` setting. This removes
the current one-way boolean behavior in which a `true` setting cannot be
overridden by an explicit request.

For backward compatibility, a request without `existingFilePolicy` retains the
current interpretation:

```text
skipExisting == true OR download.skipExistFile == true -> reuse
otherwise                                             -> duplicate
```

The hosted Web and Flutter clients use `error` for every user-initiated
download. On confirmation they repeat the request with `replace`. Automatic
playback saves use `reuse`.

`DOWNLOAD_ALREADY_EXISTS` may return safe display metadata such as file name,
extension, and recorded quality. It must not return an absolute or relative
filesystem path, media URL, source headers, or source credentials.

## Client Coordination

Each client owns one user-download coordinator shared by search results,
playlists, albums, discovery views, player actions, and other interactive
download entry points.

The coordinator performs this flow:

1. Submit the selected track and quality with `existingFilePolicy: "error"`.
2. If the Service creates a task, show the existing queue-success feedback.
3. If the Service returns `DOWNLOAD_ALREADY_EXISTS`, invoke the client's shared
   confirmation abstraction with the confirmed message and actions.
4. On cancellation, return without another request or success feedback.
5. On confirmation, repeat the same track, quality, quality list, and list
   context with `existingFilePolicy: "replace"`.
6. When the Service creates the replacement task, show
   `已加入重新下载队列`.
7. Route all other errors through the client's existing download-error
   presentation.

Hosted Web renders the confirmation with its center-dialog system. Flutter
exposes the same semantic request to its dialog abstraction; this specification
does not freeze the platform widget or visual golden.

The client never infers file existence from a cached download list or library
snapshot. The Service remains authoritative, avoiding a check-then-create race.

## Replacement Job State

A replacement job persists only Service-relative, validated state. It never
persists a client-supplied path or resolved source target.

```ts
interface DownloadReplacementState {
  originalRelativePath: string
  originalIntegrity: { size: number, sha256: string }
  previousDownloadIds: string[]
  phase: 'downloading' | 'prepared' | 'published' | 'retired'
  replacementIntegrity?: { size: number, sha256: string }
}
```

The original path must resolve inside the Service audio root when the job is
created, restored, and published. The original integrity snapshot identifies
the exact file the user approved replacing. `previousDownloadIds` contains only
completed records that resolve to that exact file.

Replacement jobs for the same logical track or original path are serialized.
If an equivalent waiting or active replacement already exists, a repeated
request returns that task instead of creating another writer. A request whose
target has changed since an earlier task was created is not coalesced.

## Multi-Source Candidate Binding

Keep one shared source-evaluation unit, but assemble playback and download
outputs separately. The public playback response remains unchanged.

The internal download result becomes candidate-scoped:

```ts
interface ResolvedDownloadCandidate {
  sourceId: string
  url: string
  headers?: Record<string, string>
  resources?: {
    pictureBytes?: Uint8Array
    pictureMimeType?: string
    lyrics?: TuneFlow.Music.LyricInfo
  }
  completeness: 'complete' | 'mixed' | 'audio-only'
  sourceIds: { audio: string, lyrics?: string, picture?: string }
}

interface ResolvedDownload {
  candidates: ResolvedDownloadCandidate[]
}
```

Within each installed source, request and validate audio, lyrics, and artwork
concurrently when capabilities allow. Preserve the configured hedge delay and
total enrichment budget across sources.

For every validated audio candidate:

1. Prefer lyrics and artwork validated from that same installed source.
2. Fill only missing components from the highest-priority validated resources
   retained from other enabled sources or the existing built-in fallback.
3. Record candidate-specific completeness and internal source IDs.

Order the download candidates with the selected highest-priority complete
bundle first. If no complete bundle exists, place the highest-priority usable
audio first. Append other usable audio candidates in configured priority order.

The download manager tries candidates in that frozen order. After a retryable
transfer or parse failure, it closes the response, removes the incomplete
`.part`, clears progress and validators, and starts the next candidate at byte
zero. The manager retains only the resources attached to the candidate whose
whole audio file passed transfer and parse validation. Consequently, if A
passes its probe but fails during full transfer and B completes, metadata uses
B's same-source resources first and mixes only B's missing components.

Script, protocol, safety, cancellation, and caller-origin failures retain the
terminal behavior defined by the multi-source fallback design. Candidate
binding must not mask their original error codes.

## Replacement Preparation

Replacement preparation never writes to the original file.

1. Resolve the online download bundle with local lookup disabled because the
   existing file was already handled by the create policy.
2. Transfer the selected candidate to the job's isolated `.part` file.
3. Require trusted response-length consistency and a complete byte count.
4. Parse the `.part` and require a supported, non-empty audio container and
   codec.
5. Apply configured embedded artwork, lyrics, tags, and sidecar preparation to
   staging paths. Candidate-bound resources prevent redundant network fetches.
6. Treat metadata failure as a replacement failure rather than a warning. The
   ordinary non-replacement download warning policy is unchanged by this
   design.
7. Synchronize the fully processed staging file, compute its final size and
   SHA-256, and persist the `prepared` publication marker.

Any failure before `prepared` deletes only safe validated staging paths. The
original file and its completed records remain unchanged.

## Publication and Crash Recovery

Publication uses staging and destination paths on the same Service-owned audio
filesystem. Immediately before publishing, recompute the original file's size
and SHA-256. If the file is missing, moved, or modified, fail with
`DOWNLOAD_REPLACEMENT_CONFLICT`; do not overwrite the changed state.

### Same-format replacement

When the replacement extension matches the original, retain the original file
name and atomically rename the prepared staging file over that path. Synchronize
the parent directory, persist `published`, then reconcile the completed
records.

If the process stops after the rename but before the marker update, recovery
compares the destination against the prepared replacement integrity. A match
proves that the replacement was published; the job advances without another
download. A destination matching the original integrity means publication did
not occur and can be retried. Any third state is a conflict and is never
overwritten automatically.

### Cross-format replacement

When the extension changes, derive the new name from the configured naming
policy. Never overwrite an unrelated file already occupying that path; reserve
a collision-safe new name when necessary.

Atomically rename the prepared staging file to the new-format path first,
synchronize its parent directory, and persist `published`. Only then remove the
old-format file, synchronize the directory again, and persist `retired`.

This is a recoverable no-gap transition rather than a single-filesystem atomic
swap across two names. A crash may temporarily leave both formats, but never
intentionally leaves neither. Recovery handles each state as follows:

- Prepared new file absent, original intact: retry publication.
- New file matches replacement integrity, original intact: finish retiring the
  original.
- New file matches replacement integrity, original absent: finish database
  reconciliation.
- Original or new file matches neither persisted integrity: stop with a
  replacement conflict.

After `retired`, remove superseded completed download rows, make the replacement
job the canonical completed record, materialize library resources, refresh the
library once, and publish one coherent download snapshot. If derived library
resource materialization fails after audio publication, retain the valid new
audio and report a warning as ordinary completed-download behavior does.

Pause and cancellation are permitted only before publication begins. Once a
job has a prepared marker and enters the short publication transaction, the
Service completes or recovers that transaction instead of exposing a partially
published cancellation state.

## Error Contract

Add the following public error codes:

- `DOWNLOAD_ALREADY_EXISTS` with HTTP 409: confirmation is required.
- `DOWNLOAD_REPLACEMENT_CONFLICT` with HTTP 409: the approved original or
  destination changed before publication.
- `DOWNLOAD_REPLACEMENT_FAILED`: the replacement did not satisfy transfer,
  parsing, metadata, or publication requirements.

Preserve specific trusted source errors when they explain why resolution or
transfer failed. Do not collapse `SOURCE_ALL_UNAVAILABLE`, terminal script or
protocol errors, safety errors, or caller cancellation into a generic
replacement error. `DOWNLOAD_REPLACEMENT_FAILED` is used only when the failure
belongs to replacement preparation or publication itself.

Public errors, events, DTOs, and logs must not contain filesystem paths, source
URLs, headers, cookies, scripts, lyric bodies, or artwork bytes.

## Verification

### Service create policy

- `error` returns `DOWNLOAD_ALREADY_EXISTS` before source resolution and
  creates no record.
- `reuse`, `duplicate`, and `replace` each override both legacy boolean and
  setting values.
- A missing file on a confirmed `replace` request creates a normal download.
- Requests without the new field retain legacy behavior.
- Existing files without database rows participate in conflict and replacement
  flows.
- Equivalent concurrent replacement requests produce one task.

### Multi-source download binding

- Prefer the highest-priority complete same-source candidate.
- Assemble candidate-specific mixed resources only when same-source resources
  are missing.
- If A fails during full transfer and B completes, embed B's same-source
  resources rather than the resources selected for A.
- If B lacks one component, mix only that component from the highest-priority
  validated fallback.
- Start each new audio candidate at byte zero and never join partial bytes.
- Preserve terminal error and cancellation behavior.
- Exercise concurrent per-source action evaluation and the total enrichment
  budget with controlled timers.

### Replacement safety

- Transfer, parsing, metadata, pause, and cancellation failures preserve the
  original bytes, path, integrity, and completed records.
- Metadata is applied to staging and succeeds before the original is replaced.
- Same-format success publishes new bytes at the original path and removes all
  superseded completed records.
- Cross-format success publishes the new extension and removes the old format.
- An unrelated destination collision receives a safe suffix and is never
  overwritten.
- External mutation, movement, or deletion of the approved original causes a
  replacement conflict.
- Every prepared, rename, marker, retirement, and database crash checkpoint
  recovers without downloading twice and without losing both old and new
  files.
- Final persisted integrity reflects the post-metadata replacement bytes.
- Library refresh and download events expose one coherent completed result.

### Hosted Web and Flutter

- Every interactive download entry point uses the shared coordinator and sends
  `existingFilePolicy: "error"` first.
- A normal create shows existing queue feedback without confirmation.
- `DOWNLOAD_ALREADY_EXISTS` invokes the confirmation abstraction with the
  approved message and `取消` / `确定` actions.
- Cancellation sends no second request and shows no success feedback.
- Confirmation repeats the unchanged download context with `replace` and shows
  replacement queue feedback.
- Other errors use existing download-error presentation.
- Playback automatic saving uses `reuse` and never asks for confirmation.
- Hosted Web covers its center-dialog integration.
- Flutter tests the semantic confirmation request and coordinator behavior
  without freezing the mobile redesign's widget, layout, colors, or goldens.

## Migration and Rollback

The Service adds nullable replacement state to serialized download records; no
existing completed record or audio file is rewritten during migration. Legacy
records without replacement state retain their current recovery behavior.

Older clients remain compatible because the new request field is optional and
existing response DTOs do not require new fields. A rollback to an older
Service cannot safely recover an in-progress replacement publication. Release
and deployment procedures must therefore stop new downloads and allow active
replacement publication transactions to finish before rolling back. Prepared
replacement markers remain Service-owned evidence and must not be deleted by a
rollback script.

## Acceptance Criteria

- A user can confirm redownloading an existing local track from hosted Web or
  any Flutter platform.
- The original file remains usable and unchanged until a fully prepared
  replacement is published.
- Failed replacement attempts do not damage, delete, rename, or retag the
  original.
- Successful same-format replacement atomically replaces the original path.
- Successful cross-format replacement converges to only the new format without
  a window in which both valid files are absent.
- The audio source that completes the full download owns the preferred lyrics
  and artwork; mixing occurs only for its missing validated components.
- No download combines audio bytes from different sources.
- Explicit create policy overrides legacy settings while old clients preserve
  their existing behavior.
- Automatic playback saving remains silent and local-first.
- Public interfaces and diagnostics reveal no sensitive paths or source data.
