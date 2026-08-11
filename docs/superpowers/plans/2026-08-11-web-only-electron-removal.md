# Web-only Electron Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LX Music Service plus its Web UI the repository's only supported runtime, remove desktop-only operations and Electron build/runtime code, and fix downloads to the Service-owned audio directory.

**Architecture:** First make the Service own its storage and persistence dependencies, then remove desktop-only UI consumers, and only then delete Electron entrypoints and packaging. The Web renderer continues to reuse upstream Vue components, but browser/Service adapters become canonical and no production path may require Electron.

**Tech Stack:** TypeScript, Vue 3, Fastify 5, SQLite via `better-sqlite3`, Webpack 5, Vitest, Playwright, Node.js 22.

## Global Constraints

- The only supported products are the Web UI and LX Music Service.
- The effective download root is always `${LX_STORAGE_ROOT}/audio`; in Docker it is `/data/audio`.
- Do not delete or rewrite existing databases, lists, downloads, audio files, or unrelated dirty-worktree changes.
- Network custom-source import, Service downloads, Service local-library scanning, built-in themes, and in-page play-detail navigation remain supported.
- Electron builds are not an acceptance gate after their scripts and dependencies are removed.
- Do not create a Git commit unless the user separately authorizes it.

---

### Task 1: Make the Service audio directory immutable

**Files:**
- Modify: `src/server/config.ts`
- Modify: `src/server/db/settingsRepository.ts`
- Modify: `src/server/api/schemas/settings.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`

**Interfaces:**
- Produces: `getAudioRoot(storageRoot: string): string`, returning `path.join(storageRoot, 'audio')`.
- Produces: `SettingsRepository.getSettings()` always projects `download.savePath` to `getAudioRoot(storageRoot)`.
- Produces: `SettingsRepository.updateSettings()` throws `ApiError(400, 'IMMUTABLE_SETTING', 'Download path is managed by the Service')` when the patch owns `download.savePath`.
- Consumed by: `DownloadManager` settings callback and `LibraryScanner` roots in `src/server/app.ts`.

- [ ] **Step 1: Add failing API and legacy-database tests**

Add tests to `src/server/app.test.ts` which insert a legacy `download.savePath` row, restart the Service, and assert:

```ts
expect((await app.inject({ method: 'GET', url: '/api/v1/settings' })).json().data['download.savePath'])
  .toBe(path.join(realpathSync(storageRoot), 'audio'))

expect((await app.inject({
  method: 'PATCH',
  url: '/api/v1/settings',
  payload: { 'download.savePath': path.join(storageRoot, 'other') },
})).json()).toEqual({
  error: { code: 'IMMUTABLE_SETTING', message: 'Download path is managed by the Service' },
})
```

Also assert another setting in the same rejected patch is unchanged, proving atomic rejection.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/server/app.test.ts`

Expected: FAIL because an in-root path is currently accepted and a legacy database value is currently returned.

- [ ] **Step 3: Implement the immutable storage contract**

Add to `src/server/config.ts`:

```ts
export const getAudioRoot = (storageRoot: string): string => path.join(storageRoot, 'audio')
```

In `SettingsRepository`, reject the key before starting the transaction, exclude it from persisted-value projection, and assign the canonical root last:

```ts
if (Object.prototype.hasOwnProperty.call(values, 'download.savePath')) {
  throw new ApiError(400, 'IMMUTABLE_SETTING', 'Download path is managed by the Service')
}

