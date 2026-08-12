import 'package:flutter/material.dart' hide SearchController;
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../api/models.dart';
import '../../design/components/app_button.dart';
import '../../design/components/app_states.dart';
import '../../design/components/artwork.dart';
import '../../design/design_tokens.dart';
import 'search_controller.dart';
import 'search_track_metadata.dart';

typedef TrackCallback = void Function(Track track);

final class SearchMobileResults extends StatelessWidget {
  const SearchMobileResults({
    super.key,
    required this.state,
    required this.scrollController,
    required this.loadPicture,
    required this.onPlay,
    required this.onFavorite,
    required this.onMore,
    required this.onViewAll,
    required this.onRetry,
  });

  final SearchState state;
  final ScrollController scrollController;
  final Future<Uri?> Function(Track) loadPicture;
  final TrackCallback onPlay;
  final TrackCallback onFavorite;
  final TrackCallback onMore;
  final ValueChanged<SearchView> onViewAll;
  final ValueChanged<CatalogSearchKind> onRetry;

  @override
  Widget build(BuildContext context) {
    if (state.query.isEmpty) {
      return const AppEmptyState(message: '输入关键词搜索音乐');
    }
    if (state.view == SearchView.overview) return _overview(context);
    if (state.view == SearchView.tracks) {
      return _trackList(context, state.trackSection);
    }
    final section = state.view == SearchView.albums
        ? state.albumSection
        : state.playlistSection;
    return _collectionGrid(context, section);
  }

  Widget _overview(BuildContext context) => ListView(
    key: const Key('search-view-overview'),
    controller: scrollController,
    padding: const EdgeInsets.only(bottom: 28),
    children: [
      if (state.trackSection.items.isNotEmpty) ...[
        _BestMatch(track: state.trackSection.items.first, onPlay: onPlay),
      ],
      _sectionState(
        context,
        state.trackSection,
        CatalogSearchKind.track,
        Column(
          children: state.overviewTracks
              .map((track) => _trackRow(context, track))
              .toList(growable: false),
        ),
      ),
      if (state.providerStatuses.isNotEmpty) ...[
        const SizedBox(height: 24),
        _ProviderStatus(items: state.providerStatuses),
      ],
    ],
  );

  Widget _trackList(BuildContext context, SearchSection<Track> section) {
    if (section.phase == SearchPhase.loading && section.items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (section.phase == SearchPhase.empty) {
      return const AppEmptyState(message: '没有找到匹配单曲');
    }
    return ListView.builder(
      key: const Key('search-view-tracks'),
      controller: scrollController,
      itemCount:
          section.items.length +
          (section.phase == SearchPhase.loadingMore ||
                  section.phase == SearchPhase.failure
              ? 1
              : 0),
      itemBuilder: (context, index) {
        if (index < section.items.length) {
          return _trackRow(context, section.items[index]);
        }
        if (section.phase == SearchPhase.failure) {
          return TextButton.icon(
            key: const Key('search-section-tracks-retry'),
            onPressed: () => onRetry(CatalogSearchKind.track),
            icon: const Icon(LucideIcons.refreshCw, size: 16),
            label: const Text('加载失败，点击重试'),
          );
        }
        return const Padding(
          padding: EdgeInsets.all(20),
          child: Center(child: CircularProgressIndicator()),
        );
      },
    );
  }

  Widget _trackRow(BuildContext context, Track track) {
    final metadata = SearchTrackMetadata.fromTrack(track);
    final tokens = AppTokens.of(context);
    return InkWell(
      key: Key('search-track-${track.source}-${track.id}'),
      borderRadius: BorderRadius.circular(12),
      onTap: () => onPlay(track),
      child: Container(
        constraints: BoxConstraints(
          minHeight: MediaQuery.sizeOf(context).width <= 360 ? 56 : 60,
        ),
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: tokens.borderSoft)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    track.title.isEmpty ? track.id : track.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTypography.title.copyWith(
                      fontSize: 14,
                      height: 1.2,
                      letterSpacing: 0,
                    ),
                  ),
                  const SizedBox(height: 5),
                  _TrackMetadataLine(track: track, metadata: metadata),
                ],
              ),
            ),
            IconButton(
              key: Key('search-favorite-${track.source}-${track.id}'),
              tooltip: '收藏到歌单',
              onPressed: () => onFavorite(track),
              constraints: const BoxConstraints.tightFor(width: 44, height: 44),
              padding: const EdgeInsets.all(12),
              icon: Icon(LucideIcons.heartPlus, size: 20, color: tokens.muted),
            ),
            IconButton(
              key: Key('search-more-${track.source}-${track.id}'),
              tooltip: '更多操作',
              onPressed: () => onMore(track),
              constraints: const BoxConstraints.tightFor(width: 44, height: 44),
              padding: const EdgeInsets.all(12),
              icon: Icon(
                LucideIcons.ellipsisVertical,
                size: 20,
                color: tokens.muted,
              ),
            ),
          ],
        ),
      ),
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
    return GridView.builder(
      controller: scrollController,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
        childAspectRatio: .78,
      ),
      itemCount: section.items.length,
      itemBuilder: (_, index) => _CollectionCard(item: section.items[index]),
    );
  }

  Widget _sectionState<T>(
    BuildContext context,
    SearchSection<T> section,
    CatalogSearchKind kind,
    Widget content,
  ) {
    if (section.phase == SearchPhase.loading && section.items.isEmpty) {
      return const SizedBox(
        height: 96,
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (section.phase == SearchPhase.failure && section.items.isEmpty) {
      return AppButton(
        key: Key('search-section-${kind.name}s-retry'),
        variant: ShadButtonVariant.outline,
        onPressed: () => onRetry(kind),
        child: const Text('加载失败，重试'),
      );
    }
    if (section.items.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 18),
        child: Text('暂无匹配内容'),
      );
    }
    return content;
  }
}

