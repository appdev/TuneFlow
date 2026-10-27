import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

interface VersionMetadata {
  version: string
  desc: string
  history: Array<{ version: string, desc: string }>
  commit?: string
}

const readJson = async<T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8'))

const assertUsefulReleaseNotes = (metadata: VersionMetadata, expectedVersion: string) => {
  assert.equal(metadata.version, expectedVersion)
  assert.ok(metadata.desc.trim().length >= 80)
  assert.match(metadata.desc, new RegExp(`(?:^|\\s)${expectedVersion.replaceAll('.', '\\.')}\\b`))
  assert.doesNotMatch(metadata.desc.trim(), /^\*\*Full Changelog\*\*:/i)

  const historyVersions = metadata.history.map(item => item.version)
  assert.equal(new Set(historyVersions).size, historyVersions.length)
  assert.ok(!historyVersions.includes(expectedVersion))
}

test('桌面、Android 和 Service 使用统一版本及版本说明', async() => {
  const packageInfo = await readJson<{ version: string }>('package.json')
  const androidPackage = await readJson<{ version: string }>('../android/package.json')
  const servicePackage = await readJson<{ version: string }>('../service/package.json')
  const desktopMetadata = await readJson<VersionMetadata>('publish/version.json')
  const mobileMetadata = await readJson<VersionMetadata>('publish/mobile-version.json')
  const releaseNotes = await readFile(`../service/docs/releases/${packageInfo.version}.md`, 'utf8')

  assert.equal(androidPackage.version, packageInfo.version)
  assert.equal(servicePackage.version, packageInfo.version)
  assertUsefulReleaseNotes(desktopMetadata, packageInfo.version)
  assertUsefulReleaseNotes(mobileMetadata, packageInfo.version)
  assert.match(mobileMetadata.commit ?? '', /^[a-f\d]{7,40}$/)
  assert.ok(releaseNotes.trim().length >= 80)
  assert.match(releaseNotes, new RegExp(`^# TuneFlow ${packageInfo.version.replaceAll('.', '\\.')}$`, 'm'))
})

test('发布工作流只允许带人工说明的 Release 流程', async() => {
  const windowsWorkflow = await readFile('.github/workflows/release-windows.yml', 'utf8')
  const androidWorkflow = await readFile('.github/workflows/release-android.yml', 'utf8')
  const archWorkflow = await readFile('.github/workflows/build-arch.yml', 'utf8')

  assert.match(windowsWorkflow, /--notes-file/)
  assert.match(windowsWorkflow, /--verify-tag/)
  assert.match(windowsWorkflow, /--draft/)
  assert.match(windowsWorkflow, /q-music-managed-release/)
  assert.doesNotMatch(windowsWorkflow, /--generate-notes/)
  assert.match(windowsWorkflow, /if \(\$mobileVersion -eq \$env:PACKAGE_VERSION\)/)
  assert.match(windowsWorkflow, /'SHA256SUMS-android.txt'/)
  assert.match(windowsWorkflow, /'SHA256SUMS-arch.txt'/)
  assert.doesNotMatch(androidWorkflow, /gh\s+release\s+create/)
  assert.doesNotMatch(archWorkflow, /gh\s+release\s+create/)
  assert.match(androidWorkflow, /release_notes_are_human/)
  assert.doesNotMatch(androidWorkflow, /push:\s*\n\s*tags:/)
  assert.match(archWorkflow, /release_notes_are_human/)
})
