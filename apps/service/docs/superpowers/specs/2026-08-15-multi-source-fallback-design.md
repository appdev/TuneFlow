# Multi-Source Fallback Design

**Date:** 2026-08-15

**Status:** Approved design; implementation has not started.

## Goal

Allow users to enable and order multiple installed music-source scripts. The
Service uses that ordered chain for request-scoped fallback without changing
the configured order after a failure. Playback, downloads, lyrics, and artwork
share the same policy, while Service-owned local media and local resources
remain strictly preferred.

The preferred online result is a resource bundle whose audio, lyrics, and
artwork all come from the same source script and have passed bounded
availability checks. When no complete bundle is available within the playback
startup budget, the Service composes the best available bundle from separately
validated components instead of withholding playable audio.

## Scope

This design changes:

- The Service source-selection schema, repository, API, worker orchestration,
  playback resolution/proxying, catalog resource resolution, downloads, safe
  diagnostics, and events.
- The Flutter client's source models, source-management screen, event
  invalidation, playback response model, and player resource application.
- Compatibility behavior for the existing hosted Web client.

This design does not add persistent health scoring, automatic reordering,
cross-request circuit breaking, mid-stream byte splicing, or full multi-source
management UI to the hosted Web client.

## Confirmed Product Decisions

- Fallback applies only to the current request. A success from source B never
  changes the next request's A, B, C order.
- Users explicitly enable sources and manually order them.
- Playback, downloads, lyrics, and artwork participate in fallback.
- Local audio, local lyrics, and local artwork remain preferred.
- Source implementation, protocol, safety, cancellation, and invalid-input
  failures are terminal. Transient network failures, timeouts, and correctly
  resolved but unusable resources may fall through to the next source.
- For online playback, the Service prefers a source that provides usable audio,
  lyrics, and artwork together. If none does, it may mix validated components.
- Resource completeness has a bounded startup budget; non-audio enrichment
  must not indefinitely block playback.

## Architecture

The Service is the only fallback orchestrator. Clients configure an ordered
source chain and consume the result. They do not retry individual source
scripts themselves.

The primary online ordering is by track candidate, then by installed source:

```text
local resources
  -> original track through A, B, C
  -> alternative track candidate 1 through A, B, C
  -> alternative track candidate 2 through A, B, C
```

This favors retaining the original track before accepting a cross-provider
alternative. For an online track candidate, each source is evaluated as an
audio/lyrics/artwork bundle. Source capabilities filter the chain before any
request is attempted.

The design introduces two focused Service units:

1. `SourceFallbackResolver` owns ordered capability filtering, attempt
   execution, error classification, cancellation, and safe attempt summaries.
2. `PlaybackResourceBundleResolver` owns local precedence, online track
   candidates, bounded same-source bundle evaluation, mixed fallback assembly,
   and the playback/download resource result.

Repositories remain responsible only for persistence, and worker hosts remain
responsible only for one installed script's execution and response validation.

## Source Selection Persistence

Add an ordered selection table equivalent to:

```sql
CREATE TABLE web_source_selection (
  source_id TEXT PRIMARY KEY REFERENCES web_sources(id) ON DELETE CASCADE,
  position INTEGER NOT NULL UNIQUE CHECK (position >= 0)
);
```

The repository treats ascending `position` as the enabled source order.
Positions are contiguous after every mutation.

Keep `web_source_state.active_source_id` for backward compatibility and
rollback. It always mirrors the source at position zero, or `NULL` for an empty
selection.

On first startup with the new schema, if the selection table is empty and the
legacy active source still exists, insert it at position zero. Do not delete or
reinterpret installed-source capability metadata.

Deleting an installed source removes its selection row, compacts the remaining
positions, and synchronizes the legacy active ID in the same transaction.

## Source API

Extend each source summary with:

```ts
{
  enabled: boolean
  priority: number | null
  active: boolean
}
```

`active` remains a compatibility field and is true only for priority zero.
`enabled` is true for every source in the chain. `priority` is its zero-based
position, or `null` when disabled.

Add an atomic configuration endpoint:

```http
PUT /api/v1/sources/enabled
Content-Type: application/json

{"sourceIds":["source-a","source-b","source-c"]}
```

