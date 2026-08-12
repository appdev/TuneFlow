import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../api/models.dart';
import '../../design/app_breakpoints.dart';
import '../../design/components/app_button.dart';
import '../../design/components/app_feedback.dart';
import '../../design/components/artwork.dart';
import '../../design/components/playlist_card.dart';
import '../../design/design_tokens.dart';
import '../search/search_repository.dart';

enum DiscoveryKind { playlists, charts }

final class DiscoveryScreen extends StatefulWidget {
  const DiscoveryScreen({
    super.key,
    required this.repository,
    required this.kind,
    required this.onSearch,
    this.playTracks,
  });

  final SearchRepository repository;
  final DiscoveryKind kind;
  final VoidCallback onSearch;
  final Future<void> Function(List<Track> tracks)? playTracks;

  @override
  State<DiscoveryScreen> createState() => _DiscoveryScreenState();
}

final class _DiscoveryScreenState extends State<DiscoveryScreen> {
  late Future<CatalogCapabilities> capabilities = widget.repository
      .capabilities();
  String? selectedProvider;

  void retry() =>
      setState(() => capabilities = widget.repository.capabilities());

  @override
  Widget build(BuildContext context) {
    final mobile =
        classifyLayout(MediaQuery.sizeOf(context).width) ==
        AppLayoutClass.mobile;
    final charts = widget.kind == DiscoveryKind.charts;
    return ColoredBox(
      key: Key(charts ? 'charts-layout' : 'playlist-square-layout'),
      color: AppTokens.of(context).background,
      child: FutureBuilder<CatalogCapabilities>(
        future: capabilities,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return ListView(
              padding: EdgeInsets.all(mobile ? 18 : 34),
              children: [
                AppNotice.error(
                  title: '无法读取平台能力',
                  message: snapshot.error.toString(),
                ),
                const SizedBox(height: 12),
                AppButton(
                  variant: ShadButtonVariant.outline,
                  onPressed: retry,
                  child: const Text('重试'),
                ),
              ],
            );
          }
          final providers = snapshot.data!.providers
              .where(
                (provider) => charts
                    ? provider.leaderboards
                    : provider.searchKinds.contains(CatalogSearchKind.playlist),
              )
              .toList(growable: false);
          if (providers.isEmpty) return const _Unavailable();
          selectedProvider ??= providers.first.id;
          return ListView(
            padding: EdgeInsets.fromLTRB(
              mobile ? 16 : 38,
              mobile ? 20 : 34,
              mobile ? 16 : 38,
              48,
            ),
            children: [
              _PageHeader(charts: charts, mobile: mobile),
              const SizedBox(height: 18),
              _ProviderChips(
                providers: providers,
                selected: selectedProvider!,
                onSelected: (value) => setState(() => selectedProvider = value),
              ),
              SizedBox(height: mobile ? 16 : 28),
              if (charts)
                _LeaderboardView(
                  key: ValueKey(selectedProvider),
                  repository: widget.repository,
                  source: selectedProvider!,
                  mobile: mobile,
                  playTracks: widget.playTracks,
                )
              else ...[
                if (!mobile)
                  Row(
                    children: [
                      const Expanded(
                        child: Text('为你推荐', style: AppTypography.section),
                      ),
                      Text(
                        '第 1 / 18 页',
                        style: AppTypography.metadata.copyWith(
                          color: AppTokens.of(context).muted,
                        ),
                      ),
                    ],
                  ),
                if (!mobile) const SizedBox(height: 14),
                _DiscoveryGallery(
                  repository: widget.repository,
                  source: selectedProvider!,
                  mobile: mobile,
                  onOpen: widget.onSearch,
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

final class _PageHeader extends StatelessWidget {
  const _PageHeader({required this.charts, required this.mobile});
  final bool charts;
  final bool mobile;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        charts ? '每天更新' : '动态平台 · Service API',
        style: AppTypography.metadata.copyWith(
          color: AppTokens.of(context).muted,
        ),
      ),
      const SizedBox(height: 4),
      Text(
        charts ? '排行榜' : '歌单广场',
        style: mobile
            ? AppTypography.display.copyWith(fontSize: 31)
            : AppTypography.display,
      ),
    ],
  );
}

final class _ProviderChips extends StatelessWidget {
  const _ProviderChips({
    required this.providers,
    required this.selected,
    required this.onSelected,
  });
  final List<CatalogProvider> providers;
  final String selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    child: Row(
      children: [
        for (final provider in providers) ...[
          AppButton(
            variant: selected == provider.id
                ? ShadButtonVariant.primary
                : ShadButtonVariant.outline,
            onPressed: () => onSelected(provider.id),
            child: Text(provider.name.replaceAll('音乐', '')),
          ),
          const SizedBox(width: 8),
        ],
      ],
    ),
  );
}

final class _DiscoveryGallery extends StatefulWidget {
  const _DiscoveryGallery({
    required this.repository,
    required this.source,
    required this.mobile,
    required this.onOpen,
  });
  final SearchRepository repository;
  final String source;
  final bool mobile;
  final VoidCallback onOpen;

  @override
  State<_DiscoveryGallery> createState() => _DiscoveryGalleryState();
}

final class _DiscoveryGalleryState extends State<_DiscoveryGallery> {
  late final Future<CollectionSearchPage> page = widget.repository
      .searchCollections(
        kind: CatalogSearchKind.playlist,
        source: widget.source,
        text: '热门',
        page: 1,
        pageSize: 24,
      );

  @override
  Widget build(BuildContext context) => FutureBuilder<CollectionSearchPage>(
    future: page,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) {
        return const Center(child: CircularProgressIndicator());
      }
      if (snapshot.hasError) {
        return AppNotice.error(
          title: '歌单加载失败',
          message: snapshot.error.toString(),
        );
      }
      final playlists = snapshot.data!.items;
      if (playlists.isEmpty) return const Text('当前音源没有返回推荐歌单');
      return LayoutBuilder(
        builder: (context, constraints) {
          final columns = widget.mobile
              ? 2
              : (MediaQuery.sizeOf(context).width > 1180 ? 4 : 3);
          final gap = widget.mobile ? 14.0 : 16.0;
          final width = (constraints.maxWidth - gap * (columns - 1)) / columns;
          return Wrap(
            spacing: gap,
            runSpacing: gap,
            children: [
              for (final collection in playlists)
                SizedBox(
                  width: width,
                  child: PlaylistCard(
                    playlist: PlaylistSummary(
                      id: collection.id,
                      name: collection.name,
                      source: [
                        if (collection.author.isNotEmpty) collection.author,
                        if (collection.total != null) '${collection.total} 首',
                      ].join(' · '),
                    ),
                    imageUrl: collection.imageUrl,
                    onPressed: widget.onOpen,
                    variant: PlaylistCardVariant.gallery,
                  ),
                ),
            ],
          );
        },
      );
    },
  );
}

final class _LeaderboardView extends StatefulWidget {
  const _LeaderboardView({
    super.key,
    required this.repository,
    required this.source,
    required this.mobile,
    this.playTracks,
  });
  final SearchRepository repository;
  final String source;
  final bool mobile;
  final Future<void> Function(List<Track> tracks)? playTracks;

