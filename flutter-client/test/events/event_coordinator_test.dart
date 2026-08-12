import 'package:flutter_test/flutter_test.dart';
import 'package:musicfree_service_client/api/models.dart';
import 'package:musicfree_service_client/events/event_coordinator.dart';

void main() {
  test('rejects stale sequence and targets resource invalidation', () {
    var playlists = 0;
    var downloads = 0;
    final details = <String>[];
    final coordinator = EventCoordinator(
      invalidatePlaylists: () => playlists++,
      invalidateDownloads: () => downloads++,
      invalidatePlaylistDetail: details.add,
    );

    coordinator.accept(
      const DomainEvent(type: 'playlists.updated', data: null, sequence: 4),
    );
    coordinator.accept(
      const DomainEvent(type: 'downloads.updated', data: null, sequence: 3),
    );
    coordinator.accept(
      const DomainEvent(
        type: 'playlist.updated',
        data: {'id': 'one'},
        sequence: 5,
      ),
    );

    expect(playlists, 2);
    expect(downloads, 0);
    expect(details, ['one']);
    expect(coordinator.sequence, 5);
  });

  test('snapshot bootstrapping accepts only increasing events', () {
    var downloads = 0;
    final coordinator = EventCoordinator(
      invalidatePlaylists: () {},
      invalidateDownloads: () => downloads++,
      invalidatePlaylistDetail: (_) {},
    );

    coordinator.bootstrap(
      const EventSnapshot(
        sequence: 9,
        events: [
          DomainEvent(type: 'downloads.updated', data: null, sequence: 8),
          DomainEvent(type: 'downloads.updated', data: null, sequence: 8),
        ],
      ),
    );

    expect(downloads, 1);
    expect(coordinator.sequence, 9);
  });
}
