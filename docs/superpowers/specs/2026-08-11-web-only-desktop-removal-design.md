# Web-only renderer and Electron removal design

## Outcome

Convert this repository from a shared Electron/Web renderer into a Web-only UI
served by the LX Music Service. The existing Electron application is no longer a
supported build or runtime target; a future Flutter client will consume Service
APIs independently.

The Web UI must expose only operations that make sense for a browser controlling
server-owned data. Desktop file dialogs, desktop window lifecycle controls, and
desktop packaging are removed rather than hidden behind runtime capability flags.

## Product boundary

### Remove from the Web product

- Adding local music through a browser-machine file chooser.
- Playlist import/export through local files.
- File-based backup and restore.
- Opening or locating downloaded files in Finder/Explorer.
- Changing or browsing the download directory.
- Electron window size, start-fullscreen, minimize, maximize, close, tray, and
  desktop-window presentation settings.
- Desktop lyric, desktop synchronization, desktop Open API, and desktop software
  update entries that currently render only as unavailable settings.
- Electron-only local custom-source import. Network source import remains.

The play-detail overlay keeps its normal in-page back/hide action. Only operating
system window controls are removed.

### Keep in the Web product

- Network custom-source import and Service-side source execution.
- Service-side downloads, pause/resume/remove, and download history.
- Service-owned local library scanning and same-origin playback.
- Built-in themes, browser-local interaction settings, clipboard support, and
  external HTTP links.
- Server-side list management that does not depend on importing/exporting files.

## Storage contract

The effective download root is always:

```text
${LX_STORAGE_ROOT}/audio
```

For the Docker image this resolves to `/data/audio`.

The path is a deployment concern, not a user preference:

- the Web settings page contains no path control;
- `PATCH /api/v1/settings` rejects `download.savePath`;
- legacy persisted values are ignored when settings are read;
- the download manager and library scanner receive the canonical Service-owned
  audio root;
- list-name grouping may create sanitized subdirectories below that root only.

## Repository architecture

### Canonical runtime

- `src/server`: Service APIs, persistence, source workers, downloads, and library.
- `src/renderer`: Web UI. Remaining IPC-shaped adapters are migrated toward typed
  Web/Service calls and may not expose desktop file/window operations.
- `src/web-runtime`: browser bootstrap and compatibility adapters still required
  by the upstream renderer.
- `src/common`: runtime-neutral types, media transforms, and shared utilities.

### Electron removal

Delete Electron entrypoints, lyric windows, renderer scripts, desktop build and
packaging configuration, publish scripts, binary artifacts, and Electron-only
dependencies.

Some Service code currently imports SQLite/list modules from `src/main` and a
lyrics helper from `src/renderer/worker`. Before deleting those trees:

1. move the SQLite/list persistence implementation into a Service-owned module;
2. move the lyrics formatting helper into a runtime-neutral or Service-owned
   module;
3. update Service tests and imports;
4. prove the Service build and persistence behavior still pass;
5. then delete the now-unreferenced Electron trees.

The package entrypoint and scripts become Service/Web-only. `postinstall` must no
longer run Electron rebuilds. Service native dependencies are built for the host
Node runtime directly, including inside the Docker builder stage.

## UI changes

Menus are constructed without desktop-only actions; they are not rendered as
disabled or hidden DOM nodes:

- My Lists: remove add-local-file, import, and export actions.
- Downloads: remove locate-file action.
- Settings: remove download-path section and all desktop-only tabs/sections.
- Custom source management: retain network import only.

Obsolete components and action modules are deleted when no supported consumer
remains. Runtime guards are retained only for genuine Web/Service feature
availability, not to preserve Electron behavior.

## Error handling and compatibility

- A direct attempt to patch `download.savePath` returns a stable 400 error and
  leaves all other settings unchanged.
- Existing databases with a custom path continue to start, but the value is
  projected as the canonical Service audio root and is no longer written back as
  a user-controlled preference.
- Removal of desktop actions must not remove existing lists, downloads, or audio
  files.
- No migration deletes files outside the canonical Service storage root.

## Verification

Implementation follows focused red-green tests:

1. Settings API rejects download-path mutation and always reports the canonical
   Service audio root.
2. Download manager and library scanner use that root after restart even when the
   database contains a legacy custom value.
3. Web UI tests prove desktop-only settings and menu actions are absent while
   network source import, download actions, and local-library playback remain.
4. Dependency scans prove no production source or package script imports
   Electron, Electron builders, Electron updater, or deleted desktop entrypoints.
5. `npm run lint`, focused tests, the full relevant Vitest suite,
   `npm run build:service`, and production browser smoke pass.
6. The local Service is restarted from the new artifact and the Web UI is checked
   at desktop and narrow viewports.

Electron builds are deliberately removed from the acceptance gate because they
are no longer a supported product.

## Delivery sequence

1. Lock the Service storage contract.
2. Remove desktop-only Web UI operations.
3. relocate Service dependencies that still live under Electron-owned trees.
4. remove Electron source, packaging, scripts, and dependencies.
5. run frozen Web/Service verification and local browser acceptance.

Each step remains buildable before the next destructive deletion. The existing
dirty worktree is preserved; only files proven to belong to the retired Electron
surface are removed.
