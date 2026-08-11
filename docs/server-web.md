# LX Music Server + Web

This build runs the original LX Music PC renderer in a browser while a single
Node.js Service owns settings, lists, sources, downloads, the local library,
SQLite, and media files. It is an early single-user iteration, not a public
multi-user service.

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
| `LX_HOST` | `127.0.0.1` | HTTP listen address |
| `LX_PORT` | `3124` | HTTP listen port |
| `LX_STORAGE_ROOT` | `./data` | Service-owned durable data root |
| `LX_WEB_ROOT` | `./dist/web` | Prepared browser assets |
| `LX_SERVICE_NODE_MODULES` | `./dist/server/node_modules` when prepared | Service native/runtime dependencies |

The loopback default is intentional. To opt in on a trusted LAN, bind
`LX_HOST=0.0.0.0` and control access with the host firewall or reverse proxy.
There is no authentication, tenant separation, or public-network hardening;
do not expose this iteration directly to the Internet.

## Storage, backup, and restore

The storage root contains:

- `lx.data.db`, plus `lx.data.db-wal` and `lx.data.db-shm` while SQLite is live;
- `audio/` for downloaded and scanned audio;
- `sources/`, `tmp/`, `logs/`, and `backups/` for Service-owned support data.

The media path is fixed at `${LX_STORAGE_ROOT}/audio` (and `/data/audio` in the
Docker image). It cannot be selected or changed through the Web UI or Service
API; attempts to patch `download.savePath` are rejected with
`IMMUTABLE_SETTING`.

Back up the complete storage root, not only the database. Stop the Service
first (or use SQLite's consistent backup facility), archive the directory, and
restore it at the same path while the Service is stopped. Restoring only
`lx.data.db` can leave lists/download records inconsistent with media files.

## Docker

The image uses Node 22 slim, compiles the Linux `better-sqlite3` binding in the
builder, copies the prepared production artifact, runs as the image's non-root
`node` user, and stores all durable data in `/data`. It does not install FFmpeg.

```sh
docker compose build
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:3124/api/v1/health
docker compose logs -f lx-music-web
docker compose down
```

The default named volume is `lx-music-data` (Compose prefixes it with the
project name). `docker compose down` preserves it; do not add `-v` unless the
data is intentionally being deleted. For a host bind mount, make the directory
writable by UID/GID 1000 before first start, for example
`chown -R 1000:1000 /srv/lx-music-data`, then replace the named-volume mapping
with `/srv/lx-music-data:/data`.

For a trusted-LAN opt-in, change the published port to `0.0.0.0:3124:3124`.
This only changes reachability and does not add authentication.

To back up the named volume, stop the stack and archive the full `/data`
contents from a temporary container. Restore into an empty named volume while
the application container is stopped, retaining file ownership for UID 1000.

## Downloads and local media

Downloads happen on the Service and are written under its storage root. The
browser never chooses or receives a host filesystem path. LX quality mapping
is preserved: APE becomes `.ape`; FLAC and FLAC 24-bit become `.flac`; WAV
becomes `.wav`; other qualities use `.mp3`. Source bytes are retained in the
selected LX format. There is no FFmpeg invocation or forced transcoding.

The local library scans Service-owned download roots and exposes only opaque
same-origin stream IDs. Playback and seeking use the Service's HTTP Range
routes; browser-visible DTOs do not contain server paths or resolved source
URLs.

## Source trust boundary

Custom sources are imported from a network URL. The Web UI has no local source
file chooser.

Imported music-source scripts are third-party code. They execute in the
Service's restricted worker compatibility layer, but this iteration follows
the original desktop trust model and is not a process-grade sandbox. Install
only sources you trust and accept responsibility for the source and returned
content. Never put source code, resolved audio URLs, credentials, cookies, or
request headers into screenshots, issue reports, or logs.

## Web feature boundary

The Web build supports the original navigation, search, lists, player,
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
