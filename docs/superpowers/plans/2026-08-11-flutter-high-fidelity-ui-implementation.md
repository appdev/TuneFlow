# Flutter High-Fidelity UI Implementation Plan

> **For agentic workers:** Do not implement directly from this document. Use the global `workflow` skill to re-check the current evidence, present the execution plan for explicit approval, and only then implement it. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Flutter presentation layer to match the accepted Open Design desktop and mobile client while retaining the existing typed Service behavior.

**Architecture:** Preserve repositories, controllers, audio ports, Riverpod providers, and Service DTOs as the behavioral layer. Add a tokenized shadcn-based component layer and an adaptive shell that selects desktop or mobile compositions without duplicating application state. Screens render real controller state and share artwork, status, navigation, queue, dialog, sheet, and player components.

**Tech Stack:** Flutter 3 / Dart 3.9, `shadcn_ui` 0.53.6, Riverpod 3.3.2, GoRouter 17.2.3, `just_audio`, `audio_service`, Flutter widget/golden tests, macOS Release build.

## Global Constraints

- The accepted Open Design source at `/Users/ying/Library/Application Support/Open Design/namespaces/release-stable/data/projects/musicfree-immersive-gallery-ui-20260811/index.html` is the visual and interaction source of truth.
- Implement native Flutter widgets; do not embed the HTML or add a WebView.
- Preserve existing Service endpoints and behavioral-layer boundaries unless a failing contract test proves a defect.
- Visible reusable controls use `shadcn_ui` primitives through project-owned design components.
- Production UI contains no static songs, counts, connection addresses, or statuses from the prototype.
- Minimum interactive target is 44 logical pixels; prefer 48 logical pixels.
- Validate 1440×960, 1024×768, 390×844, and 360×800 viewports in light and dark themes.
- A mobile simulator is not required; `flutter build macos` is the native build gate.
- Do not stage or commit files without separate user authorization.
- Preserve unrelated dirty and untracked files in `/Volumes/ext/MusicFree`.

---

## File Structure Map

### Theme and responsive primitives

- Create `flutter-client/lib/design/design_tokens.dart`: semantic colors, radii, spacing, shadows, and typography constants.
- Modify `flutter-client/lib/design/app_theme.dart`: translate tokens into light/dark `ShadThemeData` and Material interop.
- Modify `flutter-client/lib/design/app_breakpoints.dart`: centralize desktop, narrow, and mobile layout selection.

### Shared visual components

- Create `flutter-client/lib/design/components/artwork.dart`: network artwork with deterministic gradient fallback.
- Create `flutter-client/lib/design/components/app_navigation.dart`: desktop rail and mobile destination navigation.
- Create `flutter-client/lib/design/components/status_badge.dart`: semantic status rendering.
- Create `flutter-client/lib/design/components/metric_card.dart`: count and byte metrics.
- Create `flutter-client/lib/design/components/queue_panel.dart`: shared queue list and selection callbacks.
- Modify existing button, feedback, form, state, playlist-card, track-row, and action-sheet components to consume tokens.

### Adaptive application composition

- Modify `flutter-client/lib/app/app_shell.dart`: desktop rail/content/right-context/persistent-player layout and mobile content/mini-player/bottom-navigation layout.
- Modify `flutter-client/lib/app/app_router.dart`: supply route metadata and contextual content without creating duplicate controllers.
- Modify `flutter-client/lib/features/player/mini_player.dart`: desktop persistent and mobile compact variants.

### Feature pages

- Modify home controller/screen for featured, recent, library, and queue content.
- Modify search controller/screen for desktop table and mobile rows with capability-gated categories.
- Modify playlist list/detail screens for gallery/detail compositions and blocking actions.
- Modify player state/controller/screen and lyric widgets for immersive desktop/mobile layouts.
- Modify downloads controller/screen for full state taxonomy, metrics, and bulk results.
- Modify settings controller/screen for connection diagnostics and accepted preference layout.

### Verification artifacts

- Add focused component/controller tests beside existing test groups.
- Create `flutter-client/test/visual/high_fidelity_gallery_test.dart` and `flutter-client/test/visual/goldens/` for stable viewport captures.
- Retain Service/Web validation only if the UI implementation changes an API contract.

