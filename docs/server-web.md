# TuneFlow · 音流 Server + Web

TuneFlow serves its Vue renderer in a browser while a single Node.js Service
owns settings, lists, sources, downloads, the local library, SQLite, and media
files. It is an early single-user iteration, not a public multi-user service.

This repository no longer builds or packages an Electron application. Future
native clients are expected to consume the same Service APIs instead of owning
storage or desktop-only IPC.

## Local build and start

Install Node.js 24 or newer, then run:

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
| `TUNEFLOW_CONFIG_ROOT` | none | Split durable internal-state root; requires all split variables |
| `TUNEFLOW_MEDIA_ROOT` | none | Split user-media root |
| `TUNEFLOW_CACHE_ROOT` | none | Split rebuildable-cache root |
| `TUNEFLOW_TEMP_ROOT` | none | Split ephemeral-work root |
| `TUNEFLOW_WEB_ROOT` | `./dist/web` | Prepared browser assets |
| `TUNEFLOW_SERVICE_NODE_MODULES` | `./dist/server/node_modules` when prepared | Service native/runtime dependencies |

The loopback default is intentional. To opt in on a trusted LAN, bind
`TUNEFLOW_HOST=0.0.0.0` and control access with the host firewall or reverse proxy.
There is no authentication, tenant separation, or public-network hardening;
do not expose this iteration directly to the Internet.

## Storage, backup, and restore

Docker uses four explicit roots:

- `/config/database`, `/config/sources`, and `/config/backups` are durable
  internal state in the `tuneflow-config` named volume;
- `/music` contains user-visible audio and requested `.lrc` sidecars;
- `/cache/library` contains rebuildable cover, lyric, and index data;
- `/tmp/tuneflow` contains resumable parts and general temporary data.

Logs stay on stdout/stderr. `/cache`, `/tmp/tuneflow`, and logs are not backup
inputs. The media path cannot be changed through the Web UI or API; attempts to
patch `download.savePath` are rejected with `IMMUTABLE_SETTING`.

A complete backup has two coordinated parts: the stopped `tuneflow-config`
volume and the stopped `/music` host directory. Restore both together while the
Service is stopped. Source execution remains compatible with the combined
`TUNEFLOW_STORAGE_ROOT=./data` layout; do not combine that variable with any
split-root variable.

## Docker

The image uses Node 24 slim, compiles the Linux `better-sqlite3` binding in the
builder, copies the prepared production artifact, and runs as the image's
non-root UID/GID 1000 `node` user. It does not install FFmpeg.

```sh
mkdir -p ./music
sudo chown -R 1000:1000 ./music
docker compose build
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:3124/api/v1/health
docker compose logs -f tuneflow-web
docker compose down
```

Compose bind-mounts `${TUNEFLOW_MUSIC_DIR:-./music}` at `/music` and mounts the
`tuneflow-config` named volume at `/config`. `docker compose down` preserves
both; do not add `-v` unless internal state is intentionally being deleted.
`/cache` and `/tmp/tuneflow` are container-local and rebuildable.

The default `3124:3124` mapping publishes the Service on all host interfaces.
On the deployment host, open <http://127.0.0.1:3124>; from another device on a
trusted LAN, open `http://SERVER_IP:3124`. For host-local access only, change
the mapping to `127.0.0.1:3124:3124`. Publishing the port does not add
authentication; restrict access with the host firewall or a reverse proxy and
do not expose the Service directly to the Internet.

To back up, stop the stack, archive the entire `tuneflow-config` volume, and
archive the entire host music directory in the same maintenance window. Restore
both into empty targets, retaining write ownership for UID/GID 1000.

```sh
mkdir -p ./backup
docker compose stop
docker compose run --rm --no-deps \
  -v "$PWD/backup:/backup" \
  --entrypoint sh tuneflow-web -c \
  'tar -C /config -czf /backup/tuneflow-config.tgz . && tar -C /music -czf /backup/tuneflow-music.tgz .'
```

