import { createHash } from 'node:crypto'
import { createAccountReader, type MusicAccountProvider, type MusicAccountProfile } from '../../../../../packages/platform-accounts/src/reader'
import { createKugouApi, parseKugouSession } from '../../../../../packages/platform-accounts/src/kugouAccount'
import { type AccountVault, type AccountCredential } from './vault'
import { OfficialHttp, sanitizeCredential } from './officialHttp'
import { ApiError } from '../errors'
import { toNewMusicInfo } from '../../common/utils/tools'
import txInfo from '../../renderer/utils/musicSdk/tx/musicInfo'
import txLists from '../../renderer/utils/musicSdk/tx/songList'
import wyDetail from '../../renderer/utils/musicSdk/wy/musicDetail'
import kgLists from '../../renderer/utils/musicSdk/kg/songList'
import type { QQFavoriteRequest } from '../../../../../packages/platform-accounts/src/qqFavorite'

export const providers = ['tx', 'wy', 'kg'] as const
const empty = () => ({ state: 'disconnected' as const, displayName: '', avatar: '', accountHint: '', hasSession: false })
export type AccountReader = ReturnType<typeof createAccountReader>
export const makeReader = (provider: MusicAccountProvider, credential: AccountCredential, assert: () => void = () => {}): AccountReader => {
  const http = new OfficialHttp(provider, credential)
  const fetchOfficial: typeof fetch = async(input, init) => { assert(); return http.fetch(input, init) }
  const kg = parseKugouSession(credential.kugou)
  const api = createKugouApi(fetchOfficial, value => createHash('md5').update(value).digest('hex'))
  const needKg = () => { if (!kg) throw new Error('login_required'); return kg }
  return createAccountReader({
    session: async() => ({ fetch: fetchOfficial, cookies: { get: async(filter) => { assert(); return http.cookies(filter.url) } } }),
    credential: name => name === 'qqDailyApiKey' ? credential.dailyKey ?? '' : '',
    kugou: {
      session: () => kg,
      playlists: async() => (await api.getPlaylists(needKg())).map(item => ({ ...item, id: `account:${kg!.userId}:${item.id}`, trackCount: item.count, creator: kg!.nickname })),
      daily: async() => api.getDailyHashes(needKg()),
      detail: async id => {
        const match = /^account:(\d+):(\d+)$/.exec(id)
        if (!match || match[1] !== needKg().userId) throw new Error('account_changed')
        return api.getPlaylistHashes(needKg(), match[2])
      },
    },
  })
}

const safeTrack = (legacy: unknown): TuneFlow.Music.MusicInfo => {
  const song = toNewMusicInfo(legacy) as TuneFlow.Music.MusicInfoOnline
  const meta: Record<string, unknown> = {}
  for (const key of ['songId', 'id', 'albumId', 'albumName', 'albumMid', 'strMediaMid', 'hash']) {
    const value = song.meta?.[key as keyof typeof song.meta]
    if (typeof value === 'string' || typeof value === 'number') meta[key] = value
  }
  const qualitys = Array.isArray(song.meta?.qualitys) ? song.meta.qualitys.filter(item => ['128k', '320k', 'flac', 'flac24bit'].includes(item.type)).map(item => ({ type: item.type, size: typeof item.size === 'string' ? item.size : null })) : []
  meta.qualitys = qualitys; meta._qualitys = Object.fromEntries(qualitys.map(item => [item.type, { size: item.size }]))
  const track: TuneFlow.Music.MusicInfoOnline = { id: song.id, source: song.source, name: song.name, singer: song.singer, interval: song.interval, meta: meta as TuneFlow.Music.MusicInfoOnline['meta'] }
  return track
}
const boundedMap = async<T, R>(items: T[], map: (item: T) => Promise<R>) => {
  let index = 0; const output: R[] = new Array(items.length)
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async() => { while (index < items.length) { const at = index++; output[at] = await map(items[at]) } }))
  return output
}

export class PlatformAccounts {
  private readonly statuses = new Map<MusicAccountProvider, { revision: number, until: number, profile: MusicAccountProfile }>()
  private readonly dailyCache = new Map<MusicAccountProvider, { revision: number, until: number, value: Awaited<ReturnType<PlatformAccounts['readDaily']>> }>()
  private readonly dailyPending = new Map<string, Promise<Awaited<ReturnType<PlatformAccounts['readDaily']>>>>()
  constructor(readonly vault: AccountVault, private readonly publish: (provider: MusicAccountProvider, revision: number) => void, private readonly reader = makeReader) {}
  private snapshot(provider: MusicAccountProvider, guard: () => void = () => {}) {
    const entry = this.vault.account(provider)
    const credential = entry?.credential ?? { cookies: {} }
    const revision = entry?.revision ?? 0
    const assert = () => { guard(); if ((this.vault.account(provider)?.revision ?? 0) !== revision) throw new ApiError(409, 'ACCOUNT_CHANGED', 'Account changed during the request') }
    return { credential, revision, assert, reader: this.reader(provider, credential, assert) }
  }