---

### Task 1: Lock the design token system

**Files:**
- Create: `/Volumes/ext/MusicFree/flutter-client/lib/design/design_tokens.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/design/app_theme.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/design/app_breakpoints.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/design/app_theme_test.dart`

**Interfaces:**
- Produces: `AppTokens.of(BuildContext) -> AppTokens`
- Produces: `AppLayoutClass classifyLayout(double width) -> AppLayoutClass`
- Produces: `enum AppLayoutClass { mobile, narrow, desktop }`
- Consumes: Open Design light/dark CSS variables and existing `buildLightTheme` / `buildDarkTheme` entrypoints.

- [ ] **Step 1: Add failing semantic-token tests**

```dart
testWidgets('light and dark themes expose distinct semantic surfaces', (tester) async {
  Future<AppTokens> render(ThemeMode mode) async {
    late AppTokens tokens;
    await tester.pumpWidget(themeHarness(mode, Builder(builder: (context) {
      tokens = AppTokens.of(context);
      return const SizedBox();
    })));
    return tokens;
  }
  final light = await render(ThemeMode.light);
  final dark = await render(ThemeMode.dark);
  expect(light.background, isNot(dark.background));
  expect(light.focusRing.computeLuminance(), greaterThan(0));
  expect(dark.danger, isNot(dark.warning));
});

test('layout classes match accepted viewports', () {
  expect(classifyLayout(390), AppLayoutClass.mobile);
  expect(classifyLayout(1024), AppLayoutClass.narrow);
  expect(classifyLayout(1440), AppLayoutClass.desktop);
});
```

- [ ] **Step 2: Run tests and confirm the new interfaces are missing**

Run: `flutter test test/design/app_theme_test.dart`

Expected: FAIL because `AppTokens`, `AppLayoutClass`, and `classifyLayout` do not exist.

- [ ] **Step 3: Implement semantic tokens and layout classes**

```dart
enum AppLayoutClass { mobile, narrow, desktop }

AppLayoutClass classifyLayout(double width) {
  if (width < 720) return AppLayoutClass.mobile;
  if (width < 1180) return AppLayoutClass.narrow;
  return AppLayoutClass.desktop;
}

@immutable
final class AppTokens extends ThemeExtension<AppTokens> {
  const AppTokens({
    required this.background,
    required this.surface,
    required this.surfaceWarm,
    required this.foreground,
    required this.foregroundSecondary,
    required this.muted,
    required this.border,
    required this.borderSoft,
    required this.accent,
    required this.success,
    required this.warning,
    required this.danger,
    required this.focusRing,
  });

  static AppTokens of(BuildContext context) =>
      Theme.of(context).extension<AppTokens>()!;
}
```

Map Open Design semantic roles into `AppTokens.light` and `AppTokens.dark`, then install the extension in both theme builders. Define shared radius and spacing constants in the same file.

- [ ] **Step 4: Run focused theme tests**

Run: `flutter test test/design/app_theme_test.dart`

Expected: PASS with semantic surfaces and breakpoint cases verified.

- [ ] **Step 5: Run static analysis for the new public interfaces**

Run: `flutter analyze lib/design test/design`

Expected: `No issues found!`

### Task 2: Build the shared high-fidelity component layer

**Files:**
- Create: `/Volumes/ext/MusicFree/flutter-client/lib/design/components/artwork.dart`
- Create: `/Volumes/ext/MusicFree/flutter-client/lib/design/components/app_navigation.dart`
- Create: `/Volumes/ext/MusicFree/flutter-client/lib/design/components/status_badge.dart`
- Create: `/Volumes/ext/MusicFree/flutter-client/lib/design/components/metric_card.dart`
- Create: `/Volumes/ext/MusicFree/flutter-client/lib/design/components/queue_panel.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/design/components/app_button.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/design/components/app_feedback.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/design/components/app_form.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/design/components/app_states.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/design/components/playlist_card.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/design/components/track_tile.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/design/app_components_test.dart`