  @override
  State<_LeaderboardView> createState() => _LeaderboardViewState();
}

final class _LeaderboardViewState extends State<_LeaderboardView> {
  late final Future<LeaderboardPage> boards = widget.repository.leaderboards(
    source: widget.source,
  );
  Leaderboard? selected;

  Future<LeaderboardTrackPage> tracks(Leaderboard board) =>
      widget.repository.leaderboardTracks(
        source: widget.source,
        boardId: board.providerId,
        page: 1,
      );

  @override
  Widget build(BuildContext context) => FutureBuilder<LeaderboardPage>(
    future: boards,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) {
        return const Center(child: CircularProgressIndicator());
      }
      if (snapshot.hasError) {
        return AppNotice.error(
          title: '排行榜加载失败',
          message: snapshot.error.toString(),
        );
      }
      if (snapshot.data!.items.isEmpty) return const Text('当前音源没有返回排行榜');
      selected ??= snapshot.data!.items.first;
      return _buildContent(context, snapshot.data!.items, selected!);
    },
  );

  Widget _buildContent(
    BuildContext context,
    List<Leaderboard> boards,
    Leaderboard active,
  ) {
    final charts = Column(
      children: [
        for (final board in boards.take(12))
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: AppButton(
              variant: board.id == active.id
                  ? ShadButtonVariant.secondary
                  : ShadButtonVariant.outline,
              onPressed: () => setState(() => selected = board),
              child: SizedBox(
                width: widget.mobile
                    ? MediaQuery.sizeOf(context).width - 80
                    : 190,
                child: Row(
                  children: [
                    if (!widget.mobile) ...[
                      const Icon(
                        LucideIcons.chartNoAxesColumnIncreasing,
                        size: 18,
                      ),
                      const SizedBox(width: 12),
                    ],
                    Expanded(
                      child: Text(board.name, overflow: TextOverflow.ellipsis),
                    ),
                    Text(board.id == active.id && widget.mobile ? '当前' : '›'),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
    final trackList = FutureBuilder<LeaderboardTrackPage>(
      key: ValueKey(active.id),
      future: tracks(active),
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return AppNotice.error(
            title: '榜单歌曲加载失败',
            message: snapshot.error.toString(),
          );
        }
        final items = snapshot.data!.tracks;
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(active.name, style: AppTypography.section),
                        Text(
                          '${items.length} 首 · ${widget.source}',
                          style: AppTypography.metadata,
                        ),
                      ],
                    ),
                  ),
                  if (items.isNotEmpty && widget.playTracks != null)
                    AppButton(
                      onPressed: () => widget.playTracks!(items),
                      child: const Text('播放全部'),
                    ),
                ],
              ),
            ),
            for (final track in items)
              InkWell(
                onTap: widget.playTracks == null
                    ? null
                    : () => widget.playTracks!([track]),
                child: Container(
                  height: widget.mobile ? 62 : 58,
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(color: AppTokens.of(context).border),
                    ),
                  ),
                  child: Row(
                    children: [
                      AppArtwork(
                        imageUrl: track.raw['pic'] is String
                            ? track.raw['pic']! as String
                            : null,
                        seed: track.id,
                        semanticLabel: '${track.title}封面',
                        size: widget.mobile ? 42 : 38,
                        borderRadius: 9,
                        showFallback: false,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(track.title, style: AppTypography.title),
                            Text(
                              track.artist,
                              style: AppTypography.metadata.copyWith(
                                color: AppTokens.of(
                                  context,
                                ).foregroundSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const Icon(LucideIcons.ellipsis, size: 18),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
    if (widget.mobile) {
      return Column(children: [charts, const SizedBox(height: 8), trackList]);
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 280,
          child: Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: AppTokens.of(context).surface,
              border: Border.all(color: AppTokens.of(context).border),
              borderRadius: BorderRadius.circular(AppRadii.card),
            ),
            child: charts,
          ),
        ),
        const SizedBox(width: 18),
        Expanded(child: trackList),
      ],
    );
  }
}

final class _Unavailable extends StatelessWidget {
  const _Unavailable();

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(LucideIcons.circleOff, color: AppTokens.of(context).muted),
          const SizedBox(height: 12),
          const Text('当前音源未提供歌单能力', style: AppTypography.section),
          const SizedBox(height: 6),
          const Text('切换音源后可再次检查。'),
        ],
      ),
    ),
  );
}
