# Optional Resource Fallback and Metadata Backfill Design

## Goal

Make lyrics and artwork behave correctly in a multi-source system. A failed
optional-resource lookup must continue through the enabled source order and the
built-in provider without changing the selected audio stream. When a validated
resource becomes available, the Service fills only missing metadata in a
matching local audio file. Existing metadata is preserved unless the user has
explicitly approved the existing download replacement flow.

When lyrics become available after the player's initial request, the Service
notifies connected clients through the existing SSE channel. A client showing
the matching track refreshes its missing lyrics automatically, so the user does
not need to press retry.

The Flutter client remains a Service API consumer. It does not read, write, or
rewrite audio-file metadata.

## Context

The independent catalog lyrics route currently selects the configured lyric
candidates and runs the generic source fallback helper. The generic helper
correctly treats script and protocol failures as terminal for arbitrary source
actions. That behavior was suitable for a single source, but it means a broken
lyric response from the first configured source prevents later lyric sources
and the built-in provider from running.

Optional resources require narrower semantics. A malformed lyric or unusable
picture from one source says nothing about whether another independent source
can provide that resource. It must not terminate the entire optional-resource
chain or replace audio that is already playing.

## Scope

This design covers:

- resource-specific fallback for catalog lyrics and artwork;
- manual and SSE-triggered client refresh through the existing Service
  endpoints;
- attaching late resources to an in-progress download;
- filling missing embedded metadata in a matching published local file;
- preserving existing metadata during automatic enrichment;
- retaining the existing explicit download replacement confirmation; and
- integrity, resource-index, and library refresh after a successful mutation.

It does not add client-side file access, provenance classification, automatic
redownload, bulk repair of the whole library, or deployment behavior.

## Resource Resolution

Lyrics and artwork use an optional-resource resolver owned by the Service. For
the requested provider, it tries:

1. enabled custom sources in configured priority order;
2. the built-in original provider; and
3. for artwork only, an already-normalized canonical artwork snapshot when the
   existing picture contract allows it.

The resolver validates each result before accepting it. Lyrics must have the
expected object shape, bounded string fields, at least one non-empty usable
lyrics field, and no Unicode replacement characters. Artwork must pass the
existing network, byte-size, signature, dimension, and MIME checks before the
Service stores or publishes an opaque same-origin URL.

Network, timeout, source-script, source-protocol, empty-result, and
resource-validation failures are local to an optional-resource candidate and
advance the chain. Caller cancellation, request validation failures, and safety
policy failures remain terminal. The existing generic source fallback helper is
not weakened because it continues to protect audio and other source actions.

When all candidates fail, the catalog endpoint retains its safe error envelope.
Playback and download bundle resolution may instead report the optional
resource as unavailable while preserving valid audio and other metadata.

## Client Refresh Flow

The Flutter player continues to call the catalog lyrics endpoint with canonical
music information. Retrying lyrics does not rerun audio resolution and does not
change the current stream, quality, or playback position. After the Service
resource-specific chain succeeds, the response immediately supplies the lyrics
to the player.

The Service separately schedules any applicable local metadata enrichment. A
file-write failure must not turn a successful lyric response into a player
failure.

## Live Resource Availability

The existing SSE transport is the live-notification mechanism. WebSocket is not
introduced because the update is one-way, the project already has SSE reconnect
handling, and clients continue to retrieve resources through ordinary Service
HTTP endpoints.

After validated lyrics are available from a durable local resource or a bounded
Service-owned resource cache, the Service publishes a transient domain event:

```json
{
  "type": "track.resources.updated",
  "data": {
    "source": "tx",
    "trackId": "provider-track-id",
    "resources": ["lyrics"]
  }
}
```

The event is an invalidation notice. It does not contain lyrics text, artwork
bytes, source URLs, file paths, headers, or source-script details. Artwork can
use the same event contract by adding `"picture"` to `resources`.

The Service must make the announced resource readable before publishing the
event. Catalog resource lookup therefore checks, in order:

1. a validated matching local-library resource;
2. a validated bounded in-memory resource cache; and
3. the configured custom-source and built-in fallback chain.

The cache is keyed by canonical provider and track identity, has explicit size
and lifetime bounds, stores only validated resources, and is not a replacement
for durable file metadata. It lets an active download announce lyrics before
the audio transfer finishes without forcing a second upstream request.

Flutter accepts the event only when its provider and track id match the current
track, `resources` contains `lyrics`, and the current lyrics are empty or in an
error state. It then invokes the existing lyrics loader. Existing playback and
lyrics request-generation guards discard stale results after a track change.
Concurrent notifications for the same current track coalesce into one refresh.

Per-track update events are not retained as a complete SSE snapshot. Instead,
after every SSE connection or reconnection is established, Flutter performs one
revalidation when the current track still lacks lyrics. This closes the missed
event window without storing an unbounded resource-event history. Manual retry
remains available as a fallback.

## Automatic Metadata Enrichment

The Service matches the canonical music information against its local library.
It does not distinguish between files downloaded by the Service and files added
by the user. Automatic enrichment uses fill-missing-only semantics for the one
file selected by the existing library matching rules:

- a supported, non-empty embedded picture is preserved;
- a non-empty embedded lyrics tag is preserved;
- a missing picture may be filled only when picture embedding is enabled;
- missing embedded lyrics may be filled only when lyric embedding is enabled;
- a missing lyrics sidecar may be created only when sidecar download is enabled;
- an existing sidecar is never replaced by automatic enrichment; and
- picture and lyrics decisions are independent, so filling one cannot remove or
  replace the other.

An external sidecar does not make embedded lyrics present. When embedding is
enabled, the Service may add the same validated lyrics to an audio file that has
only a sidecar while preserving that sidecar.

If metadata cannot be parsed reliably, the Service treats the file as unsafe to
modify and leaves it unchanged rather than assuming fields are absent.

## Download Timing and Races

Validated resources may arrive before or after audio transfer completes.

The four-second playback enrichment budget remains a playback-startup bound;
it is not the download resource deadline. After the download resolver has a
usable audio candidate, the Service proactively starts independent lyrics and
artwork resolution for every resource still missing from that bundle. This
work does not delay returning the download candidate or starting audio
transfer. Provider/network calls retain their existing bounded timeouts, and
the download job's cancellation signal cancels outstanding resource work.

When a matching download is still active, the Service attaches the resource to
the pending download state. Normal staged metadata processing consumes it
before publication whenever it arrives in time.

If finalization has already captured its resources, or the file has already
been published, the Service queues the same fill-missing operation against the
published file. The operation rechecks the file immediately before mutation,
so concurrent completion or another enrichment cannot overwrite newly added
metadata.

Download completion itself does not require an upstream resource to succeed.
If proactive resolution is still running or exhausts every candidate, the
audio publishes with its bounded metadata warning. A later successful resource
resolution uses the same fill-missing enrichment path and publishes the
existing resource/library invalidations; users do not need to refresh or press
retry to initiate that resolution.

Enrichment is serialized per canonical file path. Duplicate lyric or artwork
responses coalesce into one operation, and the final precondition check makes
the operation idempotent.

## Safe File Mutation

Published audio is never edited in place. The Service:

1. resolves and verifies that the target is a regular file inside the configured
   audio root;
2. captures its identity and integrity precondition;
3. parses the existing metadata and determines each missing field;
4. copies the audio to a staging file on the same filesystem;
5. writes only the missing enabled fields to the staging file;
6. parses the staged file and verifies the original audio remains readable, all
   preserved metadata remains present, and each requested field was added;
7. confirms the published original still matches the precondition;
8. fsyncs the staged file and atomically replaces the original; and
9. updates any matching download integrity record, invalidates derived resource
   markers, refreshes library resources, and publishes the updated library
   snapshot.

Any failure before atomic replacement deletes the staging file and leaves the
original byte-for-byte unchanged. A precondition conflict abandons the attempt
without overwriting the newer file. Client-visible warnings and logs never
include source scripts, upstream URLs, or storage paths.