**Interfaces:**
- Consumes: `AppTokens.of(context)` and `Track`, `PlaylistSummary`, `DownloadStatus`.
- Produces: `AppArtwork(imageUrl, seed, size, borderRadius)`.
- Produces: `AppDestination(id, label, icon)` and adaptive navigation widgets.
- Produces: `AppStatusBadge(label, tone)` with `StatusTone.neutral/success/warning/danger`.
- Produces: `QueuePanel(tracks, currentIndex, onSelected)`.

- [ ] **Step 1: Add failing component contract tests**

```dart
testWidgets('artwork fallback is deterministic and semantically labeled', (tester) async {
  await tester.pumpWidget(harness(const AppArtwork(
    imageUrl: null,
    seed: 'kw:42',
    semanticLabel: '晚风封面',
    size: 120,
  )));
  expect(find.bySemanticsLabel('晚风封面'), findsOneWidget);
  expect(find.byType(DecoratedBox), findsWidgets);
});

testWidgets('queue panel selects the requested queue index', (tester) async {
  var selected = -1;
  await tester.pumpWidget(harness(QueuePanel(
    tracks: [track('a'), track('b')],
    currentIndex: 0,
    onSelected: (index) => selected = index,
  )));
  await tester.tap(find.byKey(const Key('queue-track-b')));
  expect(selected, 1);
});
```

- [ ] **Step 2: Run component tests and verify missing components fail**

Run: `flutter test test/design/app_components_test.dart`

Expected: FAIL on undefined shared component types.

- [ ] **Step 3: Implement artwork, status, metric, navigation, and queue components**

Use `Image.network` with an error builder that renders a seed-derived gradient. Use shadcn cards, badges, buttons, tooltips, and separators for visible primitives. Every icon-only control receives `tooltip` and semantics; rows retain a minimum height of 48.

```dart
final class QueuePanel extends StatelessWidget {
  const QueuePanel({
    super.key,
    required this.tracks,
    required this.currentIndex,
    required this.onSelected,
  });
  final List<Track> tracks;
  final int currentIndex;
  final ValueChanged<int> onSelected;
}
```

- [ ] **Step 4: Refactor existing components to consume tokens**

Remove feature-local colors, radii, target sizes, and duplicated notice styles. Keep existing public callback signatures so controllers and current tests continue compiling.

- [ ] **Step 5: Run design component and theme tests**

Run: `flutter test test/design/app_components_test.dart test/design/app_theme_test.dart`

Expected: PASS, including semantics and 48-pixel preferred target checks.

### Task 3: Replace the application shell with adaptive desktop/mobile composition

**Files:**
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/app/app_shell.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/app/app_router.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/player/mini_player.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/app/app_shell_test.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/player/player_screen_test.dart`

**Interfaces:**
- Consumes: `AppLayoutClass`, GoRouter location, `ConnectedService`, and the single shared `PlayerController`.
- Produces: `AppShell` with exactly one routed child and one player instance.
- Produces: `MiniPlayerVariant.desktop` and `MiniPlayerVariant.mobile`.

- [ ] **Step 1: Add failing shell layout tests**

```dart
testWidgets('desktop shell renders rail and persistent player without bottom nav', (tester) async {
  tester.view.physicalSize = const Size(1440, 960);
  tester.view.devicePixelRatio = 1;
  await tester.pumpWidget(connectedApp());
  expect(find.byKey(const Key('desktop-navigation')), findsOneWidget);
  expect(find.byKey(const Key('desktop-persistent-player')), findsOneWidget);
  expect(find.byType(NavigationBar), findsNothing);
});

testWidgets('mobile shell renders bottom navigation and compact player', (tester) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  await tester.pumpWidget(connectedApp());
  expect(find.byKey(const Key('mobile-bottom-navigation')), findsOneWidget);
  expect(find.byKey(const Key('mobile-mini-player')), findsOneWidget);
});
```

- [ ] **Step 2: Run shell tests and confirm current structure fails**

Run: `flutter test test/app/app_shell_test.dart`

Expected: FAIL because current `AppShell` always renders Material bottom navigation.

- [ ] **Step 3: Implement layout-class branching without duplicating state**

Use `LayoutBuilder` once in `AppShell`. The desktop branch composes navigation rail, routed child, optional context slot, and persistent player. The mobile branch composes routed child, mini player, and four-destination bottom navigation. Route selection remains derived from `GoRouterState`.

- [ ] **Step 4: Implement player variants**

```dart
enum MiniPlayerVariant { desktop, mobile }

