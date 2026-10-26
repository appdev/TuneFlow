import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { ApiError } from '../errors'
import type { MusicAccountProvider } from '../../../../../packages/platform-accounts/src/reader'

export interface AccountCredential { cookies: Record<string, string>, kugou?: unknown, dailyKey?: string }
// Legacy role fields remain readable for image rollback, but no longer grant permissions.
export interface Device { id: string, name: string, role?: 'owner' | 'member', createdAt: number, digest: string }
interface PasswordHash { salt: string, hash: string }
interface State { version: 1, serverId: string, revision: number, password?: PasswordHash, devices: Device[], accounts: Partial<Record<MusicAccountProvider, { revision: number, credential: AccountCredential }>> }
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const equal = (left: string, right: string) => timingSafeEqual(Buffer.from(digest(left)), Buffer.from(digest(right)))
const denied = () => new ApiError(401, 'DEVICE_AUTH_REQUIRED', 'Authorize this device first')
let passwordJobs = 0
const passwordKey = async(password: string, salt: string): Promise<Buffer> => {
  if (passwordJobs >= 2) throw new ApiError(429, 'ACCOUNT_RATE_LIMIT', 'Retry later')
  passwordJobs++
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => { if (error) reject(error); else resolve(key) })
    })
  } finally { passwordJobs-- }
}
export const publicDevice = ({ id, name, createdAt }: Device) => ({ id, name, createdAt })

// Separate from settings/database exports. This protects stored files, not a host
// compromise: the application-owned key must be backed up/protected separately.
export class AccountVault {
  readonly root: string
  private readonly key: Buffer
  private state: State
  constructor(configRoot: string) {
    this.root = path.join(configRoot, 'account-security')
    if (existsSync(this.root) && lstatSync(this.root).isSymbolicLink()) throw new Error('Unsafe account storage')
    mkdirSync(this.root, { recursive: true, mode: 0o700 }); chmodSync(this.root, 0o700)
    const keyPath = path.join(this.root, 'vault.key')
    const statePath = path.join(this.root, 'vault.enc')
    for (const file of [keyPath, statePath, this.setupPath]) {
      const entry = lstatSync(file, { throwIfNoEntry: false })
      if (entry && !entry.isFile()) throw new Error('Unsafe account storage')
    }
    if (!existsSync(keyPath)) {
      if (existsSync(statePath)) throw new Error('Account vault key missing; restore the original key')
      writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 })
    }
    this.key = readFileSync(keyPath)
    if (this.key.length !== 32) throw new Error('Invalid account vault key')
    chmodSync(keyPath, 0o600)
    if (existsSync(statePath)) {
      try {
        const bytes = readFileSync(statePath)
        const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12))
        decipher.setAAD(Buffer.from('tuneflow-account-v1')); decipher.setAuthTag(bytes.subarray(12, 28))
        this.state = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString())
        if (this.state.version !== 1 || !Array.isArray(this.state.devices)) throw new Error()
        if (this.state.password && (!/^[a-f0-9]{32}$/.test(this.state.password.salt) || !/^[a-f0-9]{64}$/.test(this.state.password.hash))) throw new Error()
      } catch { throw new Error('Unable to open account vault; preserve vault and key for recovery') }
    } else {
      this.state = { version: 1, serverId: randomUUID(), revision: 0, devices: [], accounts: {} }
      this.save(this.state)
    }
    // Old setup codes are no longer usable; existing device sessions stay valid.
    rmSync(this.setupPath, { force: true })
  }

  get setupPath() { return path.join(this.root, 'setup-code') }
  get revision() { return this.state.revision }
  get serverId() { return this.state.serverId }
  get passwordConfigured() { return Boolean(this.state.password) }
  private atomic(file: string, value: string | Buffer) {
    const temporary = path.join(this.root, `.${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, value, { flag: 'wx', mode: 0o600 })
      const fd = openSync(temporary, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temporary, file)
      const directory = openSync(this.root, 'r'); try { fsyncSync(directory) } finally { closeSync(directory) }
    } finally { rmSync(temporary, { force: true }) }
  }

  private save(next: State) {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce)
    cipher.setAAD(Buffer.from('tuneflow-account-v1'))
    const bytes = Buffer.concat([cipher.update(JSON.stringify(next)), cipher.final()])
    this.atomic(path.join(this.root, 'vault.enc'), Buffer.concat([nonce, cipher.getAuthTag(), bytes]))
    this.state = next
  }

  authorize(token: string | undefined): Device {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw denied()
    const device = this.state.devices.find(item => equal(item.digest, digest(token)))
    if (!device) throw denied()
    return device
  }

  private async matches(password: string, saved: PasswordHash) {
    if (!password || password.length > 128) return false
    return timingSafeEqual(await passwordKey(password, saved.salt), Buffer.from(saved.hash, 'hex'))
  }

  async signIn(password: string, name: string) {
    const saved = this.state.password
    if (!saved) throw new ApiError(409, 'ACCESS_PASSWORD_NOT_CONFIGURED', 'Set an access password locally or from an existing session')
    if (!await this.matches(password, saved)) throw new ApiError(401, 'INVALID_ACCESS_PASSWORD', 'Incorrect access password')
    if (this.state.password !== saved) throw new ApiError(409, 'ACCESS_PASSWORD_CHANGED', 'Access password changed; retry')
    if (this.state.devices.length >= 64) throw new ApiError(409, 'DEVICE_LIMIT', 'Revoke an unused device first')
    const token = randomBytes(32).toString('base64url')
    const device: Device = { id: randomUUID(), name: name.trim().slice(0, 80) || '应用', role: 'member', createdAt: Date.now(), digest: digest(token) }
    this.save({ ...this.state, devices: [...this.state.devices, device] })
    return { token, serverId: this.serverId, device: publicDevice(device) }
  }

  // Routes always supply an authenticated actor. Only the offline recovery CLI omits it.
  async setPassword(password: string, actor?: Device, currentPassword?: string) {
    if (password.length < 8 || password.length > 128 || !password.trim() || Array.from(password).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new ApiError(400, 'ACCESS_PASSWORD_LENGTH', 'Use 8 to 128 characters')
    const saved = this.state.password
    if (actor && saved && !await this.matches(currentPassword ?? '', saved)) throw new ApiError(401, 'INVALID_ACCESS_PASSWORD', 'Incorrect access password')
    const salt = randomBytes(16).toString('hex')
    const hash = (await passwordKey(password, salt)).toString('hex')
    if (this.state.password !== saved) throw new ApiError(409, 'ACCESS_PASSWORD_CHANGED', 'Access password changed; retry')
    if (actor && !this.state.devices.some(device => device.id === actor.id && device.digest === actor.digest)) throw denied()
    const devices = actor ? (saved ? this.state.devices.filter(device => device.id === actor.id) : this.state.devices) : []
    this.save({ ...this.state, password: { salt, hash }, devices })
  }

  signOut(actor: Device) {
    this.save({ ...this.state, devices: this.state.devices.filter(device => device.id !== actor.id) })
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
