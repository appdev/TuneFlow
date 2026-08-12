import '../../api/models.dart';

typedef PlayTracks =
    Future<void> Function(List<Track> tracks, {int startIndex});
