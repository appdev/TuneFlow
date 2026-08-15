# Hosted Web Leaderboards and Source Management Design

## Goal

Make the hosted Web client load leaderboards through the Service and provide
complete management of the ordered enabled custom-source chain. The change must
preserve the existing Service fallback behavior, local-resource priority,
desktop behavior, and compatibility with the legacy single-source setting.

## Current Problems

The hosted Web leaderboard store invokes provider SDK implementations directly
in the browser. Those implementations depend on provider endpoints that may be
blocked by browser cross-origin policy and, for some providers, Node.js crypto.
The same calls already succeed through the Service catalog routes.

The Service persists an ordered enabled source chain and exposes it through
`GET /api/v1/sources` and `PUT /api/v1/sources/enabled`, but the hosted Web UI
only exposes the legacy single `common.apiSource` selector and
`PUT /api/v1/sources/active`. The custom-source modal has no enabled controls or
ordering UI.

## Scope

This change includes:

- Hosted Web leaderboard catalog and track loading through the Service.
- Hosted Web enable/disable and drag ordering for installed custom-source
  scripts.
- Synchronization of the first enabled custom source with the legacy current
  source display.
- Unit, build, and browser regression coverage for the changed Web behavior.

This change does not alter the Service source-selection schema, fallback
algorithm, playback bundle scoring, download behavior, local-first resource
resolution, Flutter client, or desktop renderer transport.

## Architecture

### Leaderboard transport

The existing renderer leaderboard store remains the consumer-facing boundary.
In the hosted Web runtime, built-in provider leaderboard methods are overridden
in the same way as provider search:

- `getBoards()` invokes `WIN_MAIN_RENDERER_EVENT_NAME.handle_request` with a
  `provider-leaderboards` request.
- `getList(boardId, page)` invokes the same IPC with a
  `provider-leaderboard-tracks` request.
- The Web runtime validates these typed request variants and maps them to
  `POST /api/v1/catalog/leaderboards` and
  `POST /api/v1/catalog/leaderboards/tracks`.

The adapter converts the Service leaderboard item fields back to the renderer's
existing `{ id, bangid, name }` shape. Track-page results already match the
renderer search-result shape. Desktop builds keep the provider SDK methods and
therefore retain existing behavior.

This boundary also covers full-list loading, playlist import, and playback from
a leaderboard because those paths already consume the shared leaderboard store
methods.

### Source-chain transport and state

Extend the public renderer `UserApiInfo` model with the Service-owned fields:

- `active: boolean`
- `enabled: boolean`
- `priority: number | null`

Add one renderer IPC operation for configuring the ordered enabled IDs. The
hosted Web runtime maps it to `PUT /api/v1/sources/enabled` and returns the full
source snapshot. Desktop transport may report the operation as unsupported;
the new management controls are shown only when the hosted Web runtime supports
them.

The modal derives two lists from the source snapshot:

- Enabled sources, sorted by ascending `priority` and draggable.
- Disabled sources, preserving the installed-source list order and not
  participating in priority.

Toggling or reordering builds the complete ordered enabled ID array and submits
it as one request. The returned Service snapshot replaces `userApi.list`, so the
UI never treats its optimistic ordering as authoritative.

An empty enabled list is allowed, matching the Service API. Local files and
built-in provider behavior remain available; only installed custom scripts are
removed from the fallback chain.

### Legacy current-source compatibility

The first enabled source is priority zero and remains the source shown as the
legacy current custom source. After a successful configuration, the Web client
persists that ID to `common.apiSource` when it differs. The existing
`/sources/active` compatibility path may promote that same source again, which
is idempotent and does not disable backups.

If no custom source is enabled, the Web client selects the first available
built-in provider for the legacy setting. The source-chain snapshot remains the
authority for fallback order; `common.apiSource` is only a compatibility and
display value.

## User Interface

The custom-source management modal contains two labeled sections.

Each installed source row includes:

- Its existing name, version, author, description, update-alert option, and
  remove action.
- An enabled switch.
- A drag handle when enabled.
- Its one-based priority when enabled.

Only enabled rows can be reordered. Disabling a source removes it from the
enabled array. Enabling a source appends it to the end of the chain. Dragging
changes only enabled-source order. The UI disables additional chain mutations
while a save is in flight to prevent overlapping snapshots.

## Error Handling

- Leaderboard Service errors use the existing Web runtime error normalization
  and existing leaderboard load-failed state.
- A source-chain request failure restores the last Service-confirmed snapshot
  and shows a localized error dialog.
- A source that fails Service initialization is not partially enabled because
  `configureEnabled` is atomic.
- Import and removal replace the list from the returned Service snapshot and
  then re-derive enabled and disabled groups.
- Removal of the priority-zero source relies on the Service's compacted
  selection and then synchronizes the new first source to the legacy setting.

## Verification

### Automated

- Web runtime tests verify both leaderboard request variants, request
  validation, endpoint payloads, and source-chain configuration mapping.
- Renderer adapter/store tests verify leaderboard shape conversion, pagination,
  caching, and all-page loading through the Web transport.
- Source-management tests verify grouping, enabling appends, disabling removes,
  drag reorder, in-flight locking, Service-confirmed snapshot replacement, and
  rollback/error display.
- Existing Service catalog and source-chain tests continue to pass.
- Run focused lint/type-compatible checks and the production Web build.

### Runtime

Against the rebuilt Docker deployment:

- Open TX, KW, and WY leaderboards and verify tracks load without browser crypto
  or cross-origin errors.
- Start a ranking track and verify the queue advances to the next track.
- Enable at least three installed sources, reorder them, reload the page, and
  verify order persistence.
- Disable and re-enable a source and verify it returns at the end of the chain.
- Confirm local audio, local lyrics, and local artwork remain preferred when
  present.

## Compatibility and Risk

The highest compatibility risk is the coexistence of the legacy single-source
setting with the ordered chain. Treating the Service snapshot as authoritative
and synchronizing priority zero back to the setting prevents reloads from
silently changing the order. The leaderboard adapter is Web-only, so desktop
provider behavior is isolated from the transport change.