class MiniPlayer extends StatelessWidget {
  const MiniPlayer({
    super.key,
    required this.controller,
    required this.onOpen,
    required this.variant,
  });
}
```

Both variants subscribe to the same controller and expose play/pause and open-player actions. Desktop additionally renders seek progress and previous/next controls when width permits.

- [ ] **Step 5: Run shell and player tests**

Run: `flutter test test/app/app_shell_test.dart test/features/player/player_screen_test.dart`

Expected: PASS at desktop and mobile viewport sizes.

### Task 4: Implement the high-fidelity home experience

**Files:**
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/home/home_controller.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/home/home_screen.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/client_data/client_data_repository.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/home/home_controller_test.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/home/home_screen_test.dart`

**Interfaces:**
- Consumes: playlists, completed downloads, library tracks, `flutter.playback-history.v1`, and current player queue.
- Produces: `HomeState.featured`, `HomeState.continueListening`, `HomeState.recentlyArrived`, library count/bytes, stale timestamp, and partial error.

- [ ] **Step 1: Add failing home state tests**

```dart
test('home combines successful resources and retains them on partial refresh failure', () async {
  final controller = homeControllerWithFixtures();
  await controller.refresh();
  expect(controller.state.featured, isNotEmpty);
  expect(controller.state.continueListening.first.id, 'history-1');
  expect(controller.state.libraryBytes, 4096);
  downloads.fail = true;
  await controller.refresh();
  expect(controller.state.stale, isTrue);
  expect(controller.state.featured, isNotEmpty);
});
```

- [ ] **Step 2: Run home controller tests and verify missing fields fail**

Run: `flutter test test/features/home/home_controller_test.dart`

Expected: FAIL on the new home state contract.

- [ ] **Step 3: Implement versioned history reads and deterministic home selection**

Decode only list items containing a valid track ID, source, and numeric `playedAt`. Bound history to 50 entries. Choose featured content from recent history, playlists, and completed downloads in that order, without inventing static tracks.

- [ ] **Step 4: Implement desktop and mobile home compositions**

Desktop renders the accepted feature gallery, recently arrived section, metrics, contextual queue, and stale notice. Mobile renders greeting, feature art, continue-listening grid, and relies on the shared shell for mini player/navigation.

- [ ] **Step 5: Run home controller and widget tests at two widths**

Run: `flutter test test/features/home/home_controller_test.dart test/features/home/home_screen_test.dart`

Expected: PASS with real fixture data and no overflow exceptions.

### Task 5: Implement adaptive multi-category search

**Files:**
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/search/search_controller.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/search/search_screen.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/search/track_action_sheet.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/search/search_controller_test.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/search/search_screen_test.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/search/track_action_sheet_test.dart`

**Interfaces:**
- Consumes: `CatalogCapabilities`, `CatalogSearchKind`, track/collection search pages, and existing track actions.
- Produces: per-`(source, kind, query)` page state so category switching retains results.
- Produces: non-blocking partial-error state when cached results exist.

- [ ] **Step 1: Add failing category preservation and fallback tests**

```dart
test('switching categories preserves prior results and unsupported kinds fall back to tracks', () async {
  final controller = controllerWithCapabilities({
    'kw': {CatalogSearchKind.track, CatalogSearchKind.playlist},
    'wy': CatalogSearchKind.values.toSet(),
  });
  await controller.search(source: 'wy', query: '伍佰');
  await controller.selectKind(CatalogSearchKind.album);
  await controller.search(source: 'kw', query: '伍佰');
  expect(controller.state.kind, CatalogSearchKind.track);
  expect(controller.cachedPage('wy', CatalogSearchKind.album).items, isNotEmpty);
});
```

- [ ] **Step 2: Run search tests and verify current single-page state fails**

Run: `flutter test test/features/search/search_controller_test.dart`

Expected: FAIL because prior category pages are not retained.

- [ ] **Step 3: Implement keyed search-page state**

Keep request generation guards and collapsed next-page requests. Store track and collection pages behind a typed key, and expose the selected page through `SearchState`. Unsupported categories switch to tracks before issuing a request.

- [ ] **Step 4: Implement desktop table and mobile result rows**

Desktop reproduces the source selector, category/count chips, non-blocking notice, result table, quality badges, duration, actions, and pagination. Mobile uses source chips, artwork rows, and the accepted action sheet.

- [ ] **Step 5: Run all search tests**

Run: `flutter test test/features/search`

Expected: PASS for track actions, category state, pagination, failure retention, desktop rendering, and mobile rendering.

### Task 6: Implement playlist gallery and detail surfaces

**Files:**
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/playlists/playlists_screen.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/playlists/playlist_detail_screen.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/playlists/playlists_controller.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/playlists/playlist_detail_controller.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/playlists/playlist_repository.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/playlists/playlists_controller_test.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/playlists/playlists_screen_test.dart`

