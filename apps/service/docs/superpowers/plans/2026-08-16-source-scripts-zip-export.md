# Source Scripts ZIP Export Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one hosted-Web action that downloads every installed user-source JavaScript file in a single ZIP archive.

**Architecture:** `SourceRepository` supplies a database-backed export inventory, a focused export module validates and safely names those files, and the source route streams them through Archiver. A Web-only binary download helper turns the response into one browser download, while the shared source-management modal exposes the action only in the hosted Web runtime.

**Tech Stack:** Node.js 24, TypeScript 5.9, Fastify 5, Archiver 8.0.0, Vue 3, Vitest 4, Playwright, AdmZip 0.6.0 for ZIP assertions.

## Global Constraints

- Export every source registered in `web_sources`, including enabled and disabled sources.
- Include only byte-identical `.js` files at the archive root; no manifest, URLs, ordering, or enabled state.
- Never enumerate arbitrary directory contents or expose a server filesystem path.
- Validate every registered source before successful response headers; fail the complete export if any file is unavailable.
- Stream ZIP generation on the server rather than buffering the complete archive.
- Show the control only in hosted Web; leave Electron-owned behavior unchanged.
- Warn that exported scripts can contain sensitive configuration.
- Preserve unrelated dirty-worktree changes. Do not commit without explicit user authorization.

---

## File Structure

- Create `src/server/sources/export.ts`: filename normalization, preflight, export-entry types, archive filename.
- Create `src/server/sources/export.test.ts`: inventory, naming, path-safety, empty and missing-file tests.
- Modify `src/server/sources/repository.ts` and `src/server/sources/types.ts`: expose a registered-source export inventory.
- Modify `src/server/routes/sources.ts`: add the streaming ZIP route and typed error mapping.
- Create `src/server/routes/sources-export.test.ts`: inspect response headers and ZIP contents.
- Modify `src/server/api/openapi.test.ts`: freeze the binary route contract.
- Modify `package.json` and `package-lock.json`: add Archiver and test ZIP dependencies.
- Create `src/web-runtime/download.ts` and `src/web-runtime/download.test.ts`: typed binary download support.
- Modify `src/web-runtime/http.ts`: share stable API error decoding with binary requests.
- Modify `src/renderer/views/Setting/components/UserApiModal.vue`: add Web-only Export behavior.
- Modify `src/lang/en-us.json`, `src/lang/zh-cn.json`, and `src/lang/zh-tw.json`: export failure and warning copy.
- Create `src/server/task4Ui.smoke.test.ts`: browser download coverage.
- Modify `docs/server-web.md`: document export contents and exclusions.

---

### Task 1: Registered Inventory and Safe ZIP Entry Names

**Files:**
- Create: `src/server/sources/export.ts`
- Create: `src/server/sources/export.test.ts`
- Modify: `src/server/sources/repository.ts`
- Modify: `src/server/sources/types.ts`

**Interfaces:**
- Produces: `SourceExportSource { id: string, name: string, version: string, scriptPath: string }`.
- Produces: `SourceExportEntry { sourceId: string, archiveName: string, scriptPath: string, size: number }`.
- Produces: `SourceRepository.listSourceExportFiles(): SourceExportSource[]` and `getSourceRoot(): string`.
- Produces: `prepareSourceExport(sources, sourceRoot): SourceExportEntry[]` and `sourceExportArchiveName(now?): string`.

- [x] **Step 1: Write the failing repository inventory test**

Install two distinct scripts, create an unrelated `sources/.orphan.js`, then assert:

```ts
const inventory = repository.listSourceExportFiles()
expect(inventory.map(({ name, version }) => ({ name, version }))).toEqual([
  { name: 'First source', version: '1.0.0' },
  { name: 'Second source', version: '2.0.0' },
])
expect(inventory.every(item => item.scriptPath.endsWith(`${item.id.slice('user_api_'.length)}.js`))).toBe(true)
expect(inventory.some(item => item.scriptPath.endsWith('.orphan.js'))).toBe(false)
```

