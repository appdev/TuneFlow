# Flutter UI API matrix

This document is the implementation contract for the accepted Open Design client UI.

| UI capability | Service contract | Client responsibility |
| --- | --- | --- |
| Connection, API version, latency | `GET /api/v1/health`, `GET /api/v1/capabilities` | Measure request latency and retain the last successful snapshot. |
| Catalog providers and search tabs | `GET /api/v1/catalog/capabilities` | Show only search kinds advertised by the selected provider. |
| Track, playlist, and album search | `POST /api/v1/catalog/{tracks,playlists,albums}/search` | Keep independent pagination per kind; surface capability and source errors. |
| Artwork and synchronized lyrics | Track picture and lyrics routes | Parse LRC timestamps locally and align translated lines by timestamp. |
| Playlists | Playlist CRUD and track mutation routes | Compose bulk UI actions and keep optimistic state reversible. |
| Playback | Resolve and opaque stream routes | Own queue, seek, repeat/shuffle state, and quality selection. |
| Downloads | Download list and per-task mutation routes plus SSE | Derive transfer speed from byte deltas; use `queuePosition` and timestamps for stable presentation. |
| Local library | Library list, scan, and stream routes | Sum `size` for totals and copy selected media into the Flutter cache while Service is reachable. |
| Offline playback | No live Service call | Play only media already stored in the Flutter cache; cached metadata alone is not playable. |
| Recent playback | Versioned `client-data` key `flutter.playback-history.v1` | Persist a bounded list containing track identity, last position, and last-played timestamp. |
| Theme, language, lyric preferences | Flutter-local preferences | No Service dependency. |

The Service does not provide compatibility aliases for superseded contracts. Any intentional breaking API change must pass the Service contract tests and the existing Web client build/test gates before it is accepted.