**Interfaces:**
- Consumes: playlist summary/detail routes and existing track/download/player callbacks.
- Produces: rename action through `PlaylistRepository.update(String id, String name)`.
- Produces: UI-only representative artwork selection from the first usable track.

- [ ] **Step 1: Add failing rename and destructive-dialog tests**

```dart
test('rename sends the resource patch and refreshes authoritative detail', () async {
  await controller.rename('风从台北来');
  expect(repository.patchCalls.single, ('playlist-id', '风从台北来'));
  expect(controller.state.playlist?.name, '风从台北来');
});

testWidgets('delete requires explicit destructive confirmation', (tester) async {
  await tester.pumpWidget(playlistDetailHarness());
  await tester.tap(find.byKey(const Key('playlist-delete')));
  expect(find.text('删除歌单？'), findsOneWidget);
  expect(repository.deleteCalls, isEmpty);
});
```

- [ ] **Step 2: Run playlist tests and confirm missing rename behavior fails**

Run: `flutter test test/features/playlists`

Expected: FAIL on repository/controller rename and accepted dialog hierarchy.

- [ ] **Step 3: Implement rename and authoritative refresh**

Use `PATCH /api/v1/playlists/{id}` with `{name}` and refresh detail after the mutation. Preserve existing create, track ordering, removal, and delete semantics.

- [ ] **Step 4: Implement gallery and detail layouts**

Desktop list uses artwork cards; mobile uses a two-column gallery. Detail implements hero art, title/count/update time, play/download/edit/delete actions, quality/duration rows, and per-track actions. Narrow widths move secondary actions into a sheet.

- [ ] **Step 5: Run playlist tests**

Run: `flutter test test/features/playlists`

Expected: PASS with no behavior regression in ordering and playback.

### Task 7: Implement immersive now-playing and synchronized lyrics

**Files:**
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/player/player_state.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/player/player_controller.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/player/player_screen.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/player/lyrics_view.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/player/lyrics_timeline.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/player/player_controller_test.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/player/player_screen_test.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/player/lyrics_timeline_test.dart`

**Interfaces:**
- Consumes: the single `PlayerController`, `Lyrics`, audio snapshots, cached playback, and queue callbacks.
- Produces: `PlayerView { artwork, lyrics, queue }` and `setView(PlayerView)`.
- Produces: `activeLyricIndex(List<TimedLyricLine>, Duration) -> int`.

- [ ] **Step 1: Add failing lyric-index and shared-view tests**

```dart
test('active lyric index follows playback position at boundaries', () {
  final lines = [
    TimedLyricLine(time: Duration(seconds: 1), text: 'a'),
    TimedLyricLine(time: Duration(seconds: 3), text: 'b'),
  ];
  expect(activeLyricIndex(lines, const Duration(milliseconds: 999)), -1);
  expect(activeLyricIndex(lines, const Duration(seconds: 1)), 0);
  expect(activeLyricIndex(lines, const Duration(seconds: 4)), 1);
});

