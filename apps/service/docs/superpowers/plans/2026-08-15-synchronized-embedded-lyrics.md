# Synchronized Embedded Lyrics Implementation Plan

> **For agentic workers:** Use the global `workflow` skill's existing-plan execution entry. Review this plan against current evidence; when it is sound, enter execution directly. Only when material problems are found should `workflow` return to research, ideation, and planning to supplement this same plan before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve embedded lyric timestamps when deriving Service library resources so existing Flutter active-line scrolling works for timed files.

**Architecture:** Keep the correction inside `LibraryResourceStore`: convert valid `music-metadata` `syncText` entries to standard LRC before falling back to plain embedded text or a sidecar. Add a derivation revision to the marker signature so existing cached plain lyrics are regenerated exactly once.

**Tech Stack:** TypeScript, `music-metadata` `ILyricsTag`, Vitest, Node.js filesystem APIs, Docker Service runtime, Flutter macOS runtime verification.

## Global Constraints

- Do not synthesize or estimate lyric timestamps.
- Do not mutate source audio metadata.
- Preserve embedded-lyrics-first and sidecar-fallback behavior.
- Preserve cover extraction, atomic writes, reconciliation, and warm-cache reuse.
- Do not change Flutter unless Service-side verification proves a separate client defect.
- Preserve unrelated dirty-worktree changes and do not commit, push, or publish without explicit authorization.

---

### Task 1: Serialize synchronized embedded lyrics

**Files:**
- Modify: `src/server/library/resources.ts`
- Test: `src/server/library/resources.test.ts`

**Interfaces:**
- Consumes: `IAudioMetadata.common.lyrics?: ILyricsTag[]`, where each valid `syncText` entry has `timestamp: number` in milliseconds and `text: string`.
- Produces: a private pure formatter returning `[mm:ss.mmm]text` lines and the existing `{ relativePath, text }` derived lyric resource.

- [ ] **Step 1: Add a failing synchronized-lyrics test**

Add a test whose parser result contains both stripped `text` and two `syncText`
entries, including a timestamp beyond one hour:

```ts
lyrics: [{
  contentType: 1,
  timeStampFormat: 2,
  text: 'First\nSecond',
  syncText: [
    { timestamp: 1_230, text: 'First' },
    { timestamp: 3_661_004, text: 'Second' },
  ],
}],
```

Assert the derived file is exactly:

```text
[00:01.230]First
[61:01.004]Second
```

- [ ] **Step 2: Run the focused test and observe the expected failure**

Run:

```bash
npx vitest run src/server/library/resources.test.ts -t "preserves synchronized embedded lyric timestamps"
```

Expected: FAIL because the current implementation writes `text` without time
labels.

- [ ] **Step 3: Implement minimal synchronized lyric serialization**

In `resources.ts`, add small private-module helpers equivalent to:

```ts
const formatLrcTimestamp = (timestamp: number): string => {
  const total = Math.max(0, Math.trunc(timestamp))
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor(total % 60_000 / 1_000)
  const milliseconds = total % 1_000
  return `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}]`
}
```

Select the first lyric tag with at least one entry whose timestamp is finite,
non-negative, and whose text is a string. Serialize those valid entries in
their provided order. Only if no tag has valid synchronized entries, select the
first non-empty `tag.text`, then retain the existing sidecar fallback and BOM
trimming.

- [ ] **Step 4: Run the focused test and the resource-store suite**

Run:

```bash
npx vitest run src/server/library/resources.test.ts
```

Expected: all `LibraryResourceStore` tests PASS, including the new synchronized
lyrics case and the existing plain-text, sidecar, cover, and reconciliation
cases.

### Task 2: Invalidate legacy derived-resource markers once

**Files:**
- Modify: `src/server/library/resources.ts`
- Test: `src/server/library/resources.test.ts`

**Interfaces:**
- Consumes: the current marker signature inputs: audio size, audio mtime, sidecar size, and sidecar mtime.
- Produces: a revised signature beginning with a fixed derivation revision such as `2\0`; old markers fail equality and are regenerated, while revised markers remain reusable after restart.