To restore, keep the stack stopped, verify that `/config` and the configured
host music directory are empty, then extract both archives and restore
ownership before starting the Service:

```sh
docker compose run --rm --no-deps \
  -v "$PWD/backup:/backup:ro" \
  --entrypoint sh tuneflow-web -c \
  'tar -C /config -xzf /backup/tuneflow-config.tgz && tar -C /music -xzf /backup/tuneflow-music.tgz'
sudo chown -R 1000:1000 "${TUNEFLOW_MUSIC_DIR:-./music}"
docker compose up -d
```

<a id="legacy-docker-migration"></a>

### Migrating a legacy Docker `/data` volume

Stop the old container first. Set `OLD_VOLUME` to its actual volume name, then
run the copy-only migration against empty targets:

```sh
docker stop tuneflow-server
mkdir -p ./music
sudo chown -R 1000:1000 ./music
docker volume create tuneflow-config
docker run --rm \
  -v "$OLD_VOLUME:/legacy:ro" \
  -v tuneflow-config:/config \
  -v "$PWD/music:/music" \
  apkdv/tuneflow-server:latest \
  node dist/server/migrate-storage.cjs \
    --from /legacy --config-root /config --media-root /music
```

The command requires empty config and media targets, verifies copied bytes and
SQLite state, and writes `storage-layout.json` only after publication succeeds.
It does not copy derived `cover/`, `lyrics/`, `library-resource-index/`, `tmp/`,
or `logs/` data. It never modifies the read-only old volume.

After success, start the new Compose definition and verify health and media.
For rollback, stop the new container and run the prior image/Compose definition
with the untouched old volume mounted at `/data`. Do not run both layouts
against the same database at the same time.

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
album, cover artwork, and lyrics. The Service writes basic tags and every
available enrichment field to the staged file, then reads requested fields back
before publication. Missing requested artwork or lyrics completes with a
bounded warning; a write, parse, or read-back verification failure is fatal and
does not publish the staged file. The legacy `node-id3` writer is no longer packaged.
Existing audio is not rewritten automatically during an upgrade or ordinary
scan.

Client requests carry music identity and provider query context under
`musicInfo.meta`; they do not carry trusted artwork or lyrics bytes. The
canonical artwork snapshot field is `meta.picUrl`. For compatibility, the
Service promotes the first non-empty HTTP(S) value from `meta.picUrl`, `img`,
then `pic`, and normalizes persisted legacy download records for future resume
or explicit redownload without rewriting completed media.

User-initiated downloads first ask the Service to reject an existing match. If
one exists, the Web client asks for confirmation and retries with replacement
only after approval. The create API accepts `existingFilePolicy` values
`reuse`, `error`, `replace`, and `duplicate`; an explicit policy overrides the
legacy `skipExisting` field and setting. Automatic playback saves use `reuse`.

Replacement downloads keep the existing audio available while the new file is
downloaded, parsed, tagged, and synchronized in staging. Same-format success is
published by an atomic rename over the original. A format change publishes the
new file before removing the verified old file. Persisted integrity markers let
startup recovery finish an interrupted publication, while a changed original
or unrelated destination causes a conflict instead of an overwrite. Once a
replacement reaches its prepared phase, let the short publication transaction
finish before rolling back or stopping the Service.

For multi-source downloads, each audio candidate carries its own validated
lyrics and artwork. The Service prefers a complete same-source bundle and fills
only missing resources from other validated sources. Built-in provider lookup
is attempted next, followed by the canonical `meta.picUrl` artwork snapshot.
Every artwork candidate uses the same SSRF, redirect, size, signature,
dimension, and MIME checks. A failed audio candidate's partial bytes and
metadata are discarded before the next candidate starts.

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

The hosted Web source manager can export every installed custom source as one
ZIP archive. The archive contains only the persisted JavaScript files; it does
not contain original import URLs, source selection order, enabled state, or a
restore manifest. Treat the archive as sensitive because source scripts can
contain private configuration.

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
