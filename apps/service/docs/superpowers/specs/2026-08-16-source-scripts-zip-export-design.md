# Source Scripts ZIP Export Design

## Goal

Allow a user to download every currently installed user-source script as one
ZIP archive from the source-management dialog. The export is a file-only copy:
it does not preserve import URLs, enabled state, priority, or other manifest
metadata.

## Scope

The export includes all sources registered in `web_sources`, whether enabled or
disabled. Each source contributes its complete installed JavaScript file. The
archive contains only `.js` entries at its root.

The feature does not:

- reconstruct or export the original network import URL;
- include `manifest.json`, database records, source ordering, or enabled state;
- add bulk import or restore behavior;
- export orphaned, temporary, or otherwise unregistered files from the storage
  directory;
- change the existing single-script import behavior.

## User Experience

The existing commented-out Export control in the source-management dialog is
enabled for the hosted Web runtime. It is disabled when there are no installed
sources or while another source-management mutation is being saved.

Clicking Export starts a browser download named
`tuneflow-sources-YYYYMMDD-HHmmss.zip`. A successful archive contains one file
for every source shown in the dialog, including disabled sources. No extra
confirmation is required because exporting is read-only.

If the request fails before a download begins, the dialog shows a localized
error. If a stream fails after transfer begins, the response is aborted and the
ZIP lacks a valid central directory, so it cannot masquerade as a complete
archive.

## Architecture

### Repository export inventory

`SourceRepository` exposes a narrow, read-only export inventory derived from
the database rather than allowing the route to enumerate the `sources/`
directory. Each entry contains the source ID, display metadata needed for the
entry name, and its resolved script path.

The repository resolves every path using the same canonical `sourceDir` and
hash-derived filename rule used by `getSource`. Callers never choose a host
path, and server filesystem paths are never returned to the client.

### Export service

`SourcesService` prepares the archive input. Before response headers are sent,
it verifies that every registered script exists, is a regular readable file,
and remains within the source directory. An empty inventory is rejected with a
typed `SOURCE_EXPORT_EMPTY` error. A missing or unreadable script is rejected
with a sanitized `SOURCE_EXPORT_FAILED` error that does not disclose host
paths.

Archive entries receive user-friendly safe names based on source name and
version. The name is normalized, path separators, control characters, and
portable-filesystem-invalid characters are replaced, trailing dots/spaces are
removed, and the base name is bounded in length. An empty result falls back to
`source`. Collisions append the first eight characters of the source's SHA-256
ID. Every resulting entry is unique, ends in `.js`, and is placed at the ZIP
root.

### HTTP route

Add `GET /api/v1/sources/export`. The route asks the service for the validated
inventory, then uses a maintained streaming ZIP library to append the files in
the repository's stable installation order. The response sets:

- `Content-Type: application/zip`;
- `Content-Disposition: attachment` with the generated archive filename;
- `Cache-Control: no-store`.

The archive is streamed rather than accumulated in memory. Archive errors
destroy the stream and are logged without exposing source contents or server
paths in an API error body. The new ZIP library is a production dependency and
its TypeScript declarations are added only if the package does not provide
them.

### Web runtime and renderer

The renderer uses a small hosted-Web download helper that requests the export
endpoint and starts the browser download using the filename supplied by
`Content-Disposition`. This keeps the service response and error handling
observable instead of navigating the current page to the binary endpoint.

The Export button is shown only where the Service-backed endpoint exists. The
separate Electron-owned source implementation remains unchanged.

## Data Flow

1. The user clicks Export in source management.
2. The Web renderer requests `GET /api/v1/sources/export`.
3. The repository selects all registered sources in stable installation order.
4. The service validates all script paths and assigns unique safe ZIP names.
5. The route streams each JavaScript file into the ZIP response.
6. The browser saves the returned archive using the response filename.

## Error Handling and Security

- Zero installed sources returns a typed client-visible error; the normal UI
  prevents this request by disabling the button.
- Any missing, non-file, out-of-root, or unreadable source script fails the
  whole export. Partial success is not reported as success.
- ZIP entry names cannot contain traversal components or absolute paths.
- Only registered source scripts are exported; temporary and orphaned files are
  excluded.
- API errors contain stable codes and generic messages, not host paths or script
  contents.
- Exported scripts may themselves contain secrets. The localized UI text warns
  that the ZIP should be handled as sensitive data.
- The endpoint follows the Service's existing access boundary. This feature
  does not add authentication or broaden network exposure.

## Verification

Repository and service tests cover:

- all registered enabled and disabled scripts are included;
- orphaned and temporary source-directory files are excluded;
- stable entry ordering;
- safe naming for separators, control characters, long names, empty names, and
  duplicate names;
- missing, unreadable, and out-of-root files fail without leaking paths;
- an empty source set returns `SOURCE_EXPORT_EMPTY`.

Route tests inspect the generated ZIP and verify:

- status and download headers;
- one byte-identical `.js` entry per registered source;
- no manifest or nested path entries;
- a failing preflight does not return a successful ZIP response;
- the OpenAPI document includes the export endpoint and binary response.

Renderer/Web-runtime tests verify:

- the Export button is enabled only when appropriate;
- clicking it requests the export endpoint once and starts one ZIP download;
- request failures show the localized error and reset the busy state;
- the Electron path does not call the hosted-Web endpoint.

Finally, run focused source, route/OpenAPI, Web-runtime, and source-management UI
tests, followed by targeted lint and the server/Web builds because the change
adds a production dependency and crosses both runtime bundles.

## Success Criteria

- One click downloads one ZIP containing every and only currently installed
  source JavaScript file.
- Extracted scripts are byte-identical to their persisted installed copies and
  can be imported individually through the existing local-import flow.
- The archive contains no URL or state manifest.
- Server-side archive generation remains bounded in memory and does not
  disclose server filesystem details.