The array is the complete desired configuration. The Service validates that
IDs exist and are unique, initializes newly enabled sources and obtains their
capabilities, then commits the new order only if all initialization succeeds.
An empty array intentionally disables online source resolution but does not
affect local playback.

The endpoint returns the complete source list and publishes one
`sources.updated` snapshot event after a successful commit.

Serialize concurrent selection writes at the Service boundary. Each request
still supplies the complete desired array; the last successfully committed
request wins, and every client refreshes from the returned/snapshot state
instead of merging partial local mutations.

Keep `PUT /api/v1/sources/active`. Its compatibility behavior is to promote the
selected source to priority zero while preserving all other enabled sources in
their relative order. If the source was disabled, add it at priority zero. It
must not silently clear the fallback chain.

## Runtime Source Lifecycle

At the start of a logical request, freeze the ordered eligible source IDs and
their advertised capabilities. A configuration change affects only subsequent
requests.

Workers remain lazy and cached. Disabling a source prevents it from entering
new snapshots but does not immediately terminate its cached worker, avoiding
interruption of in-flight resolution or downloads. Removing a source closes
its worker using the existing removal lifecycle. Service shutdown closes every
worker.

All attempts share the caller's `AbortSignal`. Cancellation, pause, client
disconnect, and Service shutdown stop the chain immediately.

## Error Classification

Add an explicit `SOURCE_NETWORK_ERROR` at the bounded source network layer so
transport failure is not collapsed into `SOURCE_PROTOCOL_ERROR`.

Retryability depends on trusted error provenance, not only a string code. A
network/timeout error created by the Service network layer or worker host is
retryable. A source script that throws an object whose `code` happens to be
`SOURCE_NETWORK_ERROR` is still a source-script exception and is terminal.

The next source may be attempted for:

- `SOURCE_TIMEOUT`;
- `SOURCE_NETWORK_ERROR`;
- DNS, TCP, TLS, connection-reset, or response-header timeout while accessing a
  correctly resolved media resource;
- media HTTP status 401, 403, 404, 408, 410, 429, or 5xx;
- an empty media response;
- an invalid Range response;
- response termination before a declared length is complete; or
- an obvious HTML or JSON error body returned in place of media.

The following are terminal and never cause cross-script fallback:

- caller cancellation, pause, disconnect, or Service shutdown;
- invalid request input;
- source script exceptions;
- malformed source response structures or URLs;
- SSRF/private-target or other safety-policy rejection;
- response-size safety-limit violations; and
- other source protocol violations.

Missing advertised capability is a skip, not an attempt or error.

When all eligible sources fail for retryable reasons, return
`SOURCE_ALL_UNAVAILABLE` with a safe attempt list containing only source ID,
action, outcome code, and elapsed duration. Never expose source URLs, request
headers, cookies, script contents, lyrics, or image bytes.

## Resource Availability

### Audio

A syntactically valid URL is only a successful source action, not proof of
playability. Before selecting an online bundle, make a bounded Range probe for
at most the first 64 KiB. If an upstream ignores Range and begins a full 200
response, stop and close the probe after the same limit. Accept a usable 200
response or a consistent 206 response, legal redirects, a non-empty body, and
media-compatible content. Accept `audio/*` and common binary content types such
as `application/octet-stream`; reject obvious HTML or JSON error content.

The probe does not establish whole-file integrity. Playback must not wait for a
complete download. If the real stream fails before any response headers or
audio bytes are sent to the client, the proxy may use the remaining frozen
candidate chain. Once any audio bytes have been sent, never splice bytes from a
different source or track candidate into the response.

Range and seek requests within one playback token remain pinned to the selected
track candidate. A new playback resolution starts from local, then configured
priority A again, because the design has no cross-request circuit breaker.

### Lyrics

Lyrics are usable when the source response passes the existing structural and
size validation and at least one supported lyric text field contains
non-whitespace content. Empty lyrics do not make a complete bundle, though
they may remain a valid catalog-level "no lyrics" result where playback bundle
selection is not involved.

### Artwork

Artwork is usable when the bounded Service network layer fetches it
successfully, its size is within the configured image limit, and its bytes have
a supported image signature. Store validated artwork in a short-lived,
size-bounded memory cache and expose it through an opaque same-origin resource
URL. Do not expose source headers or depend on the client being able to fetch
the third-party URL.

## Bundle Selection and Startup Budget