test('tab and swipe selection update the same player view state', () {
  controller.setView(PlayerView.queue);
  expect(controller.state.view, PlayerView.queue);
});
```

- [ ] **Step 2: Run player tests and confirm view state is missing**

Run: `flutter test test/features/player`

Expected: FAIL on `PlayerView` and `activeLyricIndex`.

- [ ] **Step 3: Implement view state and lyric selection**

Keep parsing pure and move active-index calculation out of widget build logic. Preserve translations by exact timestamp. `PlayerController` owns the selected mobile view so tabs and horizontal gestures cannot diverge.

- [ ] **Step 4: Implement desktop and mobile immersive layouts**

Desktop renders two-column artwork/lyrics and the accepted bottom control hierarchy. Mobile renders top metadata, artwork/lyrics/queue tabs, horizontal swipe, seek control, playback controls, and quality/queue actions. Auto-scroll active lyrics without stealing user scrolling while a drag is active.

- [ ] **Step 5: Run player tests**

Run: `flutter test test/features/player`

Expected: PASS for queue, retry, cache, view selection, lyric parsing, translation, controls, and keep-awake scope.

### Task 8: Implement downloads and settings state-rich surfaces

**Files:**
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/downloads/downloads_controller.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/downloads/downloads_screen.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/settings/settings_controller.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/settings/settings_screen.dart`
- Modify: `/Volumes/ext/MusicFree/flutter-client/lib/features/connection/connection_repository.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/downloads/downloads_controller_test.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/downloads/downloads_screen_test.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/settings/settings_controller_test.dart`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/features/settings/settings_screen_test.dart`

**Interfaces:**
- Consumes: download DTO timestamps/queue position, derived speed samples, local library metrics, connection health, and app settings.
- Produces: `BulkDownloadResult(succeededIds, failures)` from `pauseAll()`.
- Produces: `ConnectionDiagnostics(origin, connected, latency, apiVersion, checkedAt)`.

- [ ] **Step 1: Add failing partial-bulk and diagnostics tests**

```dart
test('pause all retains successes and reports individual failures', () async {
  repository.failFor.add('b');
  final result = await controller.pauseAll();
  expect(result.succeededIds, ['a']);
  expect(result.failures.keys, ['b']);
  expect(controller.state.jobs.singleWhere((job) => job.id == 'a').status,
      DownloadStatus.paused);
});

