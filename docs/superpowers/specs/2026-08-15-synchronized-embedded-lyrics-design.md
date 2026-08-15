# Synchronized Embedded Lyrics Design

## Problem

The library resource derivation reads only `ILyricsTag.text` from
`music-metadata`. For an LRC-bearing FLAC Vorbis `LYRICS` tag,
`music-metadata` intentionally exposes both representations:

- `text`: unsynchronized text with time labels removed.
- `syncText`: ordered lyric entries with millisecond timestamps.

The deployed copy of “挪威的森林” contains 55 native LRC time labels and is
parsed into 55 `syncText` entries, while the Service-derived lyric contains no
time labels. Flutter therefore receives plain text and cannot select or follow
an active lyric line.

## Design

The Service remains the only layer changed. `LibraryResourceStore` will prefer
valid synchronized embedded lyric entries and serialize them as conventional
LRC lines in `[mm:ss.mmm]text` form. When no synchronized entries exist, it
will preserve the current embedded plain-text fallback, followed by the current
sidecar fallback. Flutter's existing LRC parser and active-line scrolling remain
unchanged.

The resource derivation signature will include a fixed revision token. Raising
that token invalidates pre-fix markers once, causing existing audio files to be
reparsed without renaming or redownloading them. After the new markers are
written, restart behavior returns to the existing no-reparse fast path.

## Boundaries

- Do not infer timestamps from duration or distribute lines heuristically.
- Do not modify audio files or their embedded metadata.
- Do not change download metadata writing; it already preserves provider LRC.
- Keep existing cover extraction, sidecar lookup, orphan reconciliation, and
  atomic writes unchanged.
- Do not modify the Flutter client unless runtime evidence reveals a separate
  client regression after the Service returns timed LRC.

## Verification

- A focused unit test proves `syncText` is preferred over stripped `text` and
  emitted with stable LRC timestamp formatting.
- A focused unit test proves a legacy marker signature is reparsed once and a
  restarted store then reuses the revised marker.
- Existing `LibraryResourceStore` tests remain green.
- After Docker deployment, the library lyric endpoint for “挪威的森林” must
  contain 55 time labels.
- The latest macOS client must highlight and scroll lyrics as playback crosses
  at least two lyric timestamps; restart must retain the behavior.

## Rollback

Rollback uses the already retained previous Docker container/image and the same
persistent volume. The new derived `.lrc` and marker files are disposable
caches; reverting the container does not modify the source audio files.
