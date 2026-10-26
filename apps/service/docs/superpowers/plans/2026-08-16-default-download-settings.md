# Default Download Settings Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable downloading and every approved download metadata and lyric option by default without changing any persisted user choice.

**Architecture:** Keep `src/common/defaultSetting.ts` as the single source of shared defaults. Exercise the settings HTTP boundary so the test covers the real merge order in `SettingsRepository`: defaults, then persisted values, then Service-owned overrides.

**Tech Stack:** TypeScript, Fastify injection tests, Vitest, SQLite settings repository

## Global Constraints

- Apply the behavior only to new installations and settings keys that have never been persisted.
- An explicitly persisted `false` must continue to override the new default.
- Keep `download.fileName` as `歌名 - 歌手`.
- Do not change any download setting outside the approved list.
- Do not add a settings migration or UI-specific initialization behavior.
- Preserve unrelated dirty-worktree changes and do not commit without explicit authorization.

---

## File Structure

- `src/common/defaultSetting.ts`: owns the shared application defaults; change only the approved download booleans that are currently `false`.
- `src/server/app.test.ts`: verifies fresh defaults and persisted-value precedence through `/api/v1/settings`.
- `docs/superpowers/specs/2026-08-16-default-download-settings-design.md`: approved behavior contract; no implementation changes.

### Task 1: Default Download Configuration and Persistence Compatibility

**Files:**
- Modify: `src/common/defaultSetting.ts:113-129`
- Test: `src/server/app.test.ts:40-90`

**Interfaces:**
- Consumes: `defaultSetting: TuneFlow.AppSetting`, `createTestServer()`, `createServer(...)`, and `PATCH/GET /api/v1/settings`.
- Produces: fresh settings with all approved download keys enabled while preserving persisted `false` values after restart.

- [x] **Step 1: Write the failing fresh-default test and persisted-choice regression test**

Extend the existing `exposes health, capabilities, and server-safe default settings` test after the download-path assertion:

```ts
expect(settings.data).toMatchObject({
  'download.enable': true,
  'download.fileName': '歌名 - 歌手',
  'download.isUseOtherSource': true,
  'download.isEmbedPic': true,
  'download.isEmbedLyric': true,
  'download.isEmbedVerbatimLyric': true,
  'download.isEmbedLyricT': true,
  'download.isEmbedLyricR': true,
  'download.isDownloadLrc': true,
  'download.isDownloadVerbatimLyric': true,
  'download.isDownloadTLrc': true,
  'download.isDownloadRLrc': true,
})
```

Add this separate test after `persists settings across a server restart`:

```ts
it('preserves persisted disabled download settings when defaults are enabled', async() => {
  const { app, storageRoot, webRoot } = await createTestServer()
  const disabled = {
    'download.enable': false,
    'download.isUseOtherSource': false,
    'download.isEmbedPic': false,
    'download.isEmbedLyric': false,
    'download.isEmbedVerbatimLyric': false,
    'download.isEmbedLyricT': false,
    'download.isEmbedLyricR': false,
    'download.isDownloadLrc': false,
    'download.isDownloadVerbatimLyric': false,
    'download.isDownloadTLrc': false,
    'download.isDownloadRLrc': false,
  }
  const patched = await app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: disabled })
  expect(patched.statusCode).toBe(200)
  await app.close()
  apps.splice(apps.indexOf(app), 1)

  const restarted = await createServer({ storageRoot, webRoot, host: '127.0.0.1', port: 0 })
  apps.push(restarted)
  expect((await restarted.inject({ method: 'GET', url: '/api/v1/settings' })).json().data).toMatchObject(disabled)
})
```

- [x] **Step 2: Run the focused tests and verify the red state**

Run:

```bash
npx vitest run src/server/app.test.ts -t "server-safe default settings|preserves persisted disabled download settings"
```

Expected: the fresh-default test fails because `download.enable`, `download.isUseOtherSource`, the main lyric toggles, and their translation/Romanization options are still `false`. The persisted-choice test passes, proving the existing override behavior already works.

- [x] **Step 3: Enable only the approved defaults**

Change the relevant block in `src/common/defaultSetting.ts` to these exact values:

```ts
'download.enable': true,
'download.isSavePathGroupByListName': false,
'download.savePath': path.join(os.homedir(), 'Desktop'),
'download.fileName': '歌名 - 歌手',
'download.maxDownloadNum': 3,
'download.skipExistFile': true,
'download.isDownloadLrc': true,
'download.isDownloadVerbatimLyric': true,
'download.isDownloadTLrc': true,
'download.isDownloadRLrc': true,
'download.lrcFormat': 'utf8',
'download.isEmbedPic': true,
'download.isEmbedLyric': true,
'download.isEmbedVerbatimLyric': true,
'download.isEmbedLyricT': true,
'download.isEmbedLyricR': true,
'download.isUseOtherSource': true,
```

Do not modify `SettingsRepository`, the Vue settings component, or migration code.

- [x] **Step 4: Run the focused tests and verify the green state**

Run:

```bash
npx vitest run src/server/app.test.ts -t "server-safe default settings|preserves persisted disabled download settings"
```

Expected: both tests pass with no warnings or unhandled errors.

- [x] **Step 5: Run boundary verification for shared default consumers**

Run:

```bash
npx vitest run src/server/app.test.ts src/server/downloads/metadata-writer.test.ts src/server/library/metadataEnricher.test.ts
npx eslint src/common/defaultSetting.ts src/server/app.test.ts
git diff --check -- src/common/defaultSetting.ts src/server/app.test.ts
```

Expected: all selected Vitest files pass, ESLint reports no errors, and `git diff --check` produces no output.

- [x] **Step 6: Review the final scoped diff without committing**

Run:

```bash
git diff -- src/common/defaultSetting.ts src/server/app.test.ts
git status --short -- src/common/defaultSetting.ts src/server/app.test.ts docs/superpowers/specs/2026-08-16-default-download-settings-design.md docs/superpowers/plans/2026-08-16-default-download-settings.md
```

Expected: only the approved default booleans and their focused tests changed in production/test code. Leave all files uncommitted because no commit was authorized.
