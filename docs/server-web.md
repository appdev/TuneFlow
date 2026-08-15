# TuneFlow · 音流 Server + Web

TuneFlow serves its Vue renderer in a browser while a single Node.js Service
owns settings, lists, sources, downloads, the local library, SQLite, and media
files. It is an early single-user iteration, not a public multi-user service.

This repository no longer builds or packages an Electron application. Future
native clients are expected to consume the same Service APIs instead of owning
storage or desktop-only IPC.

## Local build and start

Install Node.js 22 or newer, then run:

```sh
npm ci
npm run build:service
npm run start:server
```

Open <http://127.0.0.1:3124>. Stop the foreground Service with `Ctrl+C`.
`npm run build:service` prepares both `dist/web` and the self-contained
`dist/server` runtime, including the Node ABI build of `better-sqlite3`.

Configuration is supplied with environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TUNEFLOW_HOST` | `127.0.0.1` | HTTP listen address |
| `TUNEFLOW_PORT` | `3124` | HTTP listen port |
| `TUNEFLOW_STORAGE_ROOT` | `./data` | Service-owned durable data root |
| `TUNEFLOW_WEB_ROOT` | `./dist/web` | Prepared browser assets |
| `TUNEFLOW_SERVICE_NODE_MODULES` | `./dist/server/node_modules` when prepared | Service native/runtime dependencies |

The loopback default is intentional. To opt in on a trusted LAN, bind
`TUNEFLOW_HOST=0.0.0.0` and control access with the host firewall or reverse proxy.
There is no authentication, tenant separation, or public-network hardening;
do not expose this iteration directly to the Internet.

## Storage, backup, and restore

The storage root contains:

- `tuneflow.data.db`, plus `tuneflow.data.db-wal` and `tuneflow.data.db-shm` while SQLite is live;
- `audio/` for downloaded and scanned audio;
- `sources/`, `tmp/`, `logs/`, and `backups/` for Service-owned support data.

The media path is fixed at `${TUNEFLOW_STORAGE_ROOT}/audio` (and `/data/audio` in the
Docker image). It cannot be selected or changed through the Web UI or Service
API; attempts to patch `download.savePath` are rejected with
`IMMUTABLE_SETTING`.

Back up the complete storage root, not only the database. Stop the Service
first (or use SQLite's consistent backup facility), archive the directory, and
restore it at the same path while the Service is stopped. Restoring only
`tuneflow.data.db` can leave lists/download records inconsistent with media files.

## Docker

The image uses Node 24 slim, compiles the Linux `better-sqlite3` binding in the
builder, copies the prepared production artifact, runs as the image's non-root
`node` user, and stores all durable data in `/data`. It does not install FFmpeg.

```sh
docker compose build
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:3124/api/v1/health
docker compose logs -f tuneflow-web
docker compose down
```

The default named volume is `tuneflow-data` (Compose prefixes it with the
project name). `docker compose down` preserves it; do not add `-v` unless the
data is intentionally being deleted. For a host bind mount, make the directory
writable by UID/GID 1000 before first start, for example
`chown -R 1000:1000 /srv/tuneflow-data`, then replace the named-volume mapping
with `/srv/tuneflow-data:/data`.

When upgrading a deployment that used a differently named volume, stop both
stacks and copy the complete `/data` tree into the new `tuneflow-data` volume
before starting TuneFlow. Within one storage root, TuneFlow automatically
renames the previous database file and migrates branded settings keys.

The default `3124:3124` mapping publishes the Service on all host interfaces.
On the deployment host, open <http://127.0.0.1:3124>; from another device on a
trusted LAN, open `http://SERVER_IP:3124`. For host-local access only, change
the mapping to `127.0.0.1:3124:3124`. Publishing the port does not add
authentication; restrict access with the host firewall or a reverse proxy and
do not expose the Service directly to the Internet.

To back up the named volume, stop the stack and archive the full `/data`
contents from a temporary container. Restore into an empty named volume while
the application container is stopped, retaining file ownership for UID 1000.

