import '../../api/models.dart';

enum SearchView { overview, tracks, albums, playlists }

enum SearchPhase { idle, loading, results, empty, loadingMore, failure }

enum ProviderSearchPhase { loading, success, failure }

final class SearchSection<T> {
  const SearchSection({
    this.items = const [],
    this.page = 0,
    this.total,
    this.phase = SearchPhase.idle,
    this.error,
  });

  final List<T> items;
  final int page;
  final int? total;
  final SearchPhase phase;
  final Object? error;

  bool get hasMore => total != null ? items.length < total! : items.isNotEmpty;
}

final class ProviderSearchStatus {
  const ProviderSearchStatus({
    required this.provider,
    required this.phase,
    this.resultCount = 0,
    this.error,
  });

  final CatalogProvider provider;
  final ProviderSearchPhase phase;
  final int resultCount;
  final Object? error;
}

final class SearchState {
  const SearchState({
    this.query = '',
    this.source = 'kw',
    this.view = SearchView.overview,
    this.providers = const [],
    this.trackSection = const SearchSection(),
    this.albumSection = const SearchSection(),
    this.playlistSection = const SearchSection(),
    this.providerStatuses = const [],
    this.capabilitiesLoading = false,
  });

  final String query;
  final String source;
  final SearchView view;
  final List<CatalogProvider> providers;
  final SearchSection<Track> trackSection;
  final SearchSection<CatalogCollection> albumSection;
  final SearchSection<CatalogCollection> playlistSection;
  final List<ProviderSearchStatus> providerStatuses;
  final bool capabilitiesLoading;

  SearchSection<Object?> get activeSection => switch (view) {
    SearchView.overview || SearchView.tracks => trackSection,
    SearchView.albums => albumSection,
    SearchView.playlists => playlistSection,
  };

  List<Track> get overviewTracks => trackSection.items.take(10).toList();
  List<CatalogCollection> get overviewAlbums =>
      albumSection.items.take(6).toList();
  List<CatalogCollection> get overviewPlaylists =>
      playlistSection.items.take(6).toList();

  CatalogSearchKind get kind => switch (view) {
    SearchView.overview || SearchView.tracks => CatalogSearchKind.track,
    SearchView.albums => CatalogSearchKind.album,
    SearchView.playlists => CatalogSearchKind.playlist,
  };
  List<Track> get tracks => trackSection.items;
  List<CatalogCollection> get collections => switch (view) {
    SearchView.albums => albumSection.items,
    SearchView.playlists => playlistSection.items,
    _ => const [],
  };
  int get page => activeSection.page;
  int? get total => activeSection.total;
  SearchPhase get phase => activeSection.phase;
  Object? get error => activeSection.error;
}
