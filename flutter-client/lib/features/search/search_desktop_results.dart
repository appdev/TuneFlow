import 'package:flutter/material.dart' hide SearchController;
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../api/models.dart';
import '../../design/components/app_states.dart';
import '../../design/components/artwork.dart';
import '../../design/design_tokens.dart';
import 'adaptive_track_actions.dart';
import 'search_controller.dart';
import 'search_track_artwork.dart';
import 'search_track_metadata.dart';
import 'track_action.dart';

typedef TrackActionsBuilder = List<TrackAction> Function(Track track);

final class SearchDesktopResults extends StatelessWidget {
  const SearchDesktopResults({
    super.key,
    required this.state,
    required this.scrollController,
    required this.loadPicture,
    required this.onPlay,
    required this.onFavorite,
    required this.actionsFor,
    required this.onViewAll,
    required this.onPage,
    required this.onRetry,
  });

  final SearchState state;
  final ScrollController scrollController;
  final Future<Uri?> Function(Track) loadPicture;
  final ValueChanged<Track> onPlay;
  final ValueChanged<Track> onFavorite;
  final TrackActionsBuilder actionsFor;
  final ValueChanged<SearchView> onViewAll;
  final ValueChanged<int> onPage;
  final ValueChanged<CatalogSearchKind> onRetry;

  @override
  Widget build(BuildContext context) {
    if (state.query.isEmpty) {
      return const AppEmptyState(message: '输入关键词搜索音乐');
    }
    if (state.view == SearchView.overview) return _overview(context);
    if (state.view == SearchView.tracks) {
      return _trackTable(context, state.trackSection, paginated: true);
    }
    final section = state.view == SearchView.albums
        ? state.albumSection
        : state.playlistSection;
    return _collectionGrid(context, section);
  }

  Widget _overview(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final rowHeight = constraints.maxWidth < 900 ? 54.0 : 58.0;
      return ListView(
        key: const Key('search-view-overview'),
        controller: scrollController,
        padding: const EdgeInsets.only(bottom: 28),
        children: [
          if (state.trackSection.items.isNotEmpty) ...[
            _DesktopBestMatch(
              track: state.trackSection.items.first,
              loadPicture: loadPicture,
              onPlay: onPlay,
            ),
          ],
          _DesktopSectionTitle(title: '搜索结果', count: state.trackSection.total),
          SizedBox(
            height: 34 + state.overviewTracks.length * rowHeight,
            child: _trackTable(
              context,
              SearchSection(
                items: state.overviewTracks,
                page: 1,
                total: state.trackSection.total,
                phase: state.trackSection.phase,
                error: state.trackSection.error,
              ),
              paginated: false,
            ),
          ),
          if (state.providerStatuses.isNotEmpty) ...[
            const SizedBox(height: 24),
            Wrap(
              spacing: 8,
              children: state.providerStatuses
                  .map(
                    (item) => Chip(
                      label: Text(
                        item.phase == ProviderSearchPhase.success
                            ? '${item.provider.name} · ${item.resultCount} 首'
                            : '${item.provider.name} · 失败',
                      ),
                    ),
                  )
                  .toList(growable: false),
            ),
          ],
        ],
      );
    },
  );

  Widget _trackTable(
    BuildContext context,
    SearchSection<Track> section, {
    required bool paginated,
  }) {
    if (section.phase == SearchPhase.loading && section.items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (section.items.isEmpty) {
      if (section.phase == SearchPhase.failure) {
        return Center(
          child: TextButton.icon(
            onPressed: () => onRetry(CatalogSearchKind.track),
            icon: const Icon(LucideIcons.refreshCw),
            label: const Text('搜索失败，重试'),
          ),
        );
      }
      return const AppEmptyState(message: '没有找到匹配单曲');
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final showAlbum = constraints.maxWidth >= 1080;
        final showDuration = constraints.maxWidth >= 900;
        final compact = constraints.maxWidth < 900;
        return Column(
          children: [
            _DesktopTableHeader(
              showAlbum: showAlbum,
              showDuration: showDuration,
              compact: compact,
            ),
            Expanded(
              child: ListView.builder(
                controller: paginated ? scrollController : null,
                physics: paginated
                    ? null
                    : const NeverScrollableScrollPhysics(),
                itemCount: section.items.length,
                itemBuilder: (context, index) => _DesktopTrackRow(
                  index:
                      index +
                      1 +
                      ((section.page - 1) * SearchController.pageSize),
                  track: section.items[index],
                  providers: state.providers,
                  aggregate: state.source == SearchController.aggregateSource,
                  showAlbum: showAlbum,
                  showDuration: showDuration,
                  compact: compact,
                  loadPicture: loadPicture,
                  onPlay: () => onPlay(section.items[index]),
                  onFavorite: () => onFavorite(section.items[index]),
                  actions: actionsFor(section.items[index]),
                ),
              ),
            ),
            if (paginated)
              _Pagination(section: section, onPage: onPage, unit: '首'),
          ],
        );
      },
    );
  }

  Widget _collectionGrid(
    BuildContext context,
    SearchSection<CatalogCollection> section,
  ) {
    if (section.phase == SearchPhase.loading && section.items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (section.items.isEmpty) {
      return const AppEmptyState(message: '没有找到匹配内容');
    }
    return Column(
      children: [
        Expanded(
          child: GridView.builder(
            controller: scrollController,
            gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
              maxCrossAxisExtent: 260,
              mainAxisExtent: 300,
              crossAxisSpacing: 16,
              mainAxisSpacing: 16,
            ),
            itemCount: section.items.length,
            itemBuilder: (_, index) =>
                _DesktopCollectionCard(item: section.items[index]),
          ),
        ),
        _Pagination(section: section, onPage: onPage, unit: '项'),
      ],
    );
  }
}