  async status(force = false) {
    const revision = this.vault.revision
    const profiles = await Promise.all(providers.map(async provider => {
      const snapshot = this.snapshot(provider)
      if (!Object.keys(snapshot.credential.cookies).length && !snapshot.credential.kugou) return empty()
      const cached = this.statuses.get(provider)
      if (!force && cached?.revision === snapshot.revision && cached.until > Date.now()) return cached.profile
      const result = await snapshot.reader.getMusicAccountStatus(); snapshot.assert()
      const profile = result.accounts[provider]
      if (provider === 'kg' && profile.state === 'connected') {
        const lists = await snapshot.reader.getMusicAccountPlaylists(provider); snapshot.assert()
        if (lists.status !== 'available') profile.state = lists.status === 'login_required' ? 'expired' : 'unavailable'
      }
      this.statuses.set(provider, { revision: snapshot.revision, until: Date.now() + 30_000, profile })
      if (cached && cached.profile.state !== profile.state) { this.dailyCache.delete(provider); this.publish(provider, snapshot.revision) }
      return profile
    }))
    if (revision !== this.vault.revision) throw new ApiError(409, 'ACCOUNT_CHANGED', 'Account changed while reading status')
    const accounts = Object.fromEntries(providers.map((provider, index) => [provider, profiles[index]]))
    return { serverId: this.vault.serverId, revision: this.vault.revision, tx: accounts.tx.state === 'connected', wy: accounts.wy.state === 'connected', kg: accounts.kg.state === 'connected', accounts }
  }

  async upload(provider: MusicAccountProvider, value: AccountCredential, expectedRevision: number, guard: () => void) {
    if ((this.vault.account(provider)?.revision ?? 0) !== expectedRevision) throw new ApiError(409, 'ACCOUNT_CHANGED', 'Refresh the account before authorizing')
    const credential = sanitizeCredential(provider, value)
    if (provider === 'kg') {
      const session = parseKugouSession(credential.kugou)
      if (!session) throw new ApiError(400, 'INVALID_ACCOUNT_SESSION', 'Invalid platform session')
      credential.kugou = session
      // Local presence alone is insufficient proof for a server-owned Kugou session.
      const lists = await this.reader(provider, credential).getMusicAccountPlaylists(provider)
      if (lists.status !== 'available') throw new ApiError(401, 'PLATFORM_LOGIN_REQUIRED', 'Official authorization must be renewed')
    }
    const reader = this.reader(provider, credential)
    const result = await reader.getMusicAccountStatus()
    if (!result[provider]) throw new ApiError(401, 'PLATFORM_LOGIN_REQUIRED', 'Official authorization must be renewed')
    guard()
    const revision = this.vault.put(provider, credential, expectedRevision)
    this.statuses.delete(provider); this.dailyCache.delete(provider); this.publish(provider, revision)
    return { provider, status: 'connected' as const, revision }
  }

  async dailyKey(value: string, revision: number, guard: () => void) {
    if (!/^qmk-[\w-]{12,1024}$/.test(value)) throw new ApiError(400, 'INVALID_DAILY_AUTHORIZATION', 'Invalid official recommendation authorization')
    const snapshot = this.snapshot('tx'); snapshot.assert()
    if (snapshot.revision !== revision) throw new ApiError(409, 'ACCOUNT_CHANGED', 'Refresh the account first')
    const credential = { ...snapshot.credential, dailyKey: value }
    const result = await this.reader('tx', credential, snapshot.assert).getMusicAccountDailySongIds('tx')
    if (result.kind !== 'official_daily' || result.status !== 'personalized') throw new ApiError(400, 'INVALID_DAILY_AUTHORIZATION', 'Official recommendation authorization was not accepted')
    guard(); snapshot.assert()
    const next = this.vault.put('tx', credential, revision)
    this.statuses.delete('tx'); this.dailyCache.delete('tx'); this.publish('tx', next)
    return { configured: true, revision: next }
  }

  logout(provider: MusicAccountProvider, revision: number) {
    const next = this.vault.put(provider, undefined, revision)
    this.statuses.delete(provider); this.dailyCache.delete(provider); this.publish(provider, next)
    return { provider, status: 'disconnected' as const }
  }