## Downloads and local media

Downloads happen on the Service and are written under its storage root. The
browser never chooses or receives a host filesystem path. TuneFlow quality mapping
is preserved: APE becomes `.ape`; FLAC and FLAC 24-bit become `.flac`; WAV
becomes `.wav`; other qualities use `.mp3`. Source bytes are retained in the
selected TuneFlow format. There is no FFmpeg invocation or forced transcoding.

The local library scans Service-owned download roots and exposes only opaque
same-origin stream IDs. Playback and seeking use the Service's HTTP Range
routes; browser-visible DTOs do not contain server paths or resolved source
URLs. Library responses are ordered by completed download time descending, so
the newest download appears first. Files without a retained download record use
their filesystem creation time, or modification time when creation time is not
available.

MP3, FLAC, APE, and WAV downloads use TagLib-Wasm to persist title, artist,
album, cover artwork, and lyrics. The Service reads requested fields back after
writing and records a metadata warning on the completed download when
verification fails. The legacy `node-id3` writer is no longer packaged.
Existing audio is not rewritten automatically during an upgrade or ordinary
scan.

## Source trust boundary

Custom sources can be imported from a network URL or from a script selected in
the browser. Network imports are downloaded by the Service through the same
bounded network layer used by source workers, so they do not depend on the
remote server enabling browser CORS. Redirects and resolved targets are checked
against the Service SSRF policy. Local imports use the browser file picker and
send only the selected script contents to the Service; browser file paths are
never exposed. Source scripts are limited to 1 MiB for both import paths.

Imported music-source scripts are third-party code. They execute in the
Service's restricted worker compatibility layer, but it is not a process-grade
sandbox. Install
only sources you trust and accept responsibility for the source and returned
content. Never put source code, resolved audio URLs, credentials, cookies, or
request headers into screenshots, issue reports, or logs.

### Ordered multi-source fallback

The Service can keep several installed source scripts enabled in an explicit
order. Every new playback, download, lyric, or artwork request starts again at
the first configured source; a transient failure never promotes a backup or
changes the saved order. The legacy active-source endpoint now promotes one
source to the front while preserving the remaining enabled backups.

Local library audio, lyrics, and artwork always take precedence. For online
playback, the Service evaluates source-provided audio, lyrics, and artwork as a
bundle. It prefers the earliest source with all three usable resources, using a
four-second enrichment budget and a 500 ms hedge before starting each backup.
If no source provides a complete bundle, validated components may be combined
and the response reports `mixed` or `audio-only` completeness.

Audio is probed with a bounded byte range and artwork is fetched and validated
before selection. Browser and native clients receive only same-origin opaque
stream and artwork URLs; resolved targets, request headers, cookies, lyric
bodies, and image bytes are excluded from public diagnostics and structured
source-attempt logs.

Stream failover is allowed only before response headers or body bytes are
committed. The Service never joins bytes from two sources. Downloads apply the
same rule at file scope: a failed or unparseable candidate is discarded, the
temporary file is cleared, and the next source restarts at byte zero before
normal quality downgrade is considered.

## Web feature boundary

The Web build supports navigation, search, lists, player,
same-origin playback, Service downloads/local library, settings, local
shortcuts, and built-in themes. Electron-only integration is unavailable:
window/tray controls, desktop lyric, global hotkeys, update installation,
sync/Open API, native backup/file dialogs, system-font operations, and custom
theme-file editing. Unsupported settings are hidden or shown as explanatory
pages instead of invoking desktop IPC.

## License and upstream conditions

The upstream project is distributed under Apache-2.0 and its README expressly
adds conditions that take precedence where they conflict. Before using or
redistributing this derivative, read both `LICENSE` and the README's complete
“项目协议”. In particular, the user is responsible for source/data legality,
must remove generated copyrighted data within 24 hours, must comply with local
law and respect copyright, and the project is limited to non-commercial
technical exploration and research. This summary is not a substitute for the
complete upstream terms.
