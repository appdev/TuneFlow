# Cross-Provider Resource Backfill Design

**Date:** 2026-08-16

**Status:** Approved for unattended implementation.

## Goal

When the currently selected track has usable audio but lacks lyrics or artwork,
keep that audio unchanged and let the Service search matching tracks on other
built-in providers to fill only the missing resources.

## Resolution Order

For each requested resource, the Service resolves in this order:

1. validated matching local-library resource;
2. validated bounded in-memory cache;
3. original provider through enabled source scripts in configured A/B/C order;
4. original provider's built-in implementation;
5. matching alternative-provider candidates, in existing match-quality order;
6. for each alternative, enabled source scripts in A/B/C order followed by that
   provider's built-in implementation.

The first validated resource wins. Lyrics and artwork resolve independently.
Resource backfill never replaces or re-resolves the selected audio.

## Candidate Matching and Bounds

Reuse `findAlternativeMusic`, which searches other built-in providers and
matches by normalized title, singer, album, and duration. Ignore candidates
without a provider, candidates from the original provider, and duplicate
provider/track identities. Apply a small named candidate limit so a resource
retry cannot create unbounded provider work.

## Service Boundaries

`TrackResourceService` remains the resource-specific orchestrator. It receives
an injected alternative finder and resolves one normalized track candidate at
a time. The existing source snapshot controls script order and capability
filtering. Built-in provider access remains injected, keeping the resolver
independently testable.

Playback bundle selection continues to own audio. It may use the same resource
backfill helper for missing enrichment, but a successful original-provider
audio candidate is never displaced merely because its lyrics or artwork are
missing.

Flutter and hosted Web continue to call the existing catalog lyrics and
picture endpoints. They do not search providers or retry source scripts.

## Failure and Cancellation

Caller cancellation and safety-policy failures stop immediately. A missing,
empty, malformed, or unavailable optional resource advances to the next source
script, built-in provider, or alternative candidate. If every candidate is
exhausted, return `SOURCE_ALL_UNAVAILABLE` without exposing URLs, headers,
scripts, lyric text, or image bytes.

Alternative-search failure is treated as exhaustion of cross-provider
backfill after the original-provider chain has already failed. It does not
change source ordering or persist health state.

## Caching and Provenance

Cache the validated result under the original track identity so subsequent
manual retries or event-driven reloads do not repeat cross-provider searches.
Internal provenance may identify the provider and source script for safe
diagnostics, but the public catalog response remains backward compatible.

## Verification

- Original provider resource succeeds without alternative search.
- Original provider scripts and built-in implementation are exhausted before
  alternative search.
- A matching alternative provider supplies lyrics while original audio remains
  selected.
- Artwork follows the same cross-provider order independently.
- Duplicate and same-provider alternatives are skipped and the candidate bound
  is enforced.
- Cancellation and safety failures remain terminal.
- Exhaustion returns `SOURCE_ALL_UNAVAILABLE`.
- The exact `壁上观` request succeeds against the deployed Service after the
  new image is activated, while playback continues using its existing stream.