## Explicit Download Replacement

The existing Flutter workflow already sends `existingFilePolicy: error` first.
When the Service reports `DOWNLOAD_ALREADY_EXISTS`, Flutter asks the user for
confirmation and retries with `existingFilePolicy: replace` only after approval.

This explicit replacement is allowed to replace the audio file and its metadata
with the newly downloaded, validated result. It does not use automatic
fill-missing semantics. The current staged replacement, verification, rollback,
and sidecar-publication guarantees remain in force.

Cancelling the confirmation leaves the current file and metadata unchanged.

## Components

### Service catalog resources

- Own the optional-resource candidate chain and validation.
- Prefer validated local or cached resources before repeating upstream work.
- Return the first valid resource without changing playback audio.
- Publish availability only after the resource can be read again.
- Notify the download/library enrichment boundary after successful validation.

### Download coordination

- Attach late resources to matching in-progress jobs.
- Expose a safe way to refresh integrity after a published file is atomically
  enriched.
- Preserve explicit replacement semantics for user-authorized redownloads.

### Library metadata enrichment

- Match canonical music information to files.
- Parse and merge only missing enabled fields.
- Serialize, stage, verify, replace, and refresh derived resources.
- Never infer mutation permission from file provenance.

### Flutter

- Keep the existing lyrics retry request.
- Consume `track.resources.updated` from the existing SSE subscription.
- Refresh only matching current tracks with missing or failed lyrics.
- Revalidate missing current lyrics once after each SSE connection is
  established.
- Keep the existing download conflict confirmation and `replace` retry.
- Perform no filesystem or audio-tag mutation.

## Verification

Service tests cover:

- a null or malformed first lyric response continuing to the next source;
- all custom lyric sources failing before a successful built-in lookup;
- catalog lookup preferring validated local and cached lyrics;
- resource-specific continuation without changing generic audio fallback tests;
- caller cancellation and safety errors remaining terminal;
- existing lyrics surviving a different successful lyric lookup;
- existing artwork surviving automatic artwork enrichment;
- a file missing only lyrics gaining lyrics while retaining its artwork;
- a file missing only artwork gaining artwork while retaining its lyrics;
- sidecar-only lyrics being embedded when embedding is enabled without replacing
  the sidecar;
- active-download resource attachment and the post-finalization race;
- duplicate enrichment requests coalescing safely;
- parse, write, verification, and precondition failures leaving the original
  byte-for-byte unchanged;
- successful atomic replacement updating recorded integrity and library
  resources;
- publishing a resource event only after the announced lyrics can be read; and
- explicit `replace` continuing to overwrite the prior file only after the
  existing client confirmation flow.

Flutter tests cover matching resource events triggering one lyrics refresh,
unrelated and stale events doing nothing, repeated events coalescing, a track
change rejecting a late result, and SSE reconnection revalidating missing
current lyrics. Existing regression tests retain proof that a conflict is first
requested with `error`, confirmation retries with `replace`, cancellation
performs no retry, and lyrics refresh continues to call the Service rather than
the filesystem.

## Acceptance Criteria

- A broken first lyric source no longer prevents later sources or the built-in
  provider from supplying lyrics.
- Lyrics retry does not interrupt or replace the current audio stream.
- A validated late lyric or picture fills missing enabled metadata in a matching
  local file.
- The current player displays newly available lyrics without requiring manual
  retry.
- SSE notifications contain identity and resource kinds, not resource content
  or private transport details.
- A missed live event is recovered by one current-track revalidation after SSE
  reconnection.
- Automatic enrichment never replaces an existing valid picture, embedded
  lyrics tag, or lyrics sidecar.
- Existing metadata remains present after another field is filled.
- Explicit user-confirmed download replacement may replace the file and its
  metadata.
- Successful mutation updates integrity and library resource indexes; failed
  mutation leaves the original file unchanged.
- No client gains direct file-writing responsibility.
