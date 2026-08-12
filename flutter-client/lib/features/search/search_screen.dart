import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/material.dart' hide SearchController;
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../api/models.dart';
import '../../design/app_breakpoints.dart';
import '../../design/components/app_button.dart';
import '../../design/components/app_feedback.dart';
import '../../design/components/app_form.dart';
import '../../design/components/app_states.dart';
import '../../design/design_tokens.dart';
import '../downloads/download_repository.dart';
import '../player/player_controller.dart';
import '../playlists/playlist_repository.dart';
import 'adaptive_track_actions.dart';
import 'search_controller.dart';
import 'search_desktop_results.dart';
import 'search_history_panel.dart';
import 'search_history_repository.dart';
import 'search_mobile_results.dart';
import 'search_track_metadata.dart';
import 'track_action.dart';

final class SearchScreen extends StatefulWidget {
  SearchScreen({
    super.key,
    required this.controller,
    required this.playlists,
    required this.downloads,
    required this.player,
    SearchHistoryRepository? history,
  }) : history = history ?? SearchHistoryRepository();

  final SearchController controller;
  final PlaylistRepository playlists;
  final DownloadRepository downloads;
  final PlayerController player;
  final SearchHistoryRepository history;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

final class _SearchScreenState extends State<SearchScreen> {
  final query = TextEditingController();
  final searchFocus = FocusNode();
  final scroll = ScrollController();
  String selectedSource = 'kw';
  var mobileLayout = false;
  List<String> historyItems = const [];
  var historyDismissed = false;

  bool get showHistory =>
      searchFocus.hasFocus &&
      query.text.trim().isEmpty &&
      historyItems.isNotEmpty &&
      !historyDismissed;

  @override
  void initState() {
    super.initState();
    query.text = widget.controller.state.query;
    selectedSource = widget.controller.state.source;
    scroll.addListener(_loadMore);
    query.addListener(_historyChanged);
    searchFocus.addListener(_historyChanged);
    unawaited(_loadHistory());
    unawaited(
      widget.controller.loadCapabilities().then((_) {
        if (!mounted) return;
        setState(() => selectedSource = widget.controller.state.source);
      }),
    );
  }

  Future<void> _loadHistory() async {
    final items = await widget.history.load();
    if (mounted) setState(() => historyItems = items);
  }

  void _historyChanged() {
    if (!mounted) return;
    if (query.text.isNotEmpty) historyDismissed = false;
    setState(() {});
  }

  void _loadMore() {
    if (mobileLayout && scroll.position.extentAfter < 240) {
      unawaited(widget.controller.loadNextPage());
    }
  }

  Future<void> _search({String? submittedKeyword}) async {
    final keyword = (submittedKeyword ?? query.text).trim();
    final search = widget.controller.search(
      source: selectedSource,
      query: keyword,
    );
    if (keyword.isNotEmpty) {
      final items = await widget.history.record(keyword);
      if (mounted) {
        setState(() {
          historyItems = items;
          historyDismissed = true;
        });
      }
    }
    await search;
  }

  Future<void> _selectHistory(String keyword) async {
    setState(() {
      query.value = TextEditingValue(
        text: keyword,
        selection: TextSelection.collapsed(offset: keyword.length),
      );
      historyDismissed = true;
    });
    searchFocus.unfocus();
    await _search(submittedKeyword: keyword);
  }

  Future<void> _removeHistory(String keyword) async {
    final items = await widget.history.remove(keyword);
    if (mounted) setState(() => historyItems = items);
  }

  Future<void> _clearHistory() async {
    final items = await widget.history.clear();
    if (mounted) setState(() => historyItems = items);
  }

  Future<void> _play(Track track) async {
    final embedded = track.raw['pic'];
    if (embedded is String && embedded.isNotEmpty) {
      await widget.player.play(track);
      return;
    }
    final picture = await widget.controller.loadPicture(track);
    final playable = picture == null
        ? track
        : Track.fromJson({...track.toJson(), 'pic': picture.toString()});
    await widget.player.play(playable);
  }

  Future<void> _run(Future<void> Function() action, {String? success}) async {
    try {
      await action();
      if (mounted && success != null) {
        showAppMessage(context, title: '完成', message: success);
      }
    } on Object catch (error) {
      if (mounted) {
        showAppMessage(
          context,
          title: '操作失败',
          message: error.toString(),
          destructive: true,
        );
      }
    }
  }

