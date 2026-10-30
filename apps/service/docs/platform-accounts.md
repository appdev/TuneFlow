# Shared music platform accounts

Desktop, Web and Android use the same Service account APIs for platform status,
created/favorite playlists, imports and personal recommendations. An instance has
one shared account per provider (`tx`, `wy`, `kg`). This is a trusted household
workspace, not a multi-tenant account system.

## Access and first setup

Start the service and open **Settings → Music platform accounts**. Sign in to a
music platform once using its official QR code or share a local official session.
Web, desktop and Android connected to the same service can use it immediately;
no TuneFlow access password, unlock step or device token is required.

Account routes support HTTP, HTTPS and relays without Origin checks or
account-specific proxy configuration. `TUNEFLOW_ACCESS_PASSWORD` is ignored.
The deployment operator controls access to the server.

## Authorization and migration

- All clients support official QR login. QQ uses QQ scan/confirmation; NetEase
  and Kugou use their official apps. QR session cookies, polling tickets and OAuth
  exchanges stay on the server. Attempts are bound to the requesting device,
  expire, support cancellation, and cannot overwrite a newer account revision.
- Native official login remains available. **Share the account already logged
  in on this device** validates and sends only music-specific credentials to the
  selected service using its configured HTTP or HTTPS address. General QQ login cookies are
  excluded. Existing local records are retained as migration fallback; nothing
  is uploaded merely by navigating to a page.
- QQ's separate official daily authorization can be saved in all clients. It is
  validated before replacement; account radar recommendations remain the fallback.
- A failed login or migration leaves the existing server account intact. Import
  rejects incomplete playlist reads and adds to stable provider/owner/list IDs,
  retaining previous edits and cross-device additions. Logging out clears the
  shared authorization, not imported playlists, downloaded music or history.
- Platform expiration/challenges require official reauthorization. A successful
  local login does not guarantee the platform will accept that session from the
  server's network; rejected transfers are reported and do not replace state.
- Personal recommendations are cached per provider/revision. Refresh bypasses
  that cache. Account changes invalidate client feeds. QQ tolerates an
  individual missing or failed track without discarding remaining recommendations.
- Playback resolution, recoverable platform switching and download behavior stay
  in the existing Service pipeline. QQ favorite writes use the shared account,
  verify the official read-back state and never retry the write automatically.

## Storage, recovery and rollback

NetEase QR authorization uses an isolated Chromium process and ephemeral browser
context per attempt. The official page initializes the session; the Service sends
its encrypted WEAPI requests within that context. At most two browser attempts
run concurrently. Cancellation, replacement, expiry and shutdown close their
resources; successful authorization closes the browser immediately and retains
only the existing credential allowlist in the account configuration. Subsequent account
reads use the ordinary HTTP adapter.

The Docker runtime includes Chromium and Xvfb. On Linux without `DISPLAY`, each
attempt starts its own virtual display with TCP listening disabled. Chromium
sandboxing stays enabled. Native Service installations need a compatible local
Chromium and, on Linux without a display, Xvfb; set
`TUNEFLOW_CHROMIUM_EXECUTABLE` to a system Chromium executable when needed.
Browser initialization failures return `ACCOUNT_LOGIN_UNAVAILABLE` with phase
`wy-browser`, without browser logs, URLs, cookies or profile data.

If Docker's seccomp filter blocks Chromium's sandbox namespaces, the reviewed
`docker/chromium-seccomp.json` profile is based on the Moby v26.1.5 default
(`https://github.com/moby/moby/blob/v26.1.5/profiles/seccomp/default.json`,
Apache-2.0). Following Playwright's Docker guidance, its only added rule allows
`clone`, `setns` and `unshare`. Applying that profile changes the container's
security policy and requires explicit operator approval. The application never
disables Chromium sandboxing, uses privileged mode or changes host sysctls to
work around initialization failure.

`account-security/` is private (0700); `accounts.json` is 0600 and stores the
server ID, account revisions and platform credentials directly as JSON.
Settings export, event snapshots and ordinary account responses never include
platform credentials. Back up this directory with the rest of `/config`.

On the first upgrade from encrypted storage, the service reads `vault.enc` using
the original `vault.key`, writes `accounts.json` atomically and retains the old
files. No password or manual decryption is needed. Password hashes and device
sessions are not copied. Missing/corrupt legacy keys stop migration without
overwriting the original data. Once JSON storage exists, restarts use it directly.

For rollback, stop the service and retain a backup of the entire directory.
Older images use the preserved vault/key, representing the account state before
migration; account changes made after migration are not reflected in that old
snapshot. Keep the JSON backup to return to the new image. Music, imported lists,
application IDs, signing identities and update channels are unchanged.