return {
  ...defaultSetting,
  ...this.values(),
  ...electronOnlyDefaults,
  'download.savePath': getAudioRoot(this.storageRoot),
}
```

Keep `download.savePath` in `SettingsPatchSchema` long enough for the repository to return the stable `IMMUTABLE_SETTING` error instead of a generic schema error. Keep it in the response schema until all renderer consumers no longer require the field. In `createServer`, pass `getAudioRoot(serverOptions.storageRoot)` directly to `LibraryScanner` so scanning does not depend on mutable settings.

- [ ] **Step 4: Run focused Service tests and verify GREEN**

Run: `npx vitest run src/server/app.test.ts src/server/downloads/downloads.test.ts`

Expected: PASS; all download files remain below the canonical audio root.

- [ ] **Step 5: Record checkpoint without committing**

Run: `git diff --check -- src/server/config.ts src/server/db/settingsRepository.ts src/server/api/schemas/settings.ts src/server/app.ts src/server/app.test.ts`

Expected: exit 0. Leave changes uncommitted.

---

### Task 2: Remove desktop-only actions from the Web UI

**Files:**
- Delete: `src/renderer/views/Setting/components/SettingBackup.vue`
- Delete: `src/renderer/views/List/MyList/actions.ts`
- Delete: `src/renderer/views/List/MyList/useShare.ts`
- Modify: `src/renderer/views/Setting/index.vue`
- Modify: `src/renderer/views/Setting/components/SettingBasic.vue`
- Modify: `src/renderer/views/Setting/components/SettingDownload.vue`
- Modify: `src/renderer/views/Setting/components/UserApiModal.vue`
- Modify: `src/renderer/views/List/MyList/index.vue`
- Modify: `src/renderer/views/List/MyList/useMenu.js`
- Modify: `src/renderer/views/Download/useMenu.js`
- Modify: `src/renderer/views/Download/useTaskActions.js`
- Modify: `src/renderer/views/Download/index.vue`
- Test: `tests/web-only-ui.spec.ts`

**Interfaces:**
- Produces: My List menu actions without `local_file`, `import`, or `export`.
- Produces: Download menu actions without `file`/locate-file.
- Produces: Settings table of contents without desktop lyric, sync, Open API, backup/restore, or software update.
- Produces: Download settings without a path editor or path opener.

- [ ] **Step 1: Add failing production-Web assertions**

Create `tests/web-only-ui.spec.ts` using the existing production Service fixture and assert accessible UI behavior:

```ts
await page.getByRole('tab', { name: '设置', exact: true }).click()
await expect(page.getByRole('tab', { name: '备份与恢复' })).toHaveCount(0)
await expect(page.getByRole('tab', { name: '桌面歌词设置' })).toHaveCount(0)
await page.getByRole('tab', { name: '下载设置' }).click()
await expect(page.getByText('下载路径', { exact: true })).toHaveCount(0)