final class _DesktopTableHeader extends StatelessWidget {
  const _DesktopTableHeader({
    required this.showAlbum,
    required this.showDuration,
    required this.compact,
  });
  final bool showAlbum;
  final bool showDuration;
  final bool compact;

  @override
  Widget build(BuildContext context) => Container(
    height: 34,
    decoration: BoxDecoration(
      border: Border(bottom: BorderSide(color: AppTokens.of(context).border)),
    ),
    child: Row(
      children: [
        SizedBox(width: compact ? 28 : 30, child: const Text('#')),
        const SizedBox(width: 12),
        SizedBox(width: compact ? 40 : 44, child: const Text('封面')),
        const SizedBox(width: 12),
        const Expanded(child: Text('歌曲名')),
        const SizedBox(width: 12),
        const SizedBox(
          width: 44,
          child: Center(child: Icon(LucideIcons.heart, size: 16)),
        ),
        if (showAlbum) ...[
          const SizedBox(width: 12),
          const Expanded(child: Text('专辑')),
        ],
        if (showDuration) ...[
          const SizedBox(width: 12),
          const SizedBox(width: 54, child: Text('时长')),
        ],
        const SizedBox(width: 12),
        const SizedBox(width: 44),
      ],
    ),
  );
}

final class _DesktopTrackRow extends StatelessWidget {
  const _DesktopTrackRow({
    required this.index,
    required this.track,
    required this.providers,
    required this.aggregate,
    required this.showAlbum,
    required this.showDuration,
    required this.compact,
    required this.loadPicture,
    required this.onPlay,
    required this.onFavorite,
    required this.actions,
  });
  final int index;
  final Track track;
  final List<CatalogProvider> providers;
  final bool aggregate;
  final bool showAlbum;
  final bool showDuration;
  final bool compact;
  final Future<Uri?> Function(Track) loadPicture;
  final VoidCallback onPlay;
  final VoidCallback onFavorite;
  final List<TrackAction> actions;

