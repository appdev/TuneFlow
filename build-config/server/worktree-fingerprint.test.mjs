import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { createWorktreeManifest } from './worktree-fingerprint.mjs'

const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('createWorktreeManifest', () => {
  it('hashes tracked and non-ignored untracked bytes but excludes ignored artifacts', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'lx-fingerprint-'))
    roots.push(root)
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    writeFileSync(path.join(root, '.gitignore'), 'ignored/\n')
    writeFileSync(path.join(root, 'tracked.txt'), 'tracked-v1')
    execFileSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: root })
    writeFileSync(path.join(root, 'untracked.txt'), 'untracked-v1')
    execFileSync('mkdir', ['-p', path.join(root, 'ignored')])
    writeFileSync(path.join(root, 'ignored/artifact.txt'), 'artifact-v1')

    const initial = createWorktreeManifest(root)
    assert.match(initial, /\t"tracked\.txt"\n/)
    assert.match(initial, /\t"untracked\.txt"\n/)
    assert.doesNotMatch(initial, /ignored\/artifact\.txt/)
    assert.equal(createWorktreeManifest(root), initial)

    writeFileSync(path.join(root, 'untracked.txt'), 'untracked-v2')
    assert.notEqual(createWorktreeManifest(root), initial)
  })

  it('omits tracked files deleted from the worktree', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'lx-fingerprint-'))
    roots.push(root)
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    writeFileSync(path.join(root, 'deleted.txt'), 'tracked-before-removal')
    writeFileSync(path.join(root, 'present.txt'), 'tracked-and-present')
    execFileSync('git', ['add', 'deleted.txt', 'present.txt'], { cwd: root })
    rmSync(path.join(root, 'deleted.txt'))

    const manifest = createWorktreeManifest(root)
    assert.doesNotMatch(manifest, /deleted\.txt/)
    assert.match(manifest, /\t"present\.txt"\n/)
  })
})
