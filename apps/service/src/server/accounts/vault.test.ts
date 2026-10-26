import { mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, symlinkSync, existsSync } from 'node:fs'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountVault } from './vault'
const roots: string[] = []
const password = 'synthetic-fixture-password'
const fixture = async() => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'account-vault-test-')); roots.push(root)
  const vault = new AccountVault(root); await vault.setPassword(password)
  return { root, vault, signedIn: await vault.signIn(password, 'fixture') }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true }) })
describe('server-owned credentials and password access', () => {
  it('encrypts credentials, restricts modes and remembers access across restart without exposing roles or digests', async() => {
    const { root, vault, signedIn } = await fixture()
    vault.put('tx', { cookies: { qqmusic_key: 'synthetic-fixture-credential' } }, 0)
    const bytes = readFileSync(path.join(vault.root, 'vault.enc'))
    for (const secret of ['synthetic-fixture-credential', signedIn.token, password]) expect(bytes.includes(Buffer.from(secret))).toBe(false)
    expect(statSync(vault.root).mode & 0o777).toBe(0o700)
    for (const name of ['vault.enc', 'vault.key']) expect(statSync(path.join(vault.root, name)).mode & 0o777).toBe(0o600)
    const restarted = new AccountVault(root)
    expect(restarted.authorize(signedIn.token).id).toBe(signedIn.device.id)
    expect(restarted.account('tx')?.credential.cookies.qqmusic_key).toBe('synthetic-fixture-credential')
    expect(restarted.passwordConfigured).toBe(true)
    expect(signedIn.device).not.toHaveProperty('role'); expect(signedIn.device).not.toHaveProperty('digest')
    expect(existsSync(vault.setupPath)).toBe(false)
  })
  it('rejects incorrect passwords; logout revokes only the current session', async() => {
    const { vault, signedIn } = await fixture()
    await expect(vault.signIn('incorrect-password', 'fixture')).rejects.toMatchObject({ code: 'INVALID_ACCESS_PASSWORD' })
    const second = await vault.signIn(password, 'second')
    vault.put('tx', { cookies: { qqmusic_key: 'synthetic' } }, 0)
    vault.signOut(vault.authorize(signedIn.token))
    expect(() => vault.authorize(signedIn.token)).toThrow()
    expect(vault.authorize(second.token).id).toBe(second.device.id)
    expect(vault.account('tx')?.credential.cookies.qqmusic_key).toBe('synthetic')
  })
  it('requires the current password to rotate it and invalidates other sessions, preserving platform data', async() => {
    const { root, vault, signedIn } = await fixture()
    const second = await vault.signIn(password, 'second'); const actor = vault.authorize(signedIn.token)
    vault.put('tx', { cookies: { qqmusic_key: 'synthetic' } }, 0)
    await expect(vault.setPassword('replacement-password', actor, 'incorrect')).rejects.toMatchObject({ code: 'INVALID_ACCESS_PASSWORD' })
    expect(vault.authorize(second.token)).toBeTruthy()
    await vault.setPassword('replacement-password', actor, password)
    expect(() => vault.authorize(second.token)).toThrow()
    expect(vault.authorize(signedIn.token)).toBeTruthy()
    await expect(vault.signIn(password, 'third')).rejects.toMatchObject({ code: 'INVALID_ACCESS_PASSWORD' })
    expect((await new AccountVault(root).signIn('replacement-password', 'third')).device.id).toBeTruthy()
    expect(vault.account('tx')?.credential.cookies.qqmusic_key).toBe('synthetic')
  })
  it('migrates an existing member session without losing old sessions or platform credentials', async() => {
    const { root, vault } = await fixture()
    const key = readFileSync(path.join(vault.root, 'vault.key')); const nonce = randomBytes(12)
    const legacyToken = randomBytes(32).toString('base64url'); const ownerToken = randomBytes(32).toString('base64url')
    const digest = (value: string) => createHash('sha256').update(value).digest('hex')
    const state = { version: 1, revision: 7, serverId: 'legacy-instance', devices: [{ id: 'old-owner', name: 'old fixture', role: 'owner', createdAt: 1, digest: digest(ownerToken) }, { id: 'old-member', name: 'legacy fixture', role: 'member', createdAt: 2, digest: digest(legacyToken) }], accounts: { tx: { revision: 7, credential: { cookies: { qqmusic_key: 'legacy-synthetic' } } } } }
    const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from('tuneflow-account-v1'))
    const bytes = Buffer.concat([cipher.update(JSON.stringify(state)), cipher.final()])
    writeFileSync(path.join(vault.root, 'vault.enc'), Buffer.concat([nonce, cipher.getAuthTag(), bytes]))
    const migrated = new AccountVault(root)
    expect(migrated.passwordConfigured).toBe(false)
    await migrated.setPassword(password, migrated.authorize(legacyToken))
    expect(migrated.authorize(legacyToken).id).toBe('old-member'); expect(migrated.authorize(ownerToken).id).toBe('old-owner')
    expect(migrated.revision).toBe(7); expect(migrated.serverId).toBe('legacy-instance')
    expect(migrated.account('tx')?.credential.cookies.qqmusic_key).toBe('legacy-synthetic')
    expect((await new AccountVault(root).signIn(password, 'Web')).device.id).toBeTruthy()
  })
  it('prevents concurrent password initialization from silently overwriting the winning password', async() => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'password-race-')); roots.push(root)
    const vault = new AccountVault(root)
    const result = await Promise.allSettled([vault.setPassword('first-synthetic'), vault.setPassword('second-synthetic')])
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(result.find(item => item.status === 'rejected')).toMatchObject({ reason: { code: 'ACCESS_PASSWORD_CHANGED' } })
  })
  it('keeps account revision guards, fails closed on key loss, and supports offline password recovery', async() => {
    const { root, vault, signedIn } = await fixture()
    vault.put('tx', { cookies: { qqmusic_key: 'synthetic' } }, 0)
    expect(vault.put('tx', undefined, 1)).toBe(2); expect(() => vault.put('tx', { cookies: {} }, 0)).toThrow()
    vault.put('tx', { cookies: { qqmusic_key: 'synthetic-preserved' } }, 2)
    await vault.setPassword('recovered-password')
    expect(() => vault.authorize(signedIn.token)).toThrow()
    expect(vault.account('tx')?.credential.cookies.qqmusic_key).toBe('synthetic-preserved')
    const key = path.join(vault.root, 'vault.key'); unlinkSync(key)
    expect(() => new AccountVault(root)).toThrow('key missing')
    writeFileSync(key, Buffer.alloc(32, 2))
    expect(() => new AccountVault(root)).toThrow('Unable to open')
  })
  it('rejects symbolic links for security files and short passwords', async() => {
    const { root, vault } = await fixture()
    await expect(vault.setPassword('short')).rejects.toMatchObject({ code: 'ACCESS_PASSWORD_LENGTH' })
    const key = path.join(vault.root, 'vault.key'); unlinkSync(key); symlinkSync(path.join(root, 'untrusted-key'), key)
    expect(() => new AccountVault(root)).toThrow('Unsafe account storage')
  })
})