  @override
  Widget build(BuildContext context) {
    final metadata = SearchTrackMetadata.fromTrack(track);
    final row = InkWell(
      key: Key('search-track-${track.source}-${track.id}'),
      onDoubleTap: onPlay,
      child: Container(
        height: compact ? 54 : 58,
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(color: AppTokens.of(context).borderSoft),
          ),
        ),
        child: Row(
          children: [
            SizedBox(
              width: compact ? 28 : 30,
              child: Text(
                index.toString().padLeft(2, '0'),
                textAlign: TextAlign.center,
                style: AppTypography.counter.copyWith(
                  fontSize: 11,
                  color: AppTokens.of(context).muted,
                ),
              ),
            ),
            const SizedBox(width: 12),
            SizedBox(
              width: compact ? 40 : 44,
              child: SearchTrackArtwork(
                track: track,
                loadPicture: loadPicture,
                size: compact ? 36 : 38,
                borderRadius: 8,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    track.title.isEmpty ? track.id : track.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTypography.title.copyWith(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 4),
                  _DesktopMetadata(
                    track: track,
                    metadata: metadata,
                    providers: providers,
                    aggregate: aggregate,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            SizedBox(
              width: 44,
              child: IconButton(
                key: Key('search-favorite-${track.source}-${track.id}'),
                tooltip: '收藏到歌单',
                onPressed: onFavorite,
                icon: const Icon(LucideIcons.heartPlus, size: 20),
              ),
            ),
            if (showAlbum) ...[
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  metadata.album,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTypography.body.copyWith(
                    color: AppTokens.of(context).muted,
                  ),
                ),
              ),
            ],
            if (showDuration) ...[
              const SizedBox(width: 12),
              SizedBox(
                width: 54,
                child: Text(
                  metadata.durationLabel ?? '--:--',
                  style: AppTypography.counter,
                ),
              ),
            ],
            const SizedBox(width: 12),
            SizedBox(
              width: 44,
              child: DesktopTrackActionsButton(
                actions: actions,
                child: (open) => IconButton(
                  key: Key('search-more-${track.source}-${track.id}'),
                  tooltip: '更多操作',
                  onPressed: open,
                  icon: const Icon(LucideIcons.ellipsis, size: 20),
                ),
              ),
            ),
          ],
        ),
      ),
    );
    return DesktopTrackContextRegion(actions: actions, child: row);
  }
}

final class _DesktopMetadata extends StatelessWidget {
  const _DesktopMetadata({
    required this.track,
    required this.metadata,
    required this.providers,
    required this.aggregate,
  });
  final Track track;
  final SearchTrackMetadata metadata;
  final List<CatalogProvider> providers;
  final bool aggregate;

  @override
  Widget build(BuildContext context) {
    final tokens = AppTokens.of(context);
    return Row(
      children: [
        if (metadata.qualityLabel case final quality?) ...[
          Container(
            height: 16,
            padding: const EdgeInsets.symmetric(horizontal: 4),
            decoration: BoxDecoration(
              border: Border.all(color: tokens.accent.withValues(alpha: .82)),
              borderRadius: BorderRadius.circular(4),
            ),
            alignment: Alignment.center,
            child: Text(
              quality,
              style: AppTypography.metadata.copyWith(
                color: tokens.accent,
                fontSize: 9,
                height: 1,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 7),
        ],
        Flexible(
          child: Text(
            track.artist,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTypography.metadata.copyWith(color: tokens.muted),
          ),
        ),
        if (aggregate) ...[
          const SizedBox(width: 7),
          Text(
            providerLabel(providers, track.source),
            style: AppTypography.metadata.copyWith(color: tokens.accent),
          ),
        ],
      ],
    );
  }
}

final class _Pagination<T> extends StatelessWidget {
  const _Pagination({
    required this.section,
    required this.onPage,
    required this.unit,
  });
  final SearchSection<T> section;
  final ValueChanged<int> onPage;
  final String unit;

  @override
  Widget build(BuildContext context) {
    final pages = section.total == null
        ? null
        : (section.total! / SearchController.pageSize).ceil().clamp(1, 999999);
    return SizedBox(
      height: 58,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Text(
            section.total == null
                ? '${section.items.length} $unit'
                : '共 ${section.total} $unit',
          ),
          const SizedBox(width: 18),
          IconButton(
            tooltip: '上一页',
            onPressed: section.page > 1 ? () => onPage(section.page - 1) : null,
            icon: const Icon(LucideIcons.chevronLeft),
          ),
          Text(
            pages == null ? '第 ${section.page} 页' : '${section.page} / $pages',
          ),
          IconButton(
            tooltip: '下一页',
            onPressed: pages == null || section.page < pages
                ? () => onPage(section.page + 1)
                : null,
            icon: const Icon(LucideIcons.chevronRight),
          ),
        ],
      ),
    );
  }
}