When local audio exists, always use it. Prefer local lyrics and artwork, then
fill missing components from enabled online sources. Missing local enrichment
never causes local audio to be replaced.

For an online track candidate:

1. Start source evaluations in configured priority order. Evaluations may
   overlap after a short named hedge delay so a slow A lyrics/artwork request
   cannot consume the entire completeness budget before B gets a chance.
2. Within one source, request audio, lyrics, and artwork concurrently when the
   source advertises those capabilities.
3. Retain validated components so later mixed fallback does not repeat work.
4. Selection priority remains A, B, C even when work overlaps: choose the
   lowest-priority-number complete source that finishes while every earlier
   source has either become definitively incomplete or exhausted the remaining
   total budget.
5. If no complete source succeeds within the total enrichment budget, assemble
   the highest-priority validated audio, lyrics, and artwork components.
6. Continue only audio-essential work beyond the enrichment budget up to the
   normal request timeout. Cancel outstanding bundle-only enrichment when the
   response is chosen; the client's existing delayed catalog loaders may later
   fill missing lyrics or artwork but never replace audio that has started.
7. If no audio is usable for this track candidate, consider the next
   cross-provider track candidate.

Use a four-second total playback enrichment budget as an initial named Service
constant and a named sub-second hedge delay. Tests use an injected/fake clock.
Neither value is exposed as a client setting in this release. Bound overlapping
work by the number of enabled sources and the existing per-worker outstanding
request limit; cancellation at selection or budget expiry prevents orphaned
network work.

The bundle reports `complete`, `mixed`, or `audio-only`. This state is
diagnostic and presentational; it does not alter the persistent source order.

## Playback API and Resource Session

Extend the existing playback resolution response compatibly:

```json
{
  "url": "/api/v1/streams/<token>",
  "quality": "320k",
  "expiresAt": 1780000000000,
  "resources": {
    "lyrics": {
      "lyric": "...",
      "tlyric": "..."
    },
    "lyricsUrl": null,
    "pictureUrl": "/api/v1/playback/resources/<token>/picture"
  },
  "completeness": "complete"
}
```

`resources` and `completeness` are optional so existing clients remain valid.
`lyrics` and `lyricsUrl` are mutually exclusive: an online bundle carries
validated lyric data, while a matched local-library track may carry its
existing same-origin `lyricsUrl`. A local match may likewise reuse its existing
same-origin `pictureUrl` instead of creating an online artwork token.
The audio token retains the selected source result and enough of the frozen
remaining chain to recover from a pre-response upstream failure. The artwork
URL is opaque, same-origin, short-lived, and contains no server filesystem
path.

Independent catalog lyrics and picture endpoints remain available for search
results and explicit resource viewing. They apply resource-specific A, B, C
fallback without paying the full playback bundle-selection cost.

## Downloads and Integrity

The existing local-file/adopt-existing check remains ahead of all online work.
An online download reuses bundle selection so its validated lyrics and artwork
can feed metadata finalization.

For a retryable transfer failure, remove the incomplete `.part`, resolve from
the next eligible source, and restart the file from byte zero. Never append
bytes from different sources to one file.

A completed download requires:

- a valid HTTP/Range response;
- actual byte count consistent with trusted response length/range metadata;
- complete temporary-file write and synchronization;
- successful existing audio metadata/finalization processing; and
- persisted final file size and SHA-256 after metadata changes.

The final SHA-256 detects later mutation of the local file. Without a trusted
hash from the provider, it does not prove recording identity or detect a
different but structurally valid song.

## Flutter Client

Extend `InstalledMusicSource` with `enabled` and nullable `priority`, retaining
`active` as a compatibility field for the primary source.

Replace the controller's single-active assumption with:

- `enabledSources`, sorted by priority;
- `primarySource`, the first enabled source;
- `disabledSources`;
- a single saving/mutation state; and
- rollback state for failed configuration writes.

The source-management screen has an enabled section and a disabled section.
Enabled sources support drag ordering and labels `首选`, `备用 1`, and
`备用 2`. Every source has an enable switch. Toggling submits the complete
ordered ID array immediately. Dragging is local until drop, then submits once.
Lock further mutations while saving. On failure restore the previous local
order and refresh from the Service.

Allow disabling the last source only after warning that online playback and
downloads will be unavailable while local music remains usable.

