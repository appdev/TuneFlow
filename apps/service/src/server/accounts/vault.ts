import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createDecipheriv, randomUUID } from 'node:crypto'
import path from 'node:path'
import { ApiError } from '../errors'
import type { MusicAccountProvider } from '../../../../../packages/platform-accounts/src/reader'

export interface AccountCredential { cookies: Record<string, string>, kugou?: unknown, dailyKey?: string }
interface State { version: 2, serverId: string, revision: number, accounts: Partial<Record<MusicAccountProvider, { revision: number, credential: AccountCredential }>> }

// Shared server-owned account storage. Legacy encrypted files are read only for migration.
export class AccountVault {
  readonly root: string
  private state: State
  constructor(configRoot: string) {
    this.root = path.join(configRoot, 'account-security')
    if (existsSync(this.root) && lstatSync(this.root).isSymbolicLink()) throw new Error('Unsafe account storage')
    mkdirSync(this.root, { recursive: true, mode: 0o700 }); chmodSync(this.root, 0o700)
    const statePath = path.join(this.root, 'accounts.json')
    const legacyPath = path.join(this.root, 'vault.enc')
    const keyPath = path.join(this.root, 'vault.key')
    for (const file of [statePath, legacyPath, keyPath]) {
      const entry = lstatSync(file, { throwIfNoEntry: false })
      if (entry && !entry.isFile()) throw new Error('Unsafe account storage')
    }
    if (existsSync(statePath)) {
      try { this.state = this.readState(JSON.parse(readFileSync(statePath, 'utf8')), 2) } catch { throw new Error('Unable to read account storage; preserve accounts.json for recovery') }
      chmodSync(statePath, 0o600)
    } else if (existsSync(legacyPath)) {
      if (!existsSync(keyPath)) throw new Error('Account vault key missing; restore the original key for migration')
      try {
        const key = readFileSync(keyPath); const bytes = readFileSync(legacyPath)
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
        decipher.setAAD(Buffer.from('tuneflow-account-v1')); decipher.setAuthTag(bytes.subarray(12, 28))
        this.state = this.readState(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString()), 1)
      } catch { throw new Error('Unable to migrate account vault; preserve vault and key for recovery') }
      this.save(this.state)
    } else {
      this.state = { version: 2, serverId: randomUUID(), revision: 0, accounts: {} }
      this.save(this.state)
    }
  }

  private readState(value: any, version: number): State {
    if (value?.version !== version || typeof value.serverId !== 'string' || !value.serverId || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.accounts || typeof value.accounts !== 'object' || Array.isArray(value.accounts)) throw new Error('Invalid account state')
    for (const [provider, account] of Object.entries(value.accounts)) {
      if (!['tx', 'wy', 'kg'].includes(provider) || !Number.isSafeInteger(account?.revision) || account.revision < 0 || !account.credential?.cookies || typeof account.credential.cookies !== 'object' || Array.isArray(account.credential.cookies) || Object.values(account.credential.cookies).some(cookie => typeof cookie !== 'string')) throw new Error('Invalid account state')
    }
    return { version: 2, serverId: value.serverId, revision: value.revision, accounts: value.accounts }
  }

  get revision() { return this.state.revision }
  get serverId() { return this.state.serverId }
  private save(next: State) {
    const temporary = path.join(this.root, `.${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 })
      const fd = openSync(temporary, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temporary, path.join(this.root, 'accounts.json'))
      const directory = openSync(this.root, 'r'); try { fsyncSync(directory) } finally { closeSync(directory) }
      this.state = next
    } finally { rmSync(temporary, { force: true }) }
  }

  account(provider: MusicAccountProvider) { return structuredClone(this.state.accounts[provider]) }
  put(provider: MusicAccountProvider, credential: AccountCredential | undefined, expectedRevision: number) {
    if ((this.state.accounts[provider]?.revision ?? 0) !== expectedRevision) throw new ApiError(409, 'ACCOUNT_CHANGED', 'Account changed; retry with the current account')
    const revision = this.revision + 1
    // Keep a tombstone revision on logout to reject old in-flight authorizations.
    this.save({ ...this.state, revision, accounts: { ...this.state.accounts, [provider]: { revision, credential: credential ?? { cookies: {} } } } })
    return revision
  }
}