- [ ] **Step 1: Add a failing legacy-marker migration test**

Create one audio file and derive its resources. Rewrite the single marker JSON
in `library-resource-index` so `signature` has the legacy form
`${stat.size}\0${stat.mtimeMs}\0missing`. Construct a restarted store with a
parser spy that returns synchronized lyrics, call `ensure`, and assert the spy
was called once and the derived file contains time labels. Construct a second
restarted store whose parser throws, call `ensure`, and assert the revised cache
is reused successfully.

- [ ] **Step 2: Run the migration test and observe the expected failure**

Run:

```bash
npx vitest run src/server/library/resources.test.ts -t "reparses legacy resource markers once"
```

Expected: FAIL because the current signature is identical to the manually
restored legacy signature, so parsing is skipped.

- [ ] **Step 3: Add the derivation revision to the signature**

Define one module-level constant:

```ts
const resourceDerivationRevision = '2'
```

Build signatures as
`${resourceDerivationRevision}\0${stat.size}\0${stat.mtimeMs}\0${sidecarSignature}`.
Do not delete markers eagerly; let the existing atomic replacement path update
them after successful parsing.

- [ ] **Step 4: Run focused tests, type/build checks, and lint on touched files**

Run:

```bash
npx vitest run src/server/library/resources.test.ts
npm run build:server
npx eslint src/server/library/resources.ts src/server/library/resources.test.ts
```

Expected: every command exits 0.

### Task 3: Freeze and deploy the corrected Service

**Files:**
- Read/verify: repository worktree and `compose.yaml`
- Runtime mutation: authorized Docker host `192.168.0.172`, active Service on port `3124`

**Interfaces:**
- Consumes: the verified workspace tree after Tasks 1–2.
- Produces: a healthy replacement container using the existing persistent volume, with the previous container/image retained for rollback.

- [ ] **Step 1: Review the final diff and freeze the workspace fingerprint**

Verify only the intended synchronized-lyrics implementation/tests plus existing
authorized workspace changes enter the deployment context. Record the complete
workspace fingerprint and build-context fingerprint using the repository's
existing deployment workflow.

- [ ] **Step 2: Build and isolate-probe the candidate image**

Use the `deploy-qingyu-docker` skill. Build a uniquely tagged candidate, verify
architecture/runtime user/native modules, and run an isolated container health
probe before touching production.

- [ ] **Step 3: Atomically switch with rollback preserved**

Reuse `lx-music-server-web-data:/data`, retain the prior healthy container as
the rollback target, and preserve restart policy, init, user, and port `3124`.

- [ ] **Step 4: Verify Service behavior at the LAN boundary**

Assert:

```text
GET /api/v1/health -> 200 and status ok
GET /api/v1/library/tracks -> “挪威的森林” has lyricsUrl
GET that lyricsUrl -> 55 standard LRC time labels
active container -> running/healthy and RestartCount=0
```

Also verify a second library read reuses the revised marker without changing
the derived lyric file timestamp or checksum.

### Task 4: Verify macOS lyric following end to end

**Files:**
- Runtime only: `/Volumes/ext/MusicFree/flutter-client`

**Interfaces:**
- Consumes: Service origin `http://192.168.0.172:3124` returning timed LRC.
- Produces: user-visible evidence that the existing Flutter client highlights and follows playback position.

- [ ] **Step 1: Start the latest macOS debug client without modifying Flutter**

Use the current workspace build and existing persisted Service origin. Open
“挪威的森林” and enter the lyric view.

- [ ] **Step 2: Verify timestamp-boundary behavior**

Seek to just before a known returned LRC timestamp, then cross it during
playback. Confirm the active lyric changes and the list scrolls to keep the new
line near its configured alignment. Repeat across a second, non-adjacent
timestamp.

- [ ] **Step 3: Verify restart persistence**

Exit normally, relaunch, reopen the same track, and confirm timed lyrics still
render and follow progress. Record Service health, client connection, and UI
evidence. If the API contains 55 time labels but Flutter fails these checks,
stop and report a separate client defect instead of adding heuristic timing.