Extend `ResolvedTrack` with optional resource data and completeness. On a
successful resolve, `PlaybackRepository` returns one playback resource result.
`PlayerController` applies its artwork to the matching queue entry and stores
its lyrics before starting or alongside playback. It avoids a duplicate lyric
request when bundle lyrics are present and retains the existing delayed loader
as a fallback when they are absent.

The Flutter event coordinator handles `sources.*` invalidation so changes from
another client refresh source state. A source-order change never interrupts an
in-flight request.

For `SOURCE_ALL_UNAVAILABLE`, show a safe summary such as "已尝试 3 个音源，均
网络不可用". Protocol or script failures retain their specific error so the
user can identify a broken source. The UI may display request-scoped
`complete`, `mixed`, or backup-source diagnostics without persisting health or
showing sensitive source data.

## Hosted Web Compatibility

The first release does not add full multi-select and drag ordering to the
hosted Web UI. It continues to use `/sources/active`, which promotes a source
without disabling the existing fallback chain. Its single "current source"
display maps to priority zero.

This preserves old Web and old Flutter response parsing while making the
independent Flutter client the complete source-chain management UI. The hosted
Web client can later adopt `/sources/enabled` without another Service schema
change.

## Events and Safe Observability

Successful source-chain changes publish one `sources.updated` snapshot with the
complete public source summaries.

Assign an internal request ID to each logical resolution. Structured logs may
contain request ID, action, source ID, configured priority, elapsed duration,
and outcome classification. They must not contain track request bodies, media
URLs, headers, cookies, lyrics text, image bytes, or source scripts.

No persistent source health, automatic ordering, or external telemetry is
introduced in this design.

## Verification

### Service

- Migrate a legacy active source to priority zero without losing capabilities.
- Validate ordered configuration, empty selection, duplicates, unknown IDs,
  initialization failure, atomic rollback, deletion, and position compaction.
- Prove `/sources/active` promotes one source and preserves the others.
- Prove capability filtering and frozen request snapshots.
- Cover every retryable and terminal error class, including cancellation.
- Prove local audio cannot be displaced by missing local enrichment.
- Select the first complete same-source bundle.
- Assemble mixed and audio-only bundles after the bounded budget.
- Exercise the four-second budget with fake time rather than real waits.
- Cover audio 200/206 behavior, Range validation, redirects, empty bodies,
  obvious error content, HTTP failures, and declared-length truncation.
- Cover artwork fetch limits/signatures and opaque resource expiry.
- Restart downloads from zero after switching sources and verify cleanup,
  length, parsing, finalization, size, and SHA-256.
- Assert that APIs, events, errors, and logs contain no sensitive source data.

### Flutter

- Parse both legacy and extended source/playback responses.
- Represent multiple enabled sources and stable priority order.
- Submit one complete ordered array for toggles and completed drags.
- Restore and refresh state after a failed save.
- Warn before disabling the final source.
- Refresh after `sources.updated`.
- Apply bundle audio, lyrics, artwork, and completeness without duplicate
  resource requests.
- Preserve local playback/resource precedence.
- Cover complete, mixed, audio-only, and all-sources-unavailable states.
- Add desktop and mobile component coverage; update only genuinely affected
  visual Goldens.

## Migration and Rollback

The migration only creates and populates the new selection table. It does not
drop the legacy state table or rewrite installed scripts. Every configuration
transaction mirrors priority zero into `active_source_id`.

Rolling back to an older Service therefore retains a usable primary source,
although the older version cannot see backups. Re-upgrading finds the preserved
ordered selection. A failed source initialization or database write leaves the
previous selection untouched.

## Acceptance Criteria

- A user can enable at least two installed scripts and define their order.
- Local media and local resources remain preferred.
- A request starts with priority A and uses B only within that request when A
  has a retryable availability failure.
- The next request starts with A again.
- Online playback prefers a validated same-source audio/lyrics/artwork bundle
  and degrades to a mixed or audio-only result within the startup budget.
- Downloads never combine bytes from different sources and retain existing
  final integrity tracking.
- Script, protocol, safety, and cancellation errors do not get masked by
  fallback.
- Existing clients continue to parse responses and the hosted Web client's
  primary-source action does not clear the fallback chain.
- No public response, event, or log leaks sensitive source material.
