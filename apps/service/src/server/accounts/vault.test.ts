import { mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, symlinkSync, existsSync, mkdirSync } from 'node:fs'
import { createCipheriv, randomBytes } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountVault } from './vault'
const roots: string[] = []
const fixture = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'account-store-test-')); roots.push(root)
  return { root, vault: new AccountVault(root) }
}
const legacy = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'account-migration-test-')); roots.push(root)
  const directory = path.join(root, 'account-security'); mkdirSync(directory)
  const key = randomBytes(32); const nonce = randomBytes(12)
  const state = { version: 1, serverId: 'legacy-server', revision: 7, password: { salt: 'obsolete', hash: 'obsolete' }, devices: [{ id: 'old-device' }], accounts: { tx: { revision: 7, credential: { cookies: { qqmusic_key: 'synthetic-preserved' }, dailyKey: 'synthetic-daily' } } } }
  const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from('tuneflow-account-v1'))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(state)), cipher.final()])
  writeFileSync(path.join(directory, 'vault.key'), key)
  writeFileSync(path.join(directory, 'vault.enc'), Buffer.concat([nonce, cipher.getAuthTag(), encrypted]))
  return { root, directory }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true }) })
describe('shared account storage', () => {
  it('saves credentials directly without a password or encryption key and retains them on restart', () => {
    const { root, vault } = fixture()
    vault.put('tx', { cookies: { qqmusic_key: 'synthetic-fixture' } }, 0)
    expect(JSON.parse(readFileSync(path.join(vault.root, 'accounts.json'), 'utf8')).accounts.tx.credential.cookies.qqmusic_key).toBe('synthetic-fixture')
    expect(existsSync(path.join(vault.root, 'vault.key'))).toBe(false)
    expect(existsSync(path.join(vault.root, 'vault.enc'))).toBe(false)
    const restarted = new AccountVault(root)
    expect(restarted.serverId).toBe(vault.serverId)
    expect(restarted.account('tx')).toEqual(vault.account('tx'))
    expect(statSync(vault.root).mode & 0o777).toBe(0o700)
    expect(statSync(path.join(vault.root, 'accounts.json')).mode & 0o777).toBe(0o600)
  })
  it('automatically migrates old encrypted accounts, drops password/session data and preserves original files', () => {
    const { root, directory } = legacy()
    const original = readFileSync(path.join(directory, 'vault.enc'))
    const vault = new AccountVault(root)
    expect(vault.serverId).toBe('legacy-server'); expect(vault.revision).toBe(7)
    expect(vault.account('tx')?.credential).toEqual({ cookies: { qqmusic_key: 'synthetic-preserved' }, dailyKey: 'synthetic-daily' })
    const migrated = JSON.parse(readFileSync(path.join(directory, 'accounts.json'), 'utf8'))
    expect(migrated.version).toBe(2); expect(migrated.password).toBeUndefined(); expect(migrated.devices).toBeUndefined()
    expect(readFileSync(path.join(directory, 'vault.enc'))).toEqual(original)
    vault.put('tx', undefined, 7)
    unlinkSync(path.join(directory, 'vault.key'))
    expect(new AccountVault(root).account('tx')?.credential.cookies).toEqual({})
  })
  it('preserves revisions and rejects stale account changes', () => {
    const { root, vault } = fixture()
    vault.put('tx', { cookies: { qqmusic_key: 'synthetic' } }, 0)
    expect(vault.put('tx', undefined, 1)).toBe(2)
    expect(() => vault.put('tx', { cookies: {} }, 0)).toThrow()
    expect(new AccountVault(root).revision).toBe(2)
  })
  it('never resets legacy data when its key is missing or corrupted', () => {
    const { root, directory } = legacy()
    unlinkSync(path.join(directory, 'vault.key'))
    expect(() => new AccountVault(root)).toThrow('key missing')
    expect(existsSync(path.join(directory, 'accounts.json'))).toBe(false)
    writeFileSync(path.join(directory, 'vault.key'), Buffer.alloc(32, 2))
    expect(() => new AccountVault(root)).toThrow('Unable to migrate')
    expect(existsSync(path.join(directory, 'accounts.json'))).toBe(false)
  })
  it('fails on malformed new storage instead of falling back to outdated legacy accounts', () => {
    const { root, directory } = legacy()
    new AccountVault(root)
    writeFileSync(path.join(directory, 'accounts.json'), '{}')
    expect(() => new AccountVault(root)).toThrow('Unable to read')
  })
  it('rejects symlinks in account storage', () => {
    const { root, vault } = fixture()
    unlinkSync(path.join(vault.root, 'accounts.json'))
    symlinkSync(path.join(root, 'untrusted'), path.join(vault.root, 'accounts.json'))
    expect(() => new AccountVault(root)).toThrow('Unsafe account storage')
  })
})
