import 'package:flutter/foundation.dart';

import '../../api/models.dart';
import 'search_repository.dart';
import 'search_state.dart';
import 'search_track_metadata.dart';

export 'search_state.dart';

final class SearchController extends ChangeNotifier {
  SearchController(this.repository);

  static const pageSize = 30;
  static const aggregateSource = 'all';

  final SearchRepository repository;
  final Map<(String, CatalogSearchKind, String, int), Object> _pages = {};
  final Map<(String, String), Future<Uri?>> _pictures = {};
  SearchState state = const SearchState();
  int _generation = 0;
  Future<void>? _pendingPage;

  Set<CatalogSearchKind> get supportedKinds {
    if (state.source == aggregateSource) return {CatalogSearchKind.track};
    return state.providers
            .where((provider) => provider.id == state.source)
            .firstOrNull
            ?.searchKinds ??
        {CatalogSearchKind.track};
  }

  Set<SearchView> get supportedViews => {
    SearchView.overview,
    SearchView.tracks,
    if (supportedKinds.contains(CatalogSearchKind.album)) SearchView.albums,
    if (supportedKinds.contains(CatalogSearchKind.playlist))
      SearchView.playlists,
  };

  Future<void> loadCapabilities() async {
    state = _copy(capabilitiesLoading: true);
    notifyListeners();
    try {
      final capabilities = await repository.capabilities();
      final source =
          capabilities.providers.any((item) => item.id == state.source)
          ? state.source
          : capabilities.providers.firstOrNull?.id ?? state.source;
      state = _copy(
        source: source,
        providers: capabilities.providers,
        capabilitiesLoading: false,
      );
    } on Object {
      state = _copy(capabilitiesLoading: false);
    }
    notifyListeners();
  }

  Future<void> search({required String source, required String query}) async {
    final normalizedSource = source.trim().isEmpty ? 'kw' : source.trim();
    final normalizedQuery = _normalizeQuery(query);
    final generation = ++_generation;
    _pendingPage = null;
    final effectiveView = _viewSupported(normalizedSource, state.view)
        ? state.view
        : SearchView.tracks;
    if (normalizedQuery.isEmpty) {
      state = SearchState(
        source: normalizedSource,
        view: effectiveView,
        providers: state.providers,
      );
      notifyListeners();
      return;
    }

    state = SearchState(
      query: normalizedQuery,
      source: normalizedSource,
      view: effectiveView,
      providers: state.providers,
      trackSection:
          _shouldLoad(normalizedSource, CatalogSearchKind.track, effectiveView)
          ? const SearchSection(phase: SearchPhase.loading)
          : state.trackSection,
      albumSection:
          _shouldLoad(normalizedSource, CatalogSearchKind.album, effectiveView)
          ? const SearchSection(phase: SearchPhase.loading)
          : const SearchSection(),
      playlistSection:
          _shouldLoad(
            normalizedSource,
            CatalogSearchKind.playlist,
            effectiveView,
          )
          ? const SearchSection(phase: SearchPhase.loading)
          : const SearchSection(),
      providerStatuses: normalizedSource == aggregateSource
          ? state.providers
                .where(
                  (provider) =>
                      provider.searchKinds.contains(CatalogSearchKind.track),
                )
                .map(
                  (provider) => ProviderSearchStatus(
                    provider: provider,
                    phase: ProviderSearchPhase.loading,
                  ),
                )
                .toList(growable: false)
          : const [],
    );
    notifyListeners();

    if (effectiveView == SearchView.overview) {
      final futures = <Future<void>>[
        _loadTracks(generation: generation, page: 1, replace: true),
        if (_supports(normalizedSource, CatalogSearchKind.album))
          _loadCollection(
            kind: CatalogSearchKind.album,
            generation: generation,
            page: 1,
            replace: true,
          ),
        if (_supports(normalizedSource, CatalogSearchKind.playlist))
          _loadCollection(
            kind: CatalogSearchKind.playlist,
            generation: generation,
            page: 1,
            replace: true,
          ),
      ];
      await Future.wait(futures);
      return;
    }
    await _loadActive(generation: generation, page: 1, replace: true);
  }