test('connection diagnostics measure health latency and retain API version', () async {
  final diagnostics = await repository.diagnostics(origin);
  expect(diagnostics.connected, isTrue);
  expect(diagnostics.latency, greaterThanOrEqualTo(Duration.zero));
  expect(diagnostics.apiVersion, 'v1');
});
```

- [ ] **Step 2: Run downloads/settings tests and confirm missing result types fail**

Run: `flutter test test/features/downloads test/features/settings`

Expected: FAIL on bulk-result and diagnostics contracts.

- [ ] **Step 3: Implement bulk results and diagnostics**

Pause running tasks independently, collect errors by ID, refresh once, and expose a non-blocking partial-failure notice. Measure latency around the health request and read API version from capabilities without adding a Service endpoint.

- [ ] **Step 4: Implement accepted download and settings layouts**

Downloads render every status, speed, queue position, progress, byte/count metrics, bulk pause, retry, and destructive removal. Settings render connection diagnostics separately from theme, language, quality, wake, lyrics, and translation preferences. Mobile uses stacked panels; desktop uses the accepted two-column settings grid.

- [ ] **Step 5: Run focused downloads/settings tests**

Run: `flutter test test/features/downloads test/features/settings test/features/connection`

Expected: PASS with partial failures and connection status covered.

### Task 9: Add multi-viewport visual regression coverage

**Files:**
- Create: `/Volumes/ext/MusicFree/flutter-client/test/visual/high_fidelity_gallery_test.dart`
- Create: `/Volumes/ext/MusicFree/flutter-client/test/visual/high_fidelity_fixtures.dart`
- Create: `/Volumes/ext/MusicFree/flutter-client/test/visual/goldens/home-desktop-dark.png`
- Create: `/Volumes/ext/MusicFree/flutter-client/test/visual/goldens/search-narrow-light.png`
- Create: `/Volumes/ext/MusicFree/flutter-client/test/visual/goldens/player-mobile-dark.png`
- Create: `/Volumes/ext/MusicFree/flutter-client/test/visual/goldens/downloads-compact-light.png`
- Test: `/Volumes/ext/MusicFree/flutter-client/test/visual/high_fidelity_gallery_test.dart`

**Interfaces:**
- Consumes: deterministic repositories, fixed `MediaQuery`, fixed clock/greeting, and shared themes.
- Produces: four stable baseline captures plus overflow/semantics checks for every primary route.

- [ ] **Step 1: Create deterministic visual fixtures and failing captures**

```dart
for (final scenario in highFidelityScenarios) {
  testWidgets(scenario.name, (tester) async {
    tester.view.physicalSize = scenario.size;
    tester.view.devicePixelRatio = 1;
    await tester.pumpWidget(scenario.app);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(
      find.byKey(const Key('main-shell')),
      matchesGoldenFile('goldens/${scenario.fileName}'),
    );
  });
}
```

- [ ] **Step 2: Run visual tests and verify baseline files are absent**

Run: `flutter test test/visual/high_fidelity_gallery_test.dart`

Expected: FAIL because approved Flutter baseline captures do not exist.

- [ ] **Step 3: Generate candidate captures**

Run: `flutter test --update-goldens test/visual/high_fidelity_gallery_test.dart`

Expected: four PNG files generated at the specified viewport sizes.

- [ ] **Step 4: Inspect candidates against Open Design**

Open each PNG alongside the accepted Open Design screen and verify navigation hierarchy, content density, artwork proportions, typography hierarchy, panel borders, theme contrast, player placement, dialog/sheet composition, and absence of clipping. Correct Flutter code and regenerate only affected captures until each difference is justified by real fixture content or platform insets.

- [ ] **Step 5: Run visual tests without updating baselines**

Run: `flutter test test/visual/high_fidelity_gallery_test.dart`

Expected: PASS against the reviewed captures.

### Task 10: Freeze and verify the integrated client

**Files:**
- Verify all modified Flutter files.
- Verify Service/Web files only if an API contract changed after plan execution began.

**Interfaces:**
- Consumes: completed Tasks 1–9 and frozen dependency inputs.
- Produces: one verified macOS Release application and an explicit statement of any unverified real-Service boundary.

- [ ] **Step 1: Format and assert a clean formatter result**

Run: `dart format lib test && dart format --output=none --set-exit-if-changed lib test`

Expected: second command exits 0 with no changed files.

- [ ] **Step 2: Run static analysis**

Run: `flutter analyze`

Expected: `No issues found!`

- [ ] **Step 3: Run the complete Flutter suite**

Run: `flutter test`

Expected: all unit, widget, controller, repository, and visual tests pass; real-Service acceptance may report its documented skip only when `TUNEFLOW_SERVICE_ORIGIN` is unset.

- [ ] **Step 4: Run real-Service acceptance when an origin is available**

Run: `TUNEFLOW_SERVICE_ORIGIN=http://127.0.0.1:3124 flutter test test/integration/real_service_test.dart`

Expected: PASS when the matching Service is running. If no Service is running, do not substitute a mock and report this boundary.

- [ ] **Step 5: Build the macOS Release application**

Run: `flutter build macos`

Expected: `build/macos/Build/Products/Release/MusicFree Service.app` is created successfully.

- [ ] **Step 6: Re-run Service/Web gates only if their code changed**

Run from `/Volumes/ext/tuneflow-server-web`:

```bash
npm run lint
npm test
npm run build:web
npm run build:server
```

Expected: zero lint/test failures and successful Web/Service builds. Existing documented bundler warnings do not become failures unless introduced or changed by this implementation.

- [ ] **Step 7: Review final boundaries**

Run:

```bash
git -C /Volumes/ext/tuneflow-server-web diff --check
git -C /Volumes/ext/tuneflow-server-web status --short
git -C /Volumes/ext/MusicFree status --short -- flutter-client
```

Expected: no whitespace errors; only intended Service documentation/API changes and Flutter client changes are reported. Do not stage or commit them.