  async playlists(provider: MusicAccountProvider) {
    const snapshot = this.snapshot(provider)
    const result = await snapshot.reader.getMusicAccountPlaylists(provider); snapshot.assert()
    return { ...result, revision: snapshot.revision }
  }

  async favorite(input: QQFavoriteRequest, revision: number, guard: () => void) {
    const snapshot = this.snapshot('tx', guard)
    if (snapshot.revision !== revision) throw new ApiError(409, 'ACCOUNT_CHANGED', 'Account changed before favorite')
    guard(); const result = await snapshot.reader.addQQFavoriteSong(input); snapshot.assert(); guard()
    // Clients need a stable sync identity, never a raw account/cookie identifier.
    return { status: result.status, ...(result.code == null ? {} : { code: result.code }), ...(result.accountId ? { accountId: createHash('md5').update(result.accountId).digest('hex') } : {}) }
  }

  async tracks(provider: MusicAccountProvider, id: string, revision: number) {
    const snapshot = this.snapshot(provider)
    if (snapshot.revision !== revision) throw new ApiError(409, 'ACCOUNT_CHANGED', 'Refresh the account before importing')
    const result = await snapshot.reader.getMusicAccountPlaylistDetail(provider, id)
    if (result.status !== 'available') throw new ApiError(409, result.status === 'login_required' ? 'PLATFORM_LOGIN_REQUIRED' : 'ACCOUNT_PLAYLIST_INCOMPLETE', 'Platform playlist is unavailable; existing data retained')
    let list: TuneFlow.Music.MusicInfo[]
    if (provider === 'tx') {
      const rows = result.tracks ?? []
      const byId = new Map(rows.map(row => [String(row.mid ?? row.songmid), row]))
      list = await boundedMap(result.ids, async mid => {
        const row = byId.get(mid)
        if (row?.file && row?.album) return safeTrack(txLists.filterListDetail([row])[0])
        const song = await txInfo(mid); if (!song) throw new ApiError(409, 'ACCOUNT_PLAYLIST_INCOMPLETE', 'A playlist track is unavailable')
        return safeTrack(song)
      })
    } else if (provider === 'wy') {
      list = wyDetail.filterList({ songs: result.tracks ?? [], privileges: result.privileges ?? [] }).map(safeTrack)
      if (list.length !== result.ids.length) throw new ApiError(409, 'ACCOUNT_PLAYLIST_INCOMPLETE', 'A playlist track is unavailable')
    } else {
      list = []
      for (let at = 0; at < result.ids.length; at += 100) list.push(...(await kgLists.getMusicInfos(result.ids.slice(at, at + 100).map(hash => ({ hash })), { requireComplete: true })).map(safeTrack))
    }
    snapshot.assert()
    return { provider, id, revision, importOwner: result.importOwner, list }
  }

  async daily(provider: MusicAccountProvider, refresh = false) {
    const revision = this.vault.account(provider)?.revision ?? 0
    const cached = this.dailyCache.get(provider)
    if (!refresh && cached?.revision === revision && cached.until > Date.now()) return cached.value
    const key = `${provider}:${revision}`
    const pending = this.dailyPending.get(key)
    if (pending) return pending
    const task = this.readDaily(provider).then(value => {
      this.dailyCache.set(provider, { revision, until: Date.now() + (value.status === 'personalized' ? 300_000 : 5000), value }); return value
    }).finally(() => { this.dailyPending.delete(key) })
    this.dailyPending.set(key, task); return task
  }

  private async readDaily(provider: MusicAccountProvider) {
    const snapshot = this.snapshot(provider)
    const result = await snapshot.reader.getMusicAccountDailySongIds(provider)
    let list: TuneFlow.Music.MusicInfo[] = []
    if (result.status === 'personalized') {
      if (provider === 'tx') list = (await boundedMap(result.ids.slice(0, 30), async mid => txInfo(mid).then(song => song ? safeTrack(song) : null).catch(() => null))).filter((item): item is TuneFlow.Music.MusicInfo => item != null)
      else if (provider === 'wy') list = (await wyDetail.getList(result.ids)).list.map(safeTrack)
      else for (let at = 0; at < result.ids.length; at += 100) list.push(...(await kgLists.getMusicInfos(result.ids.slice(at, at + 100).map(hash => ({ hash })))).map(safeTrack))
    }
    snapshot.assert()
    return { provider, status: result.status === 'personalized' && !list.length ? 'unavailable' : result.status, kind: result.kind, importOwner: result.importOwner, revision: snapshot.revision, list }
  }
}
