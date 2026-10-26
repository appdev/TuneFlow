# Clean Docker Runtime Environment Design

## Goal

Make the published Docker image require configuration only at the Docker
boundary: port publishing and volume mounts. Internal runtime defaults must not
appear in deployment panels as if users need to configure them again.

## Current Problem

The runtime image inherits `NODE_VERSION` and `YARN_VERSION` from
`node:24-bookworm-slim`. The Dockerfile also records `NODE_ENV` and all
`TUNEFLOW_*` defaults with `ENV`. Docker management panels read the image's
`Config.Env` and consequently display these implementation details as editable
deployment configuration.

The mounted container paths are already fixed by the image contract:

- `/config` stores durable internal state.
- `/music` stores user-visible media.
- `/cache` stores rebuildable data.
- `/tmp/tuneflow` stores ephemeral work.
- `/app/dist/web` contains built web assets.
- `/app/dist/server/node_modules` contains packaged runtime dependencies.

Users should not need to repeat any of these paths after configuring the volume
mounts.

## Chosen Design

### Build and runtime images

Keep the Node image for the build stage, but pin it to an exact Node 24 release
instead of a moving major-version tag. Use a clean Debian Bookworm slim image
for the final runtime stage and copy the required Node runtime from the pinned
Node stage.

This prevents Node image metadata such as `NODE_VERSION` and `YARN_VERSION`
from being inherited into the final image. The project uses npm, so Yarn is not
a runtime requirement.

The final image may retain the base operating system's `PATH`; that is standard
process environment rather than TuneFlow deployment configuration.

### Runtime defaults

Replace Dockerfile `ENV` declarations with a small container entrypoint. At
startup it assigns defaults only when the corresponding variable is absent,
then uses `exec` to launch Node:

| Variable | Internal default |
| --- | --- |
| `NODE_ENV` | `production` |
| `TUNEFLOW_HOST` | `0.0.0.0` |
| `TUNEFLOW_PORT` | `3124` |
| `TUNEFLOW_CONFIG_ROOT` | `/config` |
| `TUNEFLOW_MEDIA_ROOT` | `/music` |
| `TUNEFLOW_CACHE_ROOT` | `/cache` |
| `TUNEFLOW_TEMP_ROOT` | `/tmp/tuneflow` |
| `TUNEFLOW_WEB_ROOT` | `/app/dist/web` |
| `TUNEFLOW_SERVICE_NODE_MODULES` | `/app/dist/server/node_modules` |

Because these values are assigned when the container starts rather than stored
in image `Config.Env`, deployment panels do not list them as fields requiring
configuration. Operators retain the existing escape hatch: explicitly supplied
environment variables override the internal defaults.

The entrypoint must preserve empty-versus-unset semantics deliberately. For
these required runtime values, an unset or empty value receives the safe
default so a blank panel field cannot accidentally produce an invalid path or
listen configuration.

### Container contract

The change does not alter:

- container port `3124` or the default host port mapping;
- `/config` and `/music` volume declarations and Compose mounts;
- cache and temporary directory locations;
- the non-root `node` runtime user and directory ownership;
- the health endpoint, Docker health check, restart behavior, or init behavior;
- source-mode configuration defaults outside Docker;
- the ability to override a TuneFlow runtime variable explicitly.

No Docker template or management-panel-specific metadata is introduced.

## Failure Handling

The entrypoint must use a POSIX shell available in the Debian runtime image,
fail immediately on startup errors, and replace itself with the Node process so
signals reach the service correctly. Existing application validation remains
responsible for rejecting inconsistent split-storage configuration.

If copying the Node runtime omits a required shared library or packaged native
dependency, the image build or isolated service/runtime checks must fail before
publication.

## Verification

Verification will cover both behavior and image metadata:

1. Static checks confirm the Dockerfile no longer records `NODE_ENV` or
   `TUNEFLOW_*` with `ENV`, and that the entrypoint supplies every required
   default while preserving explicit overrides.
2. Build the production image and inspect `.Config.Env`; it must not contain
   `NODE_VERSION`, `YARN_VERSION`, `NODE_ENV`, or any `TUNEFLOW_*` entry.
3. Start the image with the existing `/config` and `/music` mounts and no
   TuneFlow environment arguments; require a healthy service and verify the
   expected storage locations.
4. Start a focused override case and confirm an explicitly supplied supported
   value wins over the entrypoint default.
5. Run the existing Docker/static contract tests and isolated service checks.

## Scope and Compatibility

This is a metadata and container-startup cleanup. It does not migrate data,
change persisted formats, publish an image, deploy to a host, or remove the
documented advanced environment-variable interface. Existing deployments that
already supply the same values continue to work unchanged; new deployments no
longer see those defaults presented as mandatory configuration.
