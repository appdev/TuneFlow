# Default Download Settings Design

## Goal

Make downloads and the download-related options shown in the approved settings
screenshot enabled by default for new installations and for settings keys that
have never been persisted.

Existing user choices must remain unchanged. In particular, an explicitly
persisted `false` value must continue to override the new default.

## Defaults

The shared default settings will use these values:

- `download.enable`: `true`
- `download.isUseOtherSource`: `true`
- `download.fileName`: `歌名 - 歌手` (already the current default)
- `download.isEmbedPic`: `true` (already the current default)
- `download.isEmbedLyric`: `true`
- `download.isEmbedVerbatimLyric`: `true` (already the current default)
- `download.isEmbedLyricT`: `true`
- `download.isEmbedLyricR`: `true`
- `download.isDownloadLrc`: `true`
- `download.isDownloadVerbatimLyric`: `true` (already the current default)
- `download.isDownloadTLrc`: `true`
- `download.isDownloadRLrc`: `true`

No other download setting changes.

## Implementation

Update only the relevant values in `src/common/defaultSetting.ts`. Keep the
existing settings merge order in `SettingsRepository`: shared defaults first,
persisted values second, and Service-owned overrides last. This preserves every
explicitly saved user choice and requires no data migration.

The settings UI already renders these keys directly, so it requires no component
or styling changes.

## Verification

Extend the Service settings test to prove that a fresh settings repository
exposes every approved download default. Add coverage that persists selected
download values as `false`, restarts the Service, and proves those values remain
`false` rather than being replaced by the new defaults.

Run the focused Service settings tests. Since this is a shared default object,
also run the TypeScript test suite or the narrowest existing suite that imports
the defaults broadly enough to detect incompatible assumptions.

## Compatibility and Risk

This is backward compatible for persisted settings. The behavior change applies
only to fresh installations and missing keys. Enabling artwork and lyric work by
default may perform additional resource requests during downloads, but that is
the requested behavior and uses existing download code paths.
