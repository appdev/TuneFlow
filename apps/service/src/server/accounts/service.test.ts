import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { AccountVault } from './vault'
import { PlatformAccounts, type AccountReader } from './service'

it('rejects a mixed status snapshot if another provider changes during a slow read', async() => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'account-snapshot-test-'))
  try {
    const vault = new AccountVault(root)
    vault.put('tx', { cookies: { qqmusic_key: 'synthetic' } }, 0)
    vault.put('wy', { cookies: { MUSIC_U: 'synthetic' } }, 0)
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    const account = { state: 'connected' as const, displayName: 'Fixture', avatar: '', accountHint: '', hasSession: true }
    const accounts = new PlatformAccounts(vault, () => {}, provider => {
      const reader: Partial<AccountReader> = {
        getMusicAccountStatus: async() => {
          if (provider === 'wy') await wait
          return { tx: true, wy: true, kg: false, accounts: { tx: account, wy: account, kg: account } }
        },
      }
      return reader as AccountReader
    })
    const reading = accounts.status()
    await Promise.resolve(); await Promise.resolve()
    vault.put('tx', undefined, 1)
    release()
    await expect(reading).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('returns only an opaque sync identity after a favorite operation', async() => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'account-favorite-test-'))
  try {
    const reader: Partial<AccountReader> = { addQQFavoriteSong: async() => ({ status: 'added', owner: 'synthetic-private-owner', accountId: 'synthetic-private-identity' }) }
    const accounts = new PlatformAccounts(new AccountVault(root), () => {}, () => reader as AccountReader)
    const result = await accounts.favorite({ songMid: 'fixtureMid', action: 'check' }, 0, () => {})
    expect(result.status).toBe('added'); expect(result.accountId).toMatch(/^[a-f0-9]{32}$/)
    expect(JSON.stringify(result)).not.toMatch(/synthetic-private|owner/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