final class _DesktopBestMatch extends StatelessWidget {
  const _DesktopBestMatch({
    required this.track,
    required this.loadPicture,
    required this.onPlay,
  });
  final Track track;
  final Future<Uri?> Function(Track) loadPicture;
  final ValueChanged<Track> onPlay;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final compact = constraints.maxWidth < 900;
      return Container(
        key: const Key('search-best-match'),
        height: compact ? 90 : 104,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppTokens.of(context).surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppTokens.of(context).borderSoft),
        ),
        child: Row(
          children: [
            SearchTrackArtwork(
              track: track,
              loadPicture: loadPicture,
              size: compact ? 54 : 62,
              borderRadius: 11,
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '最佳匹配',
                    style: AppTypography.metadata.copyWith(
                      color: AppTokens.of(context).accent,
                      fontSize: compact ? 10 : 11,
                      height: 1,
                    ),
                  ),
                  SizedBox(height: compact ? 4 : 7),
                  Text(
                    track.title,
                    style: AppTypography.title.copyWith(
                      fontSize: compact ? 14 : 16,
                      height: 1.1,
                    ),
                  ),
                  SizedBox(height: compact ? 3 : 5),
                  Text(
                    track.artist,
                    style: AppTypography.metadata.copyWith(height: 1.1),
                  ),
                ],
              ),
            ),
            IconButton.filled(
              tooltip: '播放',
              onPressed: () => onPlay(track),
              constraints: const BoxConstraints.tightFor(width: 40, height: 40),
              icon: const Icon(LucideIcons.play, size: 18),
            ),
          ],
        ),
      );
    },
  );
}

final class _DesktopSectionTitle extends StatelessWidget {
  const _DesktopSectionTitle({required this.title, this.count});
  final String title;
  final int? count;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 20, bottom: 10),
    child: Row(
      children: [
        Text(title, style: AppTypography.title.copyWith(fontSize: 16)),
        const Spacer(),
        if (count != null) ...[
          Text(
            '找到 $count 首单曲',
            style: AppTypography.metadata.copyWith(
              color: AppTokens.of(context).muted,
              fontSize: 11,
            ),
          ),
        ],
      ],
    ),
  );
}

final class _DesktopCollectionCard extends StatelessWidget {
  const _DesktopCollectionCard({required this.item});
  final CatalogCollection item;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: AppTokens.of(context).surface,
      border: Border.all(color: AppTokens.of(context).borderSoft),
      borderRadius: BorderRadius.circular(AppRadii.compactCard),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: LayoutBuilder(
            builder: (_, constraints) => AppArtwork(
              imageUrl: item.imageUrl?.toString(),
              seed: '${item.source}:${item.id}',
              semanticLabel: '${item.name}封面',
              size: constraints.maxWidth,
              width: constraints.maxWidth,
              height: constraints.maxHeight,
            ),
          ),
        ),
        const SizedBox(height: 10),
        Text(item.name, maxLines: 1, overflow: TextOverflow.ellipsis),
        if (item.author.isNotEmpty)
          Text(item.author, maxLines: 1, style: AppTypography.metadata),
      ],
    ),
  );
}
