# Flutter high-fidelity client implementation design

## Outcome

Rebuild the Flutter presentation layer so the accepted Open Design project is
the visual and interaction source of truth. The implementation must preserve the
existing typed Service integration and replace the current utility-oriented
screens with a screen-for-screen adaptive client.

The accepted design source is:

```text
/Users/ying/Library/Application Support/Open Design/namespaces/release-stable/data/projects/musicfree-immersive-gallery-ui-20260811/index.html
```

This is an implementation task, not a redesign. Production screens may adapt
content density to real data and platform insets, but may not substitute a new
navigation model, visual language, or component system.

## Product boundary

### In scope

- Desktop and narrow-window application shells.
- Mobile layouts represented by the accepted design.
- Home, search, playlists, playlist detail, now playing, downloads, settings,
  persistent player, queue, dialogs, sheets, and stale/offline notices.
- Light and dark themes derived from the design tokens.
- Real Service state for every production screen.
- Loading, empty, stale, offline, partial-source failure, destructive action,
  and unsupported-capability states.
- Keyboard focus, minimum touch targets, semantic labels, safe areas, and text
  scaling within the accepted layout.

### Out of scope

- Changing Service endpoint semantics except for a proven contract defect.
- Replacing Flutter with a WebView or embedding the Open Design HTML.
- Reintroducing plugin execution into the client.
- New product features not shown in the accepted design.
- Maintaining the current low-fidelity page structure for compatibility.

## Implementation strategy

Use exact native Flutter mapping. Existing API models, repositories,
controllers, audio handling, event coordination, and storage remain the
behavioral layer. Widgets consume those interfaces and do not issue Service
requests directly.

The UI uses `shadcn_ui` for interactive primitives and a project-owned adaptive
composition layer for layout. Material widgets remain acceptable only where
required by Flutter infrastructure or platform integration; visible controls
must be styled through the shared design system.

Alternatives are rejected:

- Incremental restyling cannot reproduce the accepted shell hierarchy and
  responsive behavior.
- A WebView would duplicate state, weaken accessibility, and defeat the Flutter
  rewrite.

## Design system mapping

### Tokens

`lib/design/app_theme.dart` owns the translated token set:

- OKLCH colors from the Open Design light and dark themes are converted to fixed
  Flutter colors without changing their perceived hierarchy.
- Background, surface, warm surface, primary foreground, secondary foreground,
  muted text, border, soft border, accent, success, warning, danger, focus, and
  overlay colors are separately addressable.
- Radius tokens cover compact controls, cards, panels, sheets, dialogs, and the
  mobile device composition.
- Elevation tokens reproduce the restrained panel borders and raised dialog/
  sheet shadows.
- Typography exposes display headlines, section titles, body, metadata, and
  monospaced status/counter styles.
- Spacing uses a small fixed scale; pages do not introduce arbitrary local
  spacing constants where a token exists.

### Shared components

The existing `lib/design/components` directory becomes the only public widget
surface for repeated visual patterns:

- adaptive navigation item and application shell;
- artwork tile, feature artwork, playlist card, track row, and queue row;
- status badge, metric card, notice, empty state, and retry state;
- primary, secondary, ghost, icon, and destructive actions;
- search field, source selector, filter chip, quality selector, and progress;
- bottom sheet, blocking dialog, and stale-data banner;
- desktop persistent player and mobile mini player.

Components expose semantic content and callbacks. They do not depend directly
on Riverpod, repositories, routes, or concrete Service DTOs unless their sole
purpose is to render that DTO.

## Adaptive shell

### Desktop

At desktop widths, the shell contains:

1. a fixed left navigation rail with product identity, five destinations, and
   Service status;
2. the routed primary content area;
3. an optional contextual right panel for the queue or page-specific summary;
4. a persistent bottom player above the window edge.

The now-playing route becomes an immersive full-content composition while
retaining a clear route back to the gallery. Desktop content uses panels and
tables where the design does; it does not stretch mobile cards across the
window.

### Narrow and mobile

At the design breakpoint, the shell switches structurally rather than merely
shrinking:

- bottom navigation replaces the left rail;
- the persistent player becomes a compact mini player;
- tables become touch-friendly rows;
- secondary actions move into sheets;
- desktop side panels become tabs, sheets, or inline sections;
- device safe areas and keyboard insets are honored.

The now-playing mobile route exposes three views: artwork, synchronized lyrics,
and queue. Tabs and horizontal swipe select the same state and cannot diverge.

## Screen specifications

### Home

- Desktop uses the featured artwork gallery, recently arrived content, queue
  panel, and stale-cache notice shown in the design.
- Mobile uses a greeting, large feature artwork, continue-listening grid, mini
  player, and four-destination navigation.
- Playlist summaries, completed downloads, local library totals, and versioned
  playback history supply real content.
- Missing artwork uses a designed gradient placeholder, not a raw icon or broken
  image.

### Search

- Source selection comes from catalog capabilities.
- Track, album, and playlist filters are enabled only when the current source
  advertises the capability.
- Each category owns its pagination and result state.
- Track actions expose play, play next, enqueue, add to playlist, lyrics, and
  download as supported by the existing behavioral layer.