await page.getByRole('tab', { name: '我的列表', exact: true }).click()
await page.getByText('试听列表', { exact: true }).click({ button: 'right' })
await expect(page.getByRole('tab', { name: '添加本地歌曲' })).toHaveCount(0)
await expect(page.getByRole('tab', { name: '导入', exact: true })).toHaveCount(0)
await expect(page.getByRole('tab', { name: '导出', exact: true })).toHaveCount(0)
```

Seed a completed download and similarly assert `定位文件` is absent while Play and Remove remain.

- [ ] **Step 2: Run the UI test and verify RED**

Run: `npx playwright test tests/web-only-ui.spec.ts`

Expected: FAIL on the currently visible backup tab, download path, and file-backed menu actions.

- [ ] **Step 3: Delete file and window operations from their consumers**

Remove the `SettingBackup` import, component registration, and TOC entry. Remove the other unsupported TOC entries rather than displaying `UnsupportedCapability`. Delete window size/start-fullscreen/tray sections from `SettingBasic.vue`; preserve themes, source management, font size, language, and playbar progress style.

Delete the download-path `<dd>`, `showSelectDialog`, `openDirInExplorer`, `isWeb`, `handleServerPathInput`, `handleChangeSavePath`, and `handleOpenSavePath` code from `SettingDownload.vue`.

Delete local import from `UserApiModal.vue` and retain only network import. Delete My List local/import/export actions and their handler plumbing. Delete Download locate-file action and all `checkPath`/`openDirInExplorer` plumbing.

- [ ] **Step 4: Run Web unit/build feedback and verify GREEN**

Run:

```bash
npx vitest run src/web-runtime/capabilities.test.ts src/renderer/store/runtimeCapabilities.test.ts
npm run build:web
```

Expected: PASS and no unresolved imports to deleted action/component files.

- [ ] **Step 5: Run the production UI test and verify GREEN**

Run: `npx playwright test tests/web-only-ui.spec.ts`

Expected: PASS; supported network source import and ordinary list/download actions remain usable.

- [ ] **Step 6: Record checkpoint without committing**

Run: `git diff --check -- src/renderer tests/web-only-ui.spec.ts`

Expected: exit 0. Leave changes uncommitted.

---

### Task 3: Move persistence ownership from Electron main to Service

**Files:**
- Move: `src/main/worker/dbService/db.ts` to `src/server/db/core/db.ts`
- Move: `src/main/worker/dbService/migrate.ts` to `src/server/db/core/migrate.ts`
- Move: `src/main/worker/dbService/tables.ts` to `src/server/db/core/tables.ts`
- Move: `src/main/worker/dbService/verifyDB.ts` to `src/server/db/core/verifyDB.ts`
- Move: `src/main/worker/dbService/modules/list/**` to `src/server/db/lists/**`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`
- Modify: `src/server/routes/lists.ts`
- Modify: `src/server/db/appDataRepository.ts`
- Modify: `src/server/db/settingsRepository.ts`
- Modify: `src/server/downloads/manager.ts`
- Modify: `src/server/downloads/downloads.test.ts`
- Modify: `src/server/sources/repository.ts`
- Modify: `src/server/sources/source.test.ts`

**Interfaces:**
- Produces from `src/server/db/core/db.ts`: existing `init(storageRoot)`, `getDB()`, and `close()` signatures unchanged.
- Produces from `src/server/db/lists/index.ts`: existing list CRUD signatures unchanged.
- Consumed by all Service repositories, routes, download manager, and tests.

- [ ] **Step 1: Add a dependency-boundary test that fails while Service imports `src/main`**

Add `src/server/electronBoundary.test.ts`:

```ts
it('does not import Electron-owned source trees', async() => {
  const files = await productionFiles(['src/server'])
  for (const file of files) {
    expect(await readFile(file, 'utf8')).not.toMatch(/(?:@main|src\/main|\.\.\/main\/)/)
  }
})
```

Implement `productionFiles` inside the test using `readdir` recursion; scan only `.ts`, `.js`, `.mjs`, and `.cjs` files and skip tests.

- [ ] **Step 2: Run the boundary test and verify RED**

Run: `npx vitest run src/server/electronBoundary.test.ts`

Expected: FAIL and identify current imports from `src/main/worker/dbService`.

- [ ] **Step 3: Move only Service-required persistence modules**

Move the core database and list modules into `src/server/db`. Update their relative imports without changing table names, migration SQL, or public functions. Do not move dislike, download, lyric cache, music-other-source, or music-url modules unless a Service import scan proves a supported Service path still consumes them.

Update all Service imports to the new paths. Keep the SQLite file name and migration behavior byte-for-byte compatible.

- [ ] **Step 4: Run persistence, list, source, and download tests**

Run:

```bash
npx vitest run src/server/app.test.ts src/server/events.test.ts src/server/sources/source.test.ts src/server/downloads/downloads.test.ts src/server/electronBoundary.test.ts
```

Expected: PASS; existing databases and list records remain compatible, and the boundary test finds no `src/main` imports.

- [ ] **Step 5: Build the Service and record checkpoint**

Run: `npm run build:server && git diff --check -- src/server`

Expected: both exit 0. Leave changes uncommitted.

---

### Task 4: Make browser workers and metadata helpers canonical

**Files:**
- Move: `src/renderer/worker/download/lrcTool.ts` to `src/common/utils/musicMeta/buildLyrics.ts`
- Modify: `src/server/downloads/metadata.ts`
- Modify: `src/renderer/core/globalData.ts`
- Modify: `src/renderer/types/app.d.ts`
- Delete: `src/renderer/types/worker.d.ts`
- Modify: `src/web-runtime/workers.ts`
- Modify: `src/web-runtime/workers.test.ts`
- Delete: `src/renderer/worker/**`

**Interfaces:**
- Produces: `buildLyrics(lyricInfo, settings): string` at the runtime-neutral path with its existing behavior.
- Produces: `createWebWorkers()` from `src/web-runtime/workers.ts`, returning the `main` and `download` adapters assigned to `window.lx.worker`.
- Consumed by: Service metadata writer and Web renderer global bootstrap.

- [ ] **Step 1: Extend worker tests to require the Web adapter directly**

In `src/web-runtime/workers.test.ts`, assert `filterMusicList` works and unsupported methods reject with exact `UNSUPPORTED_CAPABILITY`. Add a source-boundary assertion that `src/renderer/core/globalData.ts` imports `@web-runtime/workers`, not `@renderer/worker`.

- [ ] **Step 2: Run the worker test and verify RED**

Run: `npx vitest run src/web-runtime/workers.test.ts`

Expected: FAIL because `globalData.ts` currently imports the Electron renderer worker tree.

- [ ] **Step 3: Move the lyrics helper and switch Web worker ownership**

Move `buildLyrics` without behavior changes and update Service metadata tests/imports. Export explicit structural types from `src/web-runtime/workers.ts` and import them in `src/renderer/types/app.d.ts`. Change `globalData.ts` to create workers from `@web-runtime/workers`.

After import scans show no supported consumer remains, delete `src/renderer/worker` and `src/renderer/types/worker.d.ts`.

- [ ] **Step 4: Run metadata, worker, and Web builds**

Run:

```bash
npx vitest run src/server/downloads/metadata-writer.test.ts src/server/downloads/downloads.test.ts src/web-runtime/workers.test.ts
npm run build:web
npm run build:server
```

Expected: all exit 0 and emitted Web/Service bundles contain no path to `src/renderer/worker`.

- [ ] **Step 5: Record checkpoint without committing**

Run: `git diff --check -- src/common src/renderer src/server src/web-runtime`

Expected: exit 0. Leave changes uncommitted.

---

### Task 5: Delete Electron runtime, packaging, and dependencies

**Files:**
- Delete: `src/main/**`
- Delete: `src/renderer-lyric/**`
- Delete: Electron-only renderer modules found by the final import scan
- Delete: `build-config/main/**`
- Delete: `build-config/renderer/**`
- Delete: `build-config/renderer-lyric/**`
- Delete: `build-config/renderer-scripts/**`
- Delete: `build-config/lib/**`
- Delete: `build-config/build-after-pack.js`
- Delete: `build-config/build-before-pack.js`
- Delete: `build-config/build-pack.js`
- Delete: `build-config/dependencies-patch.js`
- Delete: `build-config/lib-update.js`
- Delete: `build-config/pack.js`
- Delete: `build-config/post-install.js`
- Delete: `build-config/runner-dev.js`
- Modify: `build-config/server/build.mjs`
- Modify: `build-config/server/prepare.mjs`
- Modify: `build-config/server/verify-native-runtimes.mjs`
- Modify: `build-config/renderer-web/webpack.config.base.js`
- Modify: `package.json`
- Modify mechanically: `package-lock.json`
- Modify: `README.md`
- Delete or replace: Electron packaging workflows under `.github/workflows/`
- Test: `build-config/server/electron-boundary.test.mjs`

**Interfaces:**
- Produces package scripts: `dev:web`, `build:web`, `build:server`, `prepare:service`, `build:service`, `dev:server`, `start:server`, `lint`, `test`, and `test:e2e`.
- Produces a Node-only `prepare:service`; it installs `dist/server` production dependencies and generates OpenAPI without invoking `electron-rebuild`.
- Produces Webpack aliases with no `@main`, Electron renderer, or Electron package dependency.

- [ ] **Step 1: Add a package/build boundary test and verify RED**

Create `build-config/server/electron-boundary.test.mjs` that loads `package.json`, enumerates production source/build files, and asserts:

```js
assert.equal(pkg.main, undefined)
assert.equal(pkg.scripts.postinstall, undefined)
for (const name of ['electron', 'electron-builder', 'electron-debug', 'electron-devtools-installer', 'electron-updater', 'electron-log']) {
  assert.equal(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name], undefined)
}
```

It must also fail if retired build directories exist or if Web/Service build files contain `@main` or Electron build commands.

Run: `node --test build-config/server/electron-boundary.test.mjs`

Expected: FAIL on current package metadata, scripts, dependencies, and directories.

- [ ] **Step 2: Remove Electron scripts and dependency roots**

Rewrite `package.json` as a Web/Service package: remove `main`, Electron keywords, `pack:*`, `publish:*`, `build:main`, `build:renderer`, `build:renderer-lyric`, `build:renderer-scripts`, desktop `dev`, `postinstall`, and proxy packaging helpers. Remove Electron dependencies plus dependencies proven to have no Web/Service consumer such as `font-list`.

Run `npm install --package-lock-only --ignore-scripts` to update `package-lock.json` mechanically; do not hand-edit lockfile package entries.

- [ ] **Step 3: Make Service preparation Node-only**

Delete the `electron-rebuild` branch from `prepare.mjs`. Remove Electron probes and dual-ABI expectations from native verification. Keep isolated Node package verification, real `better-sqlite3` open/close, real source worker action, and generated OpenAPI checks.

Remove `@main` aliases from Webpack/esbuild configs. Remove `electron-log/node` and `electron` aliases only after import scans prove no Web production import remains; where a browser adapter is still required, import the adapter directly rather than pretending it is Electron.

- [ ] **Step 4: Delete retired source and build trees**

Before deletion, run:

```bash
rg -n "@main|src/main|renderer-lyric|renderer-scripts|electron" src/server src/renderer src/web-runtime build-config/renderer-web build-config/server package.json
```

Resolve every supported-path result, then delete the retired directories and Electron packaging workflows. Do not delete runtime-neutral assets or utilities solely because their history originated in the desktop app.

- [ ] **Step 5: Run boundary, install, and build verification**

Run:

```bash
node --test build-config/server/electron-boundary.test.mjs
npm install --ignore-scripts
npm run build:service
npm run verify:service-isolated
```

Expected: all exit 0; installing and building do not download or invoke Electron tooling.

- [ ] **Step 6: Record checkpoint without committing**

Run: `git diff --check -- package.json package-lock.json build-config src .github README.md`

Expected: exit 0. Leave changes uncommitted.

---

### Task 6: Update documentation and run frozen Web/Service acceptance

**Files:**
- Modify: `README.md`
- Modify: `docs/server-web.md`
- Modify: `Dockerfile` only if its build commands still reference removed scripts
- Modify: `compose.yaml` only if its runtime command still references removed paths
- Modify: existing Playwright specs as required by intentionally removed desktop UI

**Interfaces:**
- Documents: Web URL, `${LX_STORAGE_ROOT}/audio`, Docker `/data/audio`, network-only custom-source import, Service-owned local library, and removal of Electron builds.
- Verifies: production Service plus Web artifact at `http://127.0.0.1:3124`.

- [ ] **Step 1: Update operator and developer documentation**

State that this repository no longer produces an Electron application and that future native clients consume Service APIs. Remove desktop installation, packaging, local file chooser, and desktop backup instructions. Document that the download path cannot be changed through Web or API.

- [ ] **Step 2: Run focused regression tests**

Run:

```bash
npx vitest run \
  src/server/app.test.ts \
  src/server/events.test.ts \
  src/server/sources/source.test.ts \
  src/server/downloads/downloads.test.ts \
  src/server/playback/proxy.test.ts \
  src/web-runtime/workers.test.ts \
  src/web-runtime/capabilities.test.ts
```

Expected: all pass.

- [ ] **Step 3: Freeze the tree and run the complete supported gate**

Generate the existing worktree fingerprint, then run exactly:

```bash
npm run lint
npm test
npm run build:service
npm run test:e2e
npm run verify:service-isolated
```

Regenerate the fingerprint and compare it byte-for-byte. Expected: every command exits 0 and the manifest is unchanged except ignored test artifacts.

- [ ] **Step 4: Start the new local Service artifact**

Run:

```bash
LX_HOST=127.0.0.1 \
LX_PORT=3124 \
LX_STORAGE_ROOT=./data \
LX_WEB_ROOT=./dist/web \
LX_SERVICE_NODE_MODULES=./dist/server/node_modules \
node dist/server/index.cjs
```

Expected: `GET http://127.0.0.1:3124/api/v1/health` returns `{ "ok": true }`.

- [ ] **Step 5: Verify the production Web UI**

At desktop and 390px viewports, verify:

- no desktop-only settings or file menu actions exist;
- network source management still opens;
- download settings contain no path editor;
- search/playback still use same-origin Service routes;
- a completed download appears in the Service local library and plays;
- direct `PATCH download.savePath` returns `IMMUTABLE_SETTING`;
- no unsupported Electron IPC error appears in page diagnostics.

- [ ] **Step 6: Final readback and handoff**

Run:

```bash
git status --short
git diff --stat
git diff --check
rg -n "electron|@main|src/main|renderer-lyric|renderer-scripts" package.json src/server src/renderer src/web-runtime build-config/renderer-web build-config/server
```

The final search may contain historical prose only; no production import, script, dependency, or build target may remain. Report deleted surfaces, migrated modules, exact verification results, and any deferred non-Electron Web limitation. Do not commit, push, or deploy.