  Future<void> selectView(SearchView view) async {
    if (view == state.view || !supportedViews.contains(view)) return;
    state = _copy(view: view);
    notifyListeners();
    if (state.query.isEmpty) return;
    final kind = _kindFor(view);
    final cached = _pages[(state.source, kind, state.query, 1)];
    if (cached != null) {
      state = _withSection(kind, _sectionFromPage(kind, cached, 1));
      notifyListeners();
      return;
    }
    await _loadActive(generation: ++_generation, page: 1, replace: true);
  }

  Future<void> selectKind(CatalogSearchKind kind) => selectView(switch (kind) {
    CatalogSearchKind.track => SearchView.tracks,
    CatalogSearchKind.album => SearchView.albums,
    CatalogSearchKind.playlist => SearchView.playlists,
  });

  Future<void> retrySection(CatalogSearchKind kind) async {
    final generation = ++_generation;
    if (kind == CatalogSearchKind.track) {
      await _loadTracks(generation: generation, page: 1, replace: true);
    } else {
      await _loadCollection(
        kind: kind,
        generation: generation,
        page: 1,
        replace: true,
      );
    }
  }

  Future<void> loadNextPage() {
    if (_pendingPage case final pending?) return pending;
    final section = state.activeSection;
    if (state.query.isEmpty || section.page == 0 || !_hasMore(section)) {
      return Future.value();
    }
    final pending = _loadActive(
      generation: _generation,
      page: section.page + 1,
      replace: false,
    );
    _pendingPage = pending;
    return pending.whenComplete(() => _pendingPage = null);
  }

  Future<void> goToPage(int page) async {
    if (page < 1 || state.query.isEmpty || page == state.page) return;
    await _loadActive(generation: ++_generation, page: page, replace: true);
  }

  Future<void> _loadActive({
    required int generation,
    required int page,
    required bool replace,
  }) {
    final kind = _kindFor(state.view);
    return kind == CatalogSearchKind.track
        ? _loadTracks(generation: generation, page: page, replace: replace)
        : _loadCollection(
            kind: kind,
            generation: generation,
            page: page,
            replace: replace,
          );
  }

  Future<void> _loadTracks({
    required int generation,
    required int page,
    required bool replace,
  }) async {
    final previous = state.trackSection;
    state = _copy(
      trackSection: SearchSection(
        items: previous.items,
        page: previous.page,
        total: previous.total,
        phase: replace ? SearchPhase.loading : SearchPhase.loadingMore,
      ),
    );
    notifyListeners();
    try {
      final result = await _trackPage(state.source, state.query, page);
      if (generation != _generation) return;
      final items = replace
          ? result.page.tracks
          : _dedupeTracks([...previous.items, ...result.page.tracks]);
      state = _copy(
        trackSection: SearchSection(
          items: List.unmodifiable(items),
          page: page,
          total: result.page.total,
          phase: items.isEmpty ? SearchPhase.empty : SearchPhase.results,
        ),
        providerStatuses: result.statuses,
      );
    } on Object catch (error) {
      if (generation != _generation) return;
      state = _copy(
        trackSection: SearchSection(
          items: previous.items,
          page: previous.page,
          total: previous.total,
          phase: SearchPhase.failure,
          error: error,
        ),
      );
    }
    notifyListeners();
  }