Use the existing `initDatabase`/`closeDatabase` temporary-root lifecycle.

- [x] **Step 2: Prove the inventory interface is absent**

Run: `npx vitest run src/server/sources/export.test.ts -t "registered source inventory"`

Expected: FAIL because `listSourceExportFiles` is undefined.

- [x] **Step 3: Add the inventory type and repository methods**

Add to `src/server/sources/types.ts`:

```ts
export interface SourceExportSource {
  id: string
  name: string
  version: string
  scriptPath: string
}
```

Implement without directory scanning:

```ts
getSourceRoot(): string { return this.sourceDir }

listSourceExportFiles(): SourceExportSource[] {
  return this.listSources().map(({ id, name, version }) => {
    const installed = this.getSource(id)
    return { id, name, version, scriptPath: installed.scriptPath }
  })
}
```

- [x] **Step 4: Prove the inventory passes**

Run: `npx vitest run src/server/sources/export.test.ts -t "registered source inventory"`

Expected: PASS.

- [x] **Step 5: Write failing preflight and naming tests**

Assert the stable archive name:

```ts
expect(sourceExportArchiveName(new Date('2026-08-16T03:04:05Z')))
  .toBe('tuneflow-sources-20260816-030405.zip')
```

Cover separators, control characters, leading/trailing dots and spaces, empty
normalized names, more than 120 Unicode code points, and two names that
normalize identically. Every result must be a unique root-only `.js` name;
collisions append the first eight hash characters. An empty inventory must
throw `SOURCE_EXPORT_EMPTY`. A missing file, directory, unreadable file, or
real path outside `sourceRoot` must throw `SOURCE_EXPORT_FAILED` with exactly
`Unable to export installed sources` and no host path.

- [x] **Step 6: Prove the preflight functions are absent**

Run: `npx vitest run src/server/sources/export.test.ts`

Expected: FAIL because `prepareSourceExport` and `sourceExportArchiveName` do not exist.

- [x] **Step 7: Implement the minimal preflight module**

Create these public definitions:

```ts
export interface SourceExportEntry {
  sourceId: string
  archiveName: string
  scriptPath: string
  size: number
}

export const sourceExportArchiveName = (now = new Date()): string => {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  return `tuneflow-sources-${stamp}.zip`
}

export type PrepareSourceExport = (
  sources: readonly SourceExportSource[],
  sourceRoot: string,
) => SourceExportEntry[]
```

The private naming helper must normalize `NFKC`, replace control codes and
`[<>:"/\\|?*]` with `_`, trim spaces/dots, cap the base at 120 Unicode code
points, fall back to `source`, and append the version when non-empty. Detect
collisions case-insensitively.

Canonicalize root and file with `realpathSync`, verify containment using
`path.relative`, require `statSync(...).isFile()`, and open/close each file
read-only before returning its size. Convert all I/O details to the generic
typed error.

- [x] **Step 8: Run focused source tests**

Run: `npx vitest run src/server/sources/export.test.ts src/server/sources/source.test.ts`

Expected: PASS.

- [x] **Step 9: Commit only if authorized**

```bash
git add src/server/sources/export.ts src/server/sources/export.test.ts src/server/sources/repository.ts src/server/sources/types.ts
git commit -m "feat(sources): prepare installed scripts for export"
```

Otherwise leave the unit uncommitted.

---

