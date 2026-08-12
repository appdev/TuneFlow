import '../api/models.dart';

final class EventCoordinator {
  EventCoordinator({
    required this.invalidatePlaylists,
    required this.invalidateDownloads,
    required this.invalidatePlaylistDetail,
  });

  final void Function() invalidatePlaylists;
  final void Function() invalidateDownloads;
  final void Function(String id) invalidatePlaylistDetail;
  int sequence = 0;

  bool accept(DomainEvent event) {
    if (event.sequence <= sequence) return false;
    sequence = event.sequence;
    if (event.type.startsWith('playlists.')) invalidatePlaylists();
    if (event.type.startsWith('downloads.')) invalidateDownloads();
    if (event.type.startsWith('playlist.')) {
      invalidatePlaylists();
      final data = event.data;
      if (data is Map && data['id'] is String) {
        invalidatePlaylistDetail(data['id']! as String);
      } else {
        invalidatePlaylists();
      }
    }
    return true;
  }

  void bootstrap(EventSnapshot snapshot) {
    final events = [...snapshot.events]
      ..sort((left, right) => left.sequence.compareTo(right.sequence));
    for (final event in events) {
      accept(event);
    }
    if (snapshot.sequence > sequence) sequence = snapshot.sequence;
  }
}