  Future<void> _loadCollection({
    required CatalogSearchKind kind,
    required int generation,
    required int page,
    required bool replace,
  }) async {
    final previous = kind == CatalogSearchKind.album
        ? state.albumSection
        : state.playlistSection;
    state = _withSection(
      kind,
      SearchSection(
        items: previous.items,
        page: previous.page,
        total: previous.total,
        phase: replace ? SearchPhase.loading : SearchPhase.loadingMore,
      ),
    );
    notifyListeners();
    try {
      final result = await _collectionPage(
        kind,
        state.source,
        state.query,
        page,
      );
      if (generation != _generation) return;
      final items = replace
          ? result.items
          : [...previous.items, ...result.items];
      state = _withSection(
        kind,
        SearchSection(
          items: List.unmodifiable(items),
          page: page,
          total: result.total,
          phase: items.isEmpty ? SearchPhase.empty : SearchPhase.results,
        ),
      );
    } on Object catch (error) {
      if (generation != _generation) return;
      state = _withSection(
        kind,
        SearchSection(
          items: previous.items,
          page: previous.page,
          total: previous.total,
          phase: SearchPhase.failure,
          error: error,
        ),
      );
    }
    notifyListeners();
  }

  Future<_TrackResult> _trackPage(String source, String query, int page) async {
    final key = (source, CatalogSearchKind.track, query, page);
    if (_pages[key] case final SearchPage cached) {
      return _TrackResult(cached, state.providerStatuses);
    }
    if (source != aggregateSource) {
      final result = await repository.search(
        source: source,
        text: query,
        page: page,
        pageSize: pageSize,
      );
      _pages[key] = result;
      return _TrackResult(result, const []);
    }
    final providers = state.providers
        .where((item) => item.searchKinds.contains(CatalogSearchKind.track))
        .toList(growable: false);
    final results = await Future.wait(
      providers.map((provider) async {
        try {
          final value = await repository.search(
            source: provider.id,
            text: query,
            page: page,
            pageSize: pageSize,
          );
          return (
            page: value,
            status: ProviderSearchStatus(
              provider: provider,
              phase: ProviderSearchPhase.success,
              resultCount: value.tracks.length,
            ),
          );
        } on Object catch (error) {
          return (
            page: null,
            status: ProviderSearchStatus(
              provider: provider,
              phase: ProviderSearchPhase.failure,
              error: error,
            ),
          );
        }
      }),
    );
    if (results.every((item) => item.page == null)) {
      throw results.first.status.error ?? StateError('所有音源搜索失败');
    }
    final indexed = <({Track track, int index})>[];
    var index = 0;
    var total = 0;
    for (final item in results) {
      final result = item.page;
      if (result == null) continue;
      total += result.total ?? result.tracks.length;
      for (final track in result.tracks) {
        indexed.add((track: track, index: index++));
      }
    }
    final tracks = _dedupeTracks(indexed.map((item) => item.track)).toList();
    final originalIndex = {
      for (final item in indexed)
        (item.track.source, item.track.id): item.index,
    };
    tracks.sort((left, right) {
      final score = trackSearchScore(
        right,
        query,
      ).compareTo(trackSearchScore(left, query));
      if (score != 0) return score;
      return originalIndex[(left.source, left.id)]!.compareTo(
        originalIndex[(right.source, right.id)]!,
      );
    });
    final pageResult = SearchPage(
      tracks: List.unmodifiable(tracks),
      total: total,
    );
    _pages[key] = pageResult;
    return _TrackResult(
      pageResult,
      results.map((item) => item.status).toList(growable: false),
    );
  }

  Future<CollectionSearchPage> _collectionPage(
    CatalogSearchKind kind,
    String source,
    String query,
    int page,
  ) async {
    final key = (source, kind, query, page);
    if (_pages[key] case final CollectionSearchPage cached) return cached;
    final result = await repository.searchCollections(
      kind: kind,
      source: source,
      text: query,
      page: page,
      pageSize: pageSize,
    );
    _pages[key] = result;
    return result;
  }

  Future<Lyrics> loadLyrics(Track track) => repository.lyrics(track);

  Future<Uri?> loadPicture(Track track) =>
      _pictures.putIfAbsent((track.source, track.id), () async {
        try {
          final value = Uri.tryParse(await repository.picture(track));
          return value != null &&
                  (value.scheme == 'http' || value.scheme == 'https')
              ? value
              : null;
        } on Object {
          return null;
        }
      });

