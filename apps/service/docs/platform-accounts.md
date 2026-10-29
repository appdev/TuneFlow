# Shared music platform accounts

Desktop, Web and Android use the same Service account APIs for platform status,
created/favorite playlists, imports and personal recommendations. An instance has
one shared account per provider (`tx`, `wy`, `kg`). This is a trusted household
workspace, not a multi-tenant account system.

## Access and first setup

Account and device APIs support HTTP and HTTPS directly, with no development
switch or capability probe. Password access and same-origin checks apply to
both. Existing music/library/playback APIs keep
their previous compatibility and shared-instance access policy. Account access
control does not make those older APIs suitable for public Internet exposure.

1. Start the service with its existing persistent config volume.
2. On an existing authorized app, open **Settings → Music platform accounts** and
   set the shared access password (8–128 characters). Existing authorizations,
   platform accounts, lists and music are retained. Legacy owner/member roles no
   longer grant different permissions; pairing and invitation APIs are removed.
3. On each additional app/browser, enter that password once and choose **Unlock
   and remember**. Only a revocable session token is kept in app/browser storage,
   scoped to the exact server address. The password itself is not stored there.
4. **Exit current access** revokes only that app session. Changing the access
   password requires the current password, retains the current session and logs
   out other app sessions. Neither action logs out the music platform account.
   Password verification uses a random salt and scrypt; only its hash is stored
   inside the encrypted vault. Login attempts and concurrent hashing are bounded.

For a new install with no existing session, set `TUNEFLOW_ACCESS_PASSWORD` in the
service environment before starting it. In a Docker/NAS management panel, add an
environment variable with that name and your chosen password (8–128 characters,
not only whitespace, no control characters), then apply the container settings
while retaining the existing `/config` mount. No initialization command is needed.

The service initializes the encrypted password vault before accepting requests.
As with offline initialization, this retains platform accounts and music but
revokes any legacy app sessions; unlock each app with the new password.
If a password already exists, the environment variable is ignored, including after
you change the password in an app. Changing this variable does not reset a forgotten
password. An explicitly empty or invalid value prevents first-time startup and
produces an error without printing the value; omit the variable to keep the existing
manual setup behavior. After successful initialization you may remove the variable
from the container configuration; the password persists in `/config`.

Docker environment values are visible to container administrators. Do not post
passwords, credentials, tokens or vaults in logs. An unauthenticated visitor can
never choose the first password. The stopped-service command below remains
available for manual initialization and forgotten-password recovery.

Behind a TLS reverse proxy set both of the following explicitly:

```text
TUNEFLOW_ACCOUNT_PUBLIC_ORIGIN=https://music.example.com
TUNEFLOW_ACCOUNT_TRUSTED_PROXY=<exact proxy socket peer IP>
```

The proxy must supply `X-Forwarded-Proto: https` and `X-Forwarded-Host` matching
that public origin. Forwarded headers from other peers are not trusted. Preserve
the browser Origin header. Serve the integrated Web at the public origin root.
The demo can be used directly at `http://192.168.0.70:3125`. HTTP support does not
disable password access, revocation, account revision checks or encrypted storage.

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
  that cache. Account/device changes invalidate client feeds. QQ tolerates an
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
only the existing credential allowlist in the encrypted vault. Subsequent account
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

`account-security/` is private (0700); its key and encrypted vault
are 0600. AES-256-GCM authenticates the encrypted vault. The application-owned
`vault.key` uses no OS Keychain. Protect backups of the key separately: encryption
does not protect against an attacker who obtains both the vault and its key.
Settings export, event snapshots and ordinary account responses never include
platform credentials or device-token hashes. Losing/corrupting a key fails closed;
the service does not silently reset the account vault.

For initial setup or a forgotten password, **stop the service** and run locally
in an interactive terminal:

```sh
node dist/server/recover-account-access.cjs --config-root /config --confirm-server-stopped
```

The command prompts for a new password twice without echoing it. For a protected
stdin pipe, add `--password-stdin`; never supply the password as an argument. This
revokes all old app sessions while retaining platform accounts, music, lists and
history. Restart, then unlock any app with the password. No password is printed.
Do not run the command against a live writer. Old setup-code files are retired.

Rollback the application image/code while retaining all existing volumes and
`account-security/`. Older versions ignore the new directory. Existing local
native authorization records and previously imported music data remain usable;
keep the original vault/key together for upgrading again. No database schema,
application ID, signing identity or update channel changes are required.