- Partial source errors are non-blocking notices when usable results remain.
- Desktop uses the designed table; narrow layouts use artwork rows and an action
  sheet.

### Playlists

- The list screen presents gallery cards using representative artwork or the
  design placeholder.
- Detail includes count, update metadata, play all, download, edit, delete,
  quality, duration, and per-track actions.
- Create, rename, and delete use blocking dialogs where confirmation is required.
- Optimistic presentation must reconcile with the authoritative Service result.

### Now playing

- Artwork, title, artist, album metadata, quality, queue count, seek position,
  duration, previous, play/pause, and next match the accepted hierarchy.
- LRC lines are synchronized with playback position and the active line receives
  the accent hierarchy.
- Translation is aligned by timestamp and respects the translation preference.
- Queue selection changes the same `PlayerController` queue used by the mini
  player and system audio controls.
- Cached media is tried before Service resolution so previously cached audio
  remains playable during Service loss.

### Downloads

- Render running, waiting, paused, failed, completed, and stale/offline states.
- Running tasks show derived transfer speed and progress.
- Waiting tasks show Service-provided queue position.
- Desktop includes local byte/count metrics and a queue summary panel.
- Bulk pause composes the existing per-task endpoint and reports partial failure
  without hiding successful mutations.
- Destructive removal always uses the accepted confirmation dialog.

### Settings

- Service origin, connected/disconnected state, measured latency, API version,
  and reconnect action occupy a distinct connection panel.
- Theme, language, default quality, keep-awake, default lyrics, and translation
  preferences use shadcn selectors and switches.
- Reconnection is blocking only while validating the new origin; cached
  playback remains independent.

## Data and state flow

```text
Service API / local preferences / audio snapshots
                  ↓
Repository and platform ports
                  ↓
Controller or Riverpod state
                  ↓
Adaptive page composition
                  ↓
Shared high-fidelity components
```

Screens retain the last successful data while refreshing. A failed refresh
marks retained data stale and displays the last-sync context. Empty and failure
states are distinct. Widgets may derive presentation-only values such as byte
totals, transfer speed, and active lyric index, but authoritative identities,
ordering, capabilities, and task status come from the Service or controller.

No production screen contains the static songs, counts, connection addresses,
or status values embedded in the Open Design prototype.

## Error and interaction taxonomy

- Blocking: destructive confirmation, invalid Service origin, unsupported API
  version, and operations whose continuation would corrupt the current action.
- Non-blocking: partial source timeout, stale cached state, background refresh
  failure, artwork failure, history persistence failure, and optional metadata
  failure.
- Recoverable actions provide an explicit retry or reconnect control.
- Error messages preserve stable Service error codes for diagnostics while the
  primary copy remains understandable to users.
- Keyboard focus returns to the invoking control when a dialog or sheet closes.

## Accessibility and input

- Interactive targets are at least 44 logical pixels, with 48 preferred.
- Icon-only controls have semantic labels and tooltips on pointer platforms.
- Focus rings use the design focus token and remain visible in both themes.
- Navigation, tabs, sliders, dialogs, and sheets expose the correct semantics.
- Text remains readable at 200 percent scaling without clipping primary actions.
- Hover is enhancement only; every operation works with touch and keyboard.

## Verification and acceptance

### Component and state tests

- Token/theme tests cover light and dark semantic roles.
- Widget tests cover desktop and narrow variants of shared components.
- Controller tests cover capability fallback, stale-data retention, bulk action
  partial failure, lyric synchronization, queue selection, and cached playback.
- Existing Service and Flutter API contract tests remain mandatory.

### Multi-viewport visual validation

Render and inspect at minimum:

- 1440 × 960 desktop;
- 1024 × 768 narrow desktop/tablet landscape;
- 390 × 844 mobile;
- 360 × 800 compact mobile.

For each viewport, verify home, search, playlist detail, now playing, downloads,
settings, a blocking dialog, a bottom sheet, stale data, and dark/light theme.
Comparisons use the accepted Open Design source as the reference. Differences
must be caused by real content, platform-safe-area behavior, or documented
Flutter rendering constraints—not convenience substitutions.

### Build gate

- `flutter analyze` reports no issues.
- The complete Flutter test suite passes.
- The real-Service acceptance test runs when `TUNEFLOW_SERVICE_ORIGIN` is available;
  otherwise the unverified boundary is reported.
- `flutter build macos` succeeds; no mobile simulator is required.
- Relevant Service contract tests and the existing Web production build pass if
  an API contract changes during implementation.

## Delivery sequence

1. Translate and lock theme/layout tokens.
2. Build and test shared artwork, status, navigation, and player components.
3. Replace the shell with desktop and mobile compositions.
4. Implement home and search against real data.
5. Implement playlists and playlist detail.
6. Implement immersive now playing and synchronized lyrics.
7. Implement downloads and settings state variants.
8. Perform multi-viewport visual validation and correct deviations.
9. Freeze the tree and run the final analysis, tests, and macOS build.

The implementation remains uncommitted unless the user separately authorizes a
commit. Existing unrelated worktree state is preserved.