  Future<void> _lyrics(Track track) async {
    final lyrics = await widget.controller.loadLyrics(track);
    if (!mounted) return;
    await showAppSheet<void>(
      context,
      title: track.title.isEmpty ? '歌词' : track.title,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 430),
        child: SingleChildScrollView(
          child: SelectableText(
            [
              lyrics.original,
              if (lyrics.translation case final value?) value,
            ].join('\n\n'),
          ),
        ),
      ),
    );
  }

  Future<void> _choosePlaylist(Track track) async {
    final items = await widget.playlists.list();
    if (!mounted) return;
    await showAppSheet<void>(
      context,
      title: '添加到歌单',
      child: items.isEmpty
          ? const AppEmptyState(message: '还没有歌单')
          : ListView.builder(
              shrinkWrap: true,
              itemCount: items.length,
              itemBuilder: (context, index) {
                final playlist = items[index];
                return AppButton(
                  variant: ShadButtonVariant.ghost,
                  onPressed: () => _run(
                    () => widget.playlists.addTracks(playlist.id, [track]),
                    success: '已添加到 ${playlist.name}',
                  ),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(playlist.name),
                  ),
                );
              },
            ),
    );
  }

  List<TrackAction> _actionsFor(Track track) => buildTrackActions(
    track: track,
    player: widget.player,
    showLyrics: (value) => _run(() => _lyrics(value)),
    addToPlaylist: (value) => _run(() => _choosePlaylist(value)),
    download: (value, quality) => _run(
      () => widget.downloads.create(value, quality),
      success: '已交给 Service 下载',
    ),
  );

  void _more(Track track) {
    unawaited(
      showMobileTrackActions(
        context,
        track: track,
        metadata: SearchTrackMetadata.fromTrack(track),
        actions: _actionsFor(track),
      ),
    );
  }

  Future<void> _page(int page) async {
    await widget.controller.goToPage(page);
    if (scroll.hasClients) scroll.jumpTo(0);
  }

  @override
  void dispose() {
    scroll
      ..removeListener(_loadMore)
      ..dispose();
    query.dispose();
    searchFocus.dispose();
    widget.controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) => LayoutBuilder(
      builder: (context, constraints) {
        final state = widget.controller.state;
        final mobile =
            classifyLayout(constraints.maxWidth) == AppLayoutClass.mobile;
        mobileLayout = mobile;
        return ColoredBox(
          key: Key(mobile ? 'search-mobile-layout' : 'search-wide-layout'),
          color: AppTokens.of(context).background,
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              mobile ? (constraints.maxWidth <= 360 ? 10 : 12) : 30,
              mobile ? 10 : 24,
              mobile ? (constraints.maxWidth <= 360 ? 10 : 12) : 30,
              0,
            ),
            child: CallbackShortcuts(
              bindings: {
                SingleActivator(LogicalKeyboardKey.escape): () {
                  if (showHistory) setState(() => historyDismissed = true);
                },
              },
              child: TapRegion(
                onTapOutside: (_) {
                  if (showHistory) setState(() => historyDismissed = true);
                },
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _SearchBar(
                          mobile: mobile,
                          state: state,
                          controller: query,
                          focusNode: searchFocus,
                          onSearch: _search,
                        ),
                        if (mobile && showHistory) ...[
                          const SizedBox(height: 8),
                          SearchHistoryPanel(
                            items: historyItems,
                            mobile: true,
                            onSelected: (value) =>
                                unawaited(_selectHistory(value)),
                            onRemoved: (value) =>
                                unawaited(_removeHistory(value)),
                            onCleared: () => unawaited(_clearHistory()),
                          ),
                        ],
                        SizedBox(height: mobile ? 4 : 18),
                        _SourceTabs(
                          state: state,
                          selected: selectedSource,
                          onSelected: (source) {
                            setState(() => selectedSource = source);
                            unawaited(_search());
                          },
                        ),
                        _ViewTabs(
                          controller: widget.controller,
                          state: state,
                          onSelected: (view) =>
                              unawaited(widget.controller.selectView(view)),
                        ),
                        if (!(mobile && showHistory))
                          Expanded(
                            child: mobile
                                ? SearchMobileResults(
                                    state: state,
                                    scrollController: scroll,
                                    loadPicture: widget.controller.loadPicture,
                                    onPlay: (track) =>
                                        unawaited(_run(() => _play(track))),
                                    onFavorite: (track) => unawaited(
                                      _run(() => _choosePlaylist(track)),
                                    ),
                                    onMore: _more,
                                    onViewAll: (view) => unawaited(
                                      widget.controller.selectView(view),
                                    ),
                                    onRetry: (kind) => unawaited(
                                      widget.controller.retrySection(kind),
                                    ),
                                  )
                                : SearchDesktopResults(
                                    state: state,
                                    scrollController: scroll,
                                    loadPicture: widget.controller.loadPicture,
                                    onPlay: (track) =>
                                        unawaited(_run(() => _play(track))),
                                    onFavorite: (track) => unawaited(
                                      _run(() => _choosePlaylist(track)),
                                    ),
                                    actionsFor: _actionsFor,
                                    onViewAll: (view) => unawaited(
                                      widget.controller.selectView(view),
                                    ),
                                    onPage: (page) => unawaited(_page(page)),
                                    onRetry: (kind) => unawaited(
                                      widget.controller.retrySection(kind),
                                    ),
                                  ),
                          ),
                      ],
                    ),
                    if (!mobile && showHistory)
                      Positioned(
                        top: 48,
                        left: 90,
                        width: 610,
                        child: SearchHistoryPanel(
                          items: historyItems,
                          mobile: false,
                          onSelected: (value) =>
                              unawaited(_selectHistory(value)),
                          onRemoved: (value) =>
                              unawaited(_removeHistory(value)),
                          onCleared: () => unawaited(_clearHistory()),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    ),
  );
}

final class _SearchBar extends StatelessWidget {
  const _SearchBar({
    required this.mobile,
    required this.state,
    required this.controller,
    required this.focusNode,
    required this.onSearch,
  });
  final bool mobile;
  final SearchState state;
  final TextEditingController controller;
  final FocusNode focusNode;
  final Future<void> Function() onSearch;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: mobile ? 44 : 42,
    child: Row(
      children: [
        if (!mobile) ...[
          const _HistoryButton(icon: LucideIcons.chevronLeft, tooltip: '返回'),
          const SizedBox(width: 4),
          const _HistoryButton(icon: LucideIcons.chevronRight, tooltip: '前进'),
          const SizedBox(width: 14),
        ],
        Flexible(
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxWidth: mobile ? double.infinity : 610,
            ),
            child: AppTextField(
              key: const Key('search-field'),
              controller: controller,
              focusNode: focusNode,
              placeholder: '搜索音乐',
              leading: const Padding(
                padding: EdgeInsets.only(left: 10),
                child: Icon(LucideIcons.search, size: 18),
              ),
              trailing: mobile
                  ? null
                  : const Padding(
                      padding: EdgeInsets.only(right: 10),
                      child: Text('⌘ K', style: AppTypography.metadata),
                    ),
              onSubmitted: (_) => onSearch(),
            ),
          ),
        ),
        if (mobile) ...[
          const SizedBox(width: 8),
          IconButton(
            key: const Key('search-options-button'),
            tooltip: '搜索选项',
            onPressed: () {},
            constraints: const BoxConstraints.tightFor(width: 44, height: 44),
            icon: const Icon(LucideIcons.ellipsis, size: 20),
          ),
        ],
      ],
    ),
  );
}