final class _TrackMetadataLine extends StatelessWidget {
  const _TrackMetadataLine({required this.track, required this.metadata});
  final Track track;
  final SearchTrackMetadata metadata;

  @override
  Widget build(BuildContext context) {
    final tokens = AppTokens.of(context);
    final values = <Widget>[
      if (metadata.qualityLabel case final value?)
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
          decoration: BoxDecoration(
            border: Border.all(color: tokens.success, width: 1.2),
            borderRadius: BorderRadius.circular(5),
          ),
          child: Text(
            value,
            style: AppTypography.metadata.copyWith(
              color: tokens.success,
              fontSize: 9,
              height: 1,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      if (track.artist.isNotEmpty) Text(track.artist),
    ];
    return DefaultTextStyle(
      style: AppTypography.metadata.copyWith(
        color: tokens.muted,
        fontSize: 11,
        height: 1.2,
      ),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 7,
        runSpacing: 3,
        children: values,
      ),
    );
  }
}

final class _BestMatch extends StatelessWidget {
  const _BestMatch({required this.track, required this.onPlay});
  final Track track;
  final TrackCallback onPlay;

  @override
  Widget build(BuildContext context) => Container(
    key: const Key('search-best-match'),
    height: MediaQuery.sizeOf(context).width <= 360 ? 60 : 64,
    margin: EdgeInsets.only(
      top: MediaQuery.sizeOf(context).width <= 360 ? 8 : 10,
      bottom: 4,
    ),
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
    decoration: BoxDecoration(
      color: AppTokens.of(context).surfaceWarm.withValues(alpha: .55),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: AppTokens.of(context).borderSoft),
    ),
    child: Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '最佳匹配',
                style: AppTypography.metadata.copyWith(
                  color: AppTokens.of(context).accent,
                  fontSize: 10,
                ),
              ),
              const SizedBox(height: 4),
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: track.title,
                      style: AppTypography.title.copyWith(fontSize: 14),
                    ),
                    TextSpan(
                      text: '  ${track.artist}',
                      style: AppTypography.metadata.copyWith(fontSize: 11),
                    ),
                  ],
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
        IconButton.filled(
          tooltip: '播放',
          onPressed: () => onPlay(track),
          constraints: const BoxConstraints.tightFor(width: 44, height: 44),
          icon: const Icon(LucideIcons.play, size: 18),
        ),
      ],
    ),
  );
}

final class _CollectionCard extends StatelessWidget {
  const _CollectionCard({required this.item});
  final CatalogCollection item;

  @override
  Widget build(BuildContext context) => Container(
    key: Key('search-collection-${item.source}-${item.id}'),
    padding: const EdgeInsets.all(10),
    decoration: BoxDecoration(
      color: AppTokens.of(context).surface,
      borderRadius: BorderRadius.circular(AppRadii.compactCard),
      border: Border.all(color: AppTokens.of(context).borderSoft),
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
        const SizedBox(height: 8),
        Text(item.name, maxLines: 1, overflow: TextOverflow.ellipsis),
        if (item.author.isNotEmpty)
          Text(
            item.author,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTypography.metadata,
          ),
      ],
    ),
  );
}

final class _ProviderStatus extends StatelessWidget {
  const _ProviderStatus({required this.items});
  final List<ProviderSearchStatus> items;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: items
        .map(
          (item) => Chip(
            avatar: Icon(
              item.phase == ProviderSearchPhase.success
                  ? LucideIcons.circleCheck
                  : LucideIcons.circleAlert,
              size: 14,
            ),
            label: Text(
              item.phase == ProviderSearchPhase.success
                  ? '${item.provider.name} ${item.resultCount}'
                  : '${item.provider.name} 失败',
            ),
          ),
        )
        .toList(growable: false),
  );
}
