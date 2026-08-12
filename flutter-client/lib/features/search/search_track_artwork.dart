import 'package:flutter/material.dart';

import '../../api/models.dart';
import '../../design/design_tokens.dart';
import 'search_track_metadata.dart';

final class SearchTrackArtwork extends StatefulWidget {
  const SearchTrackArtwork({
    super.key,
    required this.track,
    required this.loadPicture,
    this.size = 44,
    this.borderRadius = 10,
  });

  final Track track;
  final Future<Uri?> Function(Track) loadPicture;
  final double size;
  final double borderRadius;

  @override
  State<SearchTrackArtwork> createState() => _SearchTrackArtworkState();
}

final class _SearchTrackArtworkState extends State<SearchTrackArtwork> {
  late Future<Uri?> picture;

  @override
  void initState() {
    super.initState();
    final response = _responsePicture(widget.track);
    picture = response == null
        ? widget.loadPicture(widget.track)
        : Future.value(response);
  }

  @override
  void didUpdateWidget(covariant SearchTrackArtwork oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.track.id != widget.track.id ||
        oldWidget.track.source != widget.track.source) {
      final response = _responsePicture(widget.track);
      picture = response == null
          ? widget.loadPicture(widget.track)
          : Future.value(response);
    }
  }

  @override
  Widget build(BuildContext context) => ClipRRect(
    key: Key('search-artwork-frame-${widget.track.source}-${widget.track.id}'),
    borderRadius: BorderRadius.circular(widget.borderRadius),
    child: SizedBox.square(
      dimension: widget.size,
      child: FutureBuilder<Uri?>(
        future: picture,
        builder: (context, snapshot) => _ArtworkImage(
          uri: snapshot.data,
          track: widget.track,
          size: widget.size,
          borderRadius: widget.borderRadius,
        ),
      ),
    ),
  );
}

final class _ArtworkImage extends StatefulWidget {
  const _ArtworkImage({
    required this.uri,
    required this.track,
    required this.size,
    required this.borderRadius,
  });
  final Uri? uri;
  final Track track;
  final double size;
  final double borderRadius;

  @override
  State<_ArtworkImage> createState() => _ArtworkImageState();
}

final class _ArtworkImageState extends State<_ArtworkImage> {
  var failed = false;

  @override
  void didUpdateWidget(covariant _ArtworkImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.uri != widget.uri) failed = false;
  }

  @override
  Widget build(BuildContext context) {
    final tokens = AppTokens.of(context);
    final fallback = Container(
      key: Key(
        'search-artwork-fallback-${widget.track.source}-${widget.track.id}',
      ),
      width: widget.size,
      height: widget.size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: tokens.surfaceWarm.withValues(alpha: .55),
        border: Border.all(color: tokens.borderSoft),
      ),
      child: Text(
        trackInitial(widget.track),
        style: AppTypography.title.copyWith(color: tokens.muted),
      ),
    );
    if (widget.uri == null || failed) return fallback;
    return Image.network(
      widget.uri.toString(),
      key: Key('search-artwork-${widget.track.source}-${widget.track.id}'),
      width: widget.size,
      height: widget.size,
      fit: BoxFit.cover,
      errorBuilder: (_, _, _) {
        if (!failed) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) setState(() => failed = true);
          });
        }
        return fallback;
      },
    );
  }
}

Uri? _responsePicture(Track track) {
  final value = track.raw['pic'];
  if (value is! String) return null;
  final uri = Uri.tryParse(value);
  return uri != null && (uri.scheme == 'http' || uri.scheme == 'https')
      ? uri
      : null;
}