final class _HistoryButton extends StatelessWidget {
  const _HistoryButton({required this.icon, required this.tooltip});
  final IconData icon;
  final String tooltip;

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: 36,
    child: IconButton(
      tooltip: tooltip,
      onPressed: null,
      constraints: const BoxConstraints.tightFor(width: 36, height: 36),
      padding: EdgeInsets.zero,
      icon: Icon(icon, size: 18),
    ),
  );
}

final class _SourceTabs extends StatelessWidget {
  const _SourceTabs({
    required this.state,
    required this.selected,
    required this.onSelected,
  });
  final SearchState state;
  final String selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final providers = [
      ...state.providers.map((item) => (item.id, item.name)),
      (SearchController.aggregateSource, '聚合搜索'),
    ];
    return SizedBox(
      height: 42,
      child: SingleChildScrollView(
        key: const Key('search-source-tabs'),
        scrollDirection: Axis.horizontal,
        child: Row(
          children: providers
              .map(
                (provider) => Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: TextButton(
                    key: Key('search-source-${provider.$1}'),
                    onPressed: () => onSelected(provider.$1),
                    style: TextButton.styleFrom(
                      minimumSize: const Size(0, 32),
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      foregroundColor: provider.$1 == selected
                          ? AppTokens.of(context).accent
                          : AppTokens.of(context).muted,
                      backgroundColor: provider.$1 == selected
                          ? AppTokens.of(context).accent.withValues(alpha: .14)
                          : Colors.transparent,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(9),
                      ),
                    ),
                    child: Text(
                      provider.$2,
                      style: const TextStyle(fontSize: 13),
                    ),
                  ),
                ),
              )
              .toList(growable: false),
        ),
      ),
    );
  }
}

final class _ViewTabs extends StatelessWidget {
  const _ViewTabs({
    required this.controller,
    required this.state,
    required this.onSelected,
  });
  final SearchController controller;
  final SearchState state;
  final ValueChanged<SearchView> onSelected;

  @override
  Widget build(BuildContext context) {
    const labels = {
      SearchView.overview: '综合',
      SearchView.tracks: '单曲',
      SearchView.playlists: '歌单',
    };
    final visibleViews = controller.supportedViews
        .where((view) => view != SearchView.albums)
        .toList(growable: false);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: visibleViews
            .map(
              (view) => TextButton(
                key: Key('search-view-${view.name}'),
                onPressed: () => onSelected(view),
                style: TextButton.styleFrom(
                  minimumSize: const Size(64, 44),
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  foregroundColor: view == state.view
                      ? AppTokens.of(context).foreground
                      : AppTokens.of(context).muted,
                ),
                child: Container(
                  height: 44,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(
                        width: 2,
                        color: view == state.view
                            ? AppTokens.of(context).accent
                            : Colors.transparent,
                      ),
                    ),
                  ),
                  child: Text(
                    labels[view]!,
                    style: const TextStyle(fontSize: 14),
                  ),
                ),
              ),
            )
            .toList(growable: false),
      ),
    );
  }
}
