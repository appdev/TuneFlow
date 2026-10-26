# Unified Music Info and Resource Fallback Design

## Goal

Make Service Web and Flutter send the same canonical music information while
keeping the Service responsible for resolving, validating, and retrying audio,
lyrics, and artwork. Prevent a failed optional artwork or lyrics lookup from
skipping otherwise valid metadata, and preserve safe replacement guarantees.

## Scope

This change coordinates two projects:

- Service and bundled Web client: `/Volumes/ext/lx-music-server-web`
- Flutter client: `/Volumes/ext/MusicFree/flutter-client`

It changes request serialization, Service-side compatibility normalization,
resource fallback, metadata staging, warnings, and tests. It does not change UI
layout, automatically rewrite completed media, introduce search sessions, or
make clients responsible for downloading artwork or lyrics.

## Ownership

Clients send song identity and provider query context. The Service remains the
authority that:

1. resolves enabled source candidates;
2. retries audio, lyrics, and artwork;
3. prefers one complete source and mixes missing resources only when needed;
4. validates network targets and resource bytes;
5. writes and verifies media metadata; and
6. publishes or atomically replaces the final file.

Client-provided artwork URLs are compatibility candidates, not trusted media.

## Canonical Music Information

The canonical representation follows the bundled Service Web model. Provider
query fields live under `meta`, including:

- `songId`, `albumName`, `albumId`;
- `qualitys`, `_qualitys`;
- QQ Music `strMediaMid`, `id`, and `albumMid`;
- Kugou `hash`;
- Migu `copyrightId`, `lrcUrl`, `mrcUrl`, and `trcUrl`.

The canonical artwork field is `meta.picUrl`. Compatible input selects the first
non-empty HTTP(S) value in this order:

1. `meta.picUrl`;
2. `img`;
3. `pic`.

The selected value is copied to `meta.picUrl`. Legacy `img` and `pic` remain
accepted at boundaries but are not authoritative inside later business logic.
Invalid or non-HTTP(S) values are not promoted.

Flutter will add one centralized Service-request serializer matching the Web
conversion semantics. Search display may retain `raw['pic']`, but playback,
lyrics, picture, and download requests must use the canonical serializer.

The Service will independently normalize every incoming music-info object and
persisted download record. It must not assume a client performed normalization.
Normalization preserves all provider identifiers needed by existing source
adapters.

## Playback and Download Data Flow

For playback and download, the normalized music information is query context,
not an instruction to trust or copy a remote resource.

The Service resolves resources in this order:

1. validated artwork and lyrics from the successful audio candidate's source;
2. validated resources from other enabled sources to fill only missing fields;
3. the built-in original provider lookup;
4. the canonical `meta.picUrl` snapshot for artwork only;
5. a missing optional resource result.

The resolver continues to start audio, lyrics, and artwork work concurrently.
Each downloadable audio candidate carries its own resolved resource bundle and
source provenance. The candidate whose audio transfer succeeds owns the final
metadata bundle.

Every artwork URL, including `meta.picUrl`, is fetched through the Service media
client. Existing private-network restrictions, redirect handling, byte limits,
content signature checks, dimension checks, and MIME validation apply before
artwork bytes can reach the metadata writer.

## Error Semantics

Artwork and lyrics are optional enrichment resources. Acquisition failures are
isolated:

- artwork failure does not discard valid lyrics or basic tags;
- lyrics failure does not discard valid artwork or basic tags;
- all available metadata is still written and verified;
- missing requested enrichment is recorded as a bounded warning;
- no upstream URL or private path appears in client-visible errors.

A metadata acquisition miss is different from a metadata write failure.
TagLib write errors, parse errors, or write-after-read verification failures are
fatal for publication.

All new downloads use a staged file:

1. download and fsync the staged audio;
2. resolve available metadata independently;
3. write basic tags and available enrichment to the staged file;
4. parse and verify the staged result;
5. publish only after verification succeeds.

For replacement downloads, a fatal write or verification failure leaves the
original audio and sidecar files untouched. For ordinary downloads, the failed
staged file is not published as a completed library item.

## Existing Data

Persisted legacy jobs are normalized when loaded. This permits `img` or `pic`
to populate `meta.picUrl` for a future resume or redownload while retaining the
provider identifiers required for fresh Service-side lookup.

Completed audio files are not automatically rewritten. A missing embedded
cover can be repaired only through an explicit redownload or a separately
authorized future repair operation. External snapshot URLs may expire, so old
records are compatible candidates rather than a guarantee of recovery.

## Components

### Service

- A focused canonical music-info normalizer owns compatibility input handling.
- Source adapter conversion consumes canonical data without dropping a valid
  normalized picture field.
- Bundle resolution remains the primary source retry mechanism.
- Artwork snapshot fallback reuses the hardened media client.
- Metadata acquisition returns independent artwork, lyrics, and warning results.
- Metadata writing and verification operate on staged files before publication.
- Download recovery normalizes old records without rewriting completed media.

### Flutter

- `Track` retains its raw representation for display compatibility.
- A canonical serializer maps raw Service catalog results into the same shape as
  bundled Web `toNewMusicInfo`.
- Playback, lyrics, picture, and download repositories use that serializer.
- Artwork widgets keep their existing behavior and require no visual changes.

### Bundled Web

The Web conversion remains the behavioral reference. Existing search conversion
from `img` to `meta.picUrl` and its request payloads must remain compatible.

## Verification

Service tests cover:

- `meta.picUrl`, then `img`, then `pic` precedence and empty/invalid rejection;
- preservation of provider-specific identifiers;
- normalization of persisted legacy download records;
- same-source preference and mixed-resource completion;
- a provider artwork URL returning 404 followed by a valid canonical snapshot;
- independent artwork and lyrics acquisition failures;
- basic tags and available enrichment still being written;
- real MP3, FLAC, APE, and WAV metadata behavior where supported;
- staged ordinary publication and replacement rollback on TagLib or verification
  failure;
- warning envelopes that expose neither upstream URLs nor storage paths.

Flutter tests cover:

- canonical serialization matching bundled Web semantics;
- picture precedence and provider field preservation;
- canonical request bodies for playback, lyrics, picture, and download;
- unchanged use of `raw['pic']` by display consumers.

A cross-client contract fixture verifies that the same catalog result produces
equivalent core `musicInfo` fields in bundled Web and Flutter. No Flutter golden
updates are expected because the design changes no layout or visual styling.

## Acceptance Criteria

- Flutter and bundled Web produce equivalent canonical query context.
- Service accepts canonical and legacy music-info shapes.
- Service remains responsible for all resource lookup and validation.
- A failed artwork URL does not prevent lyrics or basic tags from being written.
- A failed provider artwork URL can fall back to a validated `meta.picUrl`.
- Optional resource absence completes with a warning.
- Actual metadata write or verification failure never publishes a new incomplete
  file and never replaces an existing file.
- Existing completed audio is not modified automatically.