### Task 2: Streaming ZIP API

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/server/routes/sources.ts`
- Create: `src/server/routes/sources-export.test.ts`
- Modify: `src/server/api/openapi.test.ts`

**Interfaces:**
- Consumes: Task 1 inventory and preflight interfaces.
- Produces: `SourcesService.prepareExport(): SourceExportEntry[]`.
- Produces: `GET /api/v1/sources/export` with `application/zip`.

- [x] **Step 1: Install exact dependencies**

Run: `npm install archiver@8.0.0 && npm install --save-dev @types/archiver@8.0.0 adm-zip@0.6.0`

Expected: lockfile-only transitive changes; no unrelated upgrades.

- [x] **Step 2: Write failing route tests**

Install two scripts through `POST /api/v1/sources`, request the export, and inspect it:

```ts
const response = await app.inject({ method: 'GET', url: '/api/v1/sources/export' })
expect(response.statusCode).toBe(200)
expect(response.headers['content-type']).toMatch(/^application\/zip/)
expect(response.headers['content-disposition']).toMatch(/^attachment; filename="tuneflow-sources-\d{8}-\d{6}\.zip"$/)
expect(response.headers['cache-control']).toBe('no-store')
const entries = new AdmZip(response.rawPayload).getEntries()
expect(entries).toHaveLength(2)
expect(entries.every(entry => !entry.isDirectory && /^[^/\\]+\.js$/.test(entry.entryName))).toBe(true)
expect(entries.map(entry => entry.getData().toString('utf8'))).toEqual([firstScript, secondScript])
```

Also assert empty storage returns 409/`SOURCE_EXPORT_EMPTY`, and deleting a
registered script before export returns 500/`SOURCE_EXPORT_FAILED` without
`storageRoot` or the missing path in the response.

- [x] **Step 3: Prove the endpoint is absent**

Run: `npx vitest run src/server/routes/sources-export.test.ts`

Expected: FAIL with 404.

- [x] **Step 4: Add service preparation and error mapping**

Implement:

```ts
prepareExport(): SourceExportEntry[] {
  return prepareSourceExport(
    this.repository.listSourceExportFiles(),
    this.repository.getSourceRoot(),
  )
}
```

Map `SOURCE_EXPORT_EMPTY` to 409 and `SOURCE_EXPORT_FAILED` to 500 in
`asApiError`. Preserve the sanitized message.

- [x] **Step 5: Register the streaming route before `/:id`**

Use the binary schema and Archiver stream:

```ts
app.get('/api/v1/sources/export', {
  schema: {
    operationId: 'exportSourceScripts', tags: ['Sources'],
    summary: 'Export installed source scripts as a ZIP archive',
    response: {
      200: Type.String({ format: 'binary', contentMediaType: 'application/zip' }),
      ...ErrorResponses,
    },
  },
}, async(_request, reply) => {
  const entries = service.prepareExport()
  const archive = archiver('zip', { zlib: { level: 9 } })
  archive.on('error', error => archive.destroy(error))
  for (const entry of entries) archive.file(entry.scriptPath, { name: entry.archiveName })
  void reply.headers({
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${sourceExportArchiveName()}"`,
    'cache-control': 'no-store',
  })
  void archive.finalize()
  return reply.send(archive)
})
```

If Fastify requires `reply.send(archive)` before `finalize`, reverse those two
operations as proven by the test. Never use `Buffer.concat`.

- [x] **Step 6: Run backend tests**

Run: `npx vitest run src/server/routes/sources-export.test.ts src/server/sources/export.test.ts src/server/sources/source.test.ts`

Expected: PASS with byte-identical scripts.

- [x] **Step 7: Freeze the OpenAPI contract**

Add `/api/v1/sources/export` to `expectedPaths`, then assert operation ID and
the existing TypeBox binary-schema shape under the generated
`application/json` content key: `type: string`, `format: binary`, and
`contentMediaType: application/zip`. The runtime route test remains
authoritative for the real `Content-Type: application/zip` response header.

- [x] **Step 8: Verify API and isolated packaging**

Run: `npx vitest run src/server/api/openapi.test.ts src/server/routes/sources-export.test.ts && npm run build:server && npm run prepare:service && npm run verify:service-isolated`

Expected: all commands PASS and Archiver is present in the isolated service.

- [x] **Step 9: Commit only if authorized**

```bash
git add package.json package-lock.json src/server/routes/sources.ts src/server/routes/sources-export.test.ts src/server/api/openapi.test.ts src/server/sources/repository.ts
git commit -m "feat(api): stream installed sources as zip"
```

Otherwise leave the unit uncommitted.

---

### Task 3: Hosted-Web Binary Download Helper

**Files:**
- Create: `src/web-runtime/download.ts`
- Create: `src/web-runtime/download.test.ts`
- Modify: `src/web-runtime/http.ts`

**Interfaces:**
- Produces: `requestBinaryAttachment(path, fetchImpl?): Promise<{ blob: Blob, filename: string }>`.
- Produces: `downloadBinaryAttachment(path): Promise<void>`.

- [x] **Step 1: Write failing binary request tests**

Use a successful ZIP `Response` and assert:

```ts
await expect(requestBinaryAttachment('/api/v1/sources/export', fetch)).resolves.toMatchObject({
  filename: 'tuneflow-sources-20260816-030405.zip',
})
expect(fetch).toHaveBeenCalledWith('/api/v1/sources/export', { method: 'GET' })
```

Also test fallback filename `tuneflow-sources.zip`, unsafe filename stripping,
JSON error conversion to `WebRuntimeError`, unexpected content type, and fetch
rejection to `NETWORK_ERROR`.

- [x] **Step 2: Prove the module is absent**

Run: `npx vitest run src/web-runtime/download.test.ts`

Expected: FAIL on missing module.

- [x] **Step 3: Share typed error decoding and implement binary fetching**

Export only the reusable API-error decoder from `src/web-runtime/http.ts`; keep
the existing JSON request contract unchanged. `requestBinaryAttachment` must
accept only a successful `application/zip`, parse a quoted ASCII filename,
remove control/path characters, and return `await response.blob()`.

Implement one temporary anchor:

```ts
export const downloadBinaryAttachment = async(path: string): Promise<void> => {
  const { blob, filename } = await requestBinaryAttachment(path)
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.hidden = true
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
```

- [x] **Step 4: Add cleanup tests**

Stub `document`, `URL.createObjectURL`, and `URL.revokeObjectURL`. Assert one
click, anchor removal, and URL revocation; a failed request must create none.

- [x] **Step 5: Run Web-runtime regressions**

Run: `npx vitest run src/web-runtime/download.test.ts src/web-runtime/runtime.test.ts`

Expected: PASS.

- [x] **Step 6: Commit only if authorized**

```bash
git add src/web-runtime/download.ts src/web-runtime/download.test.ts src/web-runtime/http.ts
git commit -m "feat(web): download binary service attachments"
```

Otherwise leave the unit uncommitted.

---

### Task 4: Source-Management Export UI

**Files:**
- Modify: `src/renderer/views/Setting/components/UserApiModal.vue`
- Modify: `src/lang/en-us.json`
- Modify: `src/lang/zh-cn.json`
- Modify: `src/lang/zh-tw.json`
- Create: `src/server/task4Ui.smoke.test.ts`

**Interfaces:**
- Consumes: `downloadBinaryAttachment('/api/v1/sources/export')`.
- Produces: Web-only button `data-testid="user-api-export"`.

- [x] **Step 1: Write the failing Chromium smoke test**

Start a test server with built Web assets. With no sources, assert Export is
visible and disabled. Install one script, reopen the modal, and assert:

```ts
const downloadPromise = page.waitForEvent('download')
await page.getByTestId('user-api-export').click()
const download = await downloadPromise
expect(download.suggestedFilename()).toMatch(/^tuneflow-sources-\d{8}-\d{6}\.zip$/)
const zip = new AdmZip(await download.path())
expect(zip.getEntries()).toHaveLength(1)
expect(zip.getEntries()[0].getData().toString('utf8')).toBe(sourceScript)
```

In a separate case, route the export request to a 500 error and assert a
localized dialog appears and the button returns to enabled.

- [x] **Step 2: Prove the control is absent**

Run: `npx vitest run src/server/task4Ui.smoke.test.ts`

Expected: FAIL because `user-api-export` does not exist.

- [x] **Step 3: Add exact localized copy**

Add adjacent keys, with valid JSON and no comments:

```text
zh-cn: 音源导出失败：{message}
zh-cn: 导出的音源脚本可能包含敏感信息，请妥善保管。
zh-tw: 音源匯出失敗：{message}
zh-tw: 匯出的音源腳本可能包含敏感資訊，請妥善保管。
en-us: Source export failed: {message}
en-us: Exported source scripts may contain sensitive information. Store the archive securely.
```

Use keys `user_api__export_failed` and `user_api__export_sensitive_tip`.

- [x] **Step 4: Enable the Web-only button and busy state**

Replace the commented control with:

```pug
base-btn(v-if="isWebRuntime" data-testid="user-api-export" :class="$style.footerBtn" :disabled="sourceManagementBusy || !apiList.length" @click="handleExport") {{ $t('user_api__btn_export') }}
```

Add `exporting`, derive `sourceManagementBusy` from `saving || exporting`, and
implement `handleExport` with `try/finally`, `downloadBinaryAttachment`, and
the localized error dialog. Disable imports, removal, toggling, and drag while
busy so the inventory cannot mutate during the request. Show the sensitive
warning in the existing note block only for hosted Web.

- [x] **Step 5: Run UI checks**

Run: `npx vitest run src/server/task4Ui.smoke.test.ts src/web-runtime/download.test.ts && npx eslint src/renderer/views/Setting/components/UserApiModal.vue src/web-runtime/download.ts src/web-runtime/download.test.ts src/server/task4Ui.smoke.test.ts`

Expected: PASS with one download and no page errors.

- [x] **Step 6: Commit only if authorized**

```bash
git add src/renderer/views/Setting/components/UserApiModal.vue src/lang/en-us.json src/lang/zh-cn.json src/lang/zh-tw.json src/server/task4Ui.smoke.test.ts
git commit -m "feat(ui): export installed source scripts"
```

Otherwise leave the unit uncommitted.

---

### Task 5: Documentation and Frozen-Tree Verification

**Files:**
- Modify: `docs/server-web.md`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: operator documentation and final evidence.

- [x] **Step 1: Document the boundary**

Add to the source-management documentation:

```md
The hosted Web source manager can export every installed custom source as one
ZIP archive. The archive contains only the persisted JavaScript files; it does
not contain original import URLs, source selection order, enabled state, or a
restore manifest. Treat the archive as sensitive because source scripts can
contain private configuration.
```

- [x] **Step 2: Run focused behavior verification**

Run: `npx vitest run src/server/sources/export.test.ts src/server/sources/source.test.ts src/server/routes/sources-export.test.ts src/server/api/openapi.test.ts src/web-runtime/download.test.ts src/web-runtime/runtime.test.ts src/server/task4Ui.smoke.test.ts`

Expected: all focused tests PASS.

- [x] **Step 3: Run lint and affected builds**

Run: `npx eslint src/server/sources/export.ts src/server/sources/export.test.ts src/server/sources/repository.ts src/server/sources/types.ts src/server/routes/sources.ts src/server/routes/sources-export.test.ts src/server/api/openapi.test.ts src/web-runtime/http.ts src/web-runtime/download.ts src/web-runtime/download.test.ts src/renderer/views/Setting/components/UserApiModal.vue src/server/task4Ui.smoke.test.ts`

Run: `npm run build:server && npm run build:web && npm run prepare:service && npm run verify:service-isolated`

Expected: every command exits 0.

- [x] **Step 4: Review only the scoped diff**

Run: `git diff --check`

Run: `git diff -- package.json package-lock.json src/server/sources src/server/routes/sources.ts src/server/routes/sources-export.test.ts src/server/api/openapi.test.ts src/web-runtime/http.ts src/web-runtime/download.ts src/web-runtime/download.test.ts src/renderer/views/Setting/components/UserApiModal.vue src/lang/en-us.json src/lang/zh-cn.json src/lang/zh-tw.json src/server/task4Ui.smoke.test.ts docs/server-web.md`

Confirm there is no manifest export, URL persistence, Electron change,
filesystem-path response, unrelated refactor, or overwritten user work.
Several target files are already dirty, so stage only reviewed hunks if commit
authorization is later supplied.

- [x] **Step 5: Commit documentation only if authorized**

```bash
git add docs/server-web.md
git commit -m "docs: describe source script export"
```

Otherwise leave it uncommitted and report exact verification results.