  Object? cachedPage(String source, CatalogSearchKind kind, String query) =>
      _pages[(source, kind, _normalizeQuery(query), 1)];

  bool _viewSupported(String source, SearchView view) =>
      view == SearchView.overview || _supports(source, _kindFor(view));

  bool _supports(String source, CatalogSearchKind kind) {
    if (kind == CatalogSearchKind.track) return true;
    if (source == aggregateSource) return false;
    return state.providers
            .where((provider) => provider.id == source)
            .firstOrNull
            ?.searchKinds
            .contains(kind) ??
        false;
  }

  bool _shouldLoad(String source, CatalogSearchKind kind, SearchView view) =>
      view == SearchView.overview
      ? _supports(source, kind)
      : _kindFor(view) == kind;

  bool _hasMore(SearchSection<Object?> section) => section.total != null
      ? section.items.length < section.total!
      : section.items.length >= section.page * pageSize;

  CatalogSearchKind _kindFor(SearchView view) => switch (view) {
    SearchView.overview || SearchView.tracks => CatalogSearchKind.track,
    SearchView.albums => CatalogSearchKind.album,
    SearchView.playlists => CatalogSearchKind.playlist,
  };

  SearchSection<Object?> _sectionFromPage(
    CatalogSearchKind kind,
    Object page,
    int pageNumber,
  ) => switch (page) {
    SearchPage value => SearchSection(
      items: value.tracks,
      page: pageNumber,
      total: value.total,
      phase: value.tracks.isEmpty ? SearchPhase.empty : SearchPhase.results,
    ),
    CollectionSearchPage value => SearchSection(
      items: value.items,
      page: pageNumber,
      total: value.total,
      phase: value.items.isEmpty ? SearchPhase.empty : SearchPhase.results,
    ),
    _ => throw StateError('Unsupported cached page for $kind'),
  };

  SearchState _withSection(
    CatalogSearchKind kind,
    SearchSection<Object?> section,
  ) => _copy(
    trackSection: kind == CatalogSearchKind.track
        ? _retypeSection<Track>(section)
        : null,
    albumSection: kind == CatalogSearchKind.album
        ? _retypeSection<CatalogCollection>(section)
        : null,
    playlistSection: kind == CatalogSearchKind.playlist
        ? _retypeSection<CatalogCollection>(section)
        : null,
  );

  SearchState _copy({
    String? query,
    String? source,
    SearchView? view,
    List<CatalogProvider>? providers,
    SearchSection<Track>? trackSection,
    SearchSection<CatalogCollection>? albumSection,
    SearchSection<CatalogCollection>? playlistSection,
    List<ProviderSearchStatus>? providerStatuses,
    bool? capabilitiesLoading,
  }) => SearchState(
    query: query ?? state.query,
    source: source ?? state.source,
    view: view ?? state.view,
    providers: providers ?? state.providers,
    trackSection: trackSection ?? state.trackSection,
    albumSection: albumSection ?? state.albumSection,
    playlistSection: playlistSection ?? state.playlistSection,
    providerStatuses: providerStatuses ?? state.providerStatuses,
    capabilitiesLoading: capabilitiesLoading ?? state.capabilitiesLoading,
  );
}

final class _TrackResult {
  const _TrackResult(this.page, this.statuses);
  final SearchPage page;
  final List<ProviderSearchStatus> statuses;
}

String _normalizeQuery(String value) => value.trim();

List<Track> _dedupeTracks(Iterable<Track> values) {
  final seen = <(String, String)>{};
  return values
      .where((track) => seen.add((track.source, track.id)))
      .toList(growable: false);
}

SearchSection<T> _retypeSection<T>(SearchSection<Object?> section) =>
    SearchSection<T>(
      items: section.items.cast<T>(),
      page: section.page,
      total: section.total,
      phase: section.phase,
      error: section.error,
    );
