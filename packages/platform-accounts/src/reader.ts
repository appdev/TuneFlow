// Portable reader extracted from the native account adapter. No UI, OS storage or logging.
import { constants, createCipheriv, createHash, publicEncrypt, randomBytes } from 'node:crypto'
import { getQQCredentials, getQQRequestComm, getQQWebRequestComm } from './qqCredentials'
import { signQQRequest } from './qqSign'
import { collectQQPlaylistIds } from './qqPlaylist'
import type { KugouSession } from './kugouAccount'
import type { QQFavoriteRequest, QQFavoriteResult } from './qqFavorite'
export interface Session {
  cookies: { get: (filter: { url?: string }) => Promise<Array<{ name: string, value: string }>> }
  fetch: typeof fetch
}
export interface ReaderDependencies {
  session: (provider: MusicAccountProvider) => Promise<Session>
  credential: (name: string) => string
  kugou: { session: () => KugouSession | null, playlists: () => Promise<MusicAccountPlaylist[]>, daily: () => Promise<string[]>, detail: (id: string) => Promise<string[]> }
}
export type MusicAccountProvider = 'tx' | 'wy' | 'kg'

export type MusicAccountConnectionState = 'connected' | 'expired' | 'disconnected' | 'unavailable'

export interface MusicAccountProfile {
  importOwner?: string
  state: MusicAccountConnectionState
  displayName: string
  avatar: string
  accountHint: string
  hasSession: boolean
}

export interface MusicAccountStatus {
  tx: boolean
  wy: boolean
  kg: boolean
  accounts: Record<MusicAccountProvider, MusicAccountProfile>
}

export interface MusicAccountDailyResult {
  importOwner?: string
  provider: MusicAccountProvider
  ids: string[]
  status: 'personalized' | 'login_required' | 'unavailable'
  kind?: 'official_daily' | 'radar' | 'netease_daily' | 'kugou_daily'
}

export interface MusicAccountPlaylist {
  importOwner?: string
  accountId?: string
  id: string
  name: string
  cover: string
  trackCount: number
  creator: string
  kind?: 'created' | 'favorite'
}

export interface MusicAccountPlaylistsResult {
  provider: MusicAccountProvider
  playlists: MusicAccountPlaylist[]
  status: 'available' | 'login_required' | 'unavailable' | 'verification_required'
}

export interface MusicAccountPlaylistDetailResult {
  importOwner?: string
  accountId?: string
  tracks?: Array<Record<string, any>>
  privileges?: Array<Record<string, any>>
  provider: MusicAccountProvider
  id: string
  ids: string[]
  status: 'available' | 'login_required' | 'unavailable' | 'verification_required' | 'account_changed' | 'playlist_incomplete'
}

export const createAccountReader = (dependencies: ReaderDependencies) => {
const readyAccountSession = dependencies.session
const readAccountCredential = dependencies.credential
const readKugouSession = dependencies.kugou.session
const getKugouPlaylists = dependencies.kugou.playlists
const getKugouDailyHashes = dependencies.kugou.daily
const getKugouPlaylistHashes = dependencies.kugou.detail
const accountValidationCache = new Map<MusicAccountProvider, { connected: boolean, state: MusicAccountConnectionState, expiresAt: number }>()

const neteaseIv = Buffer.from('0102030405060708')

const neteasePresetKey = Buffer.from('0CoJUm6Qyw8W8jud')

const neteaseBase62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

const neteasePublicKey = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----'

const aesEncrypt = (buffer: Buffer, key: Buffer) => {
  const cipher = createCipheriv('aes-128-cbc', key, neteaseIv)
  return Buffer.concat([cipher.update(buffer), cipher.final()])
}

const buildNeteaseWeapiForm = (data: Record<string, unknown>) => {
  const secretKey = Buffer.from(Array.from(randomBytes(16), value => neteaseBase62.charCodeAt(value % neteaseBase62.length)))
  const firstPass = aesEncrypt(Buffer.from(JSON.stringify(data)), neteasePresetKey).toString('base64')
  const params = aesEncrypt(Buffer.from(firstPass), secretKey).toString('base64')
  const reversedKey = Buffer.from(secretKey).reverse()
  const paddedKey = Buffer.concat([Buffer.alloc(128 - reversedKey.length), reversedKey])
  const encSecKey = publicEncrypt({ key: neteasePublicKey, padding: constants.RSA_NO_PADDING }, paddedKey).toString('hex')
  return new URLSearchParams({ params, encSecKey })
}

const hasLoginCookie = async(provider: MusicAccountProvider) => {
  if (provider == 'kg') return Boolean(readKugouSession())
  if (provider == 'tx') {
    const { uin, authst } = await getQQAccountCredentials()
    return Boolean(uin && authst)
  }
  const cookies = await (await readyAccountSession(provider)).cookies.get({})
  const names = new Set(cookies.map(cookie => cookie.name.toLowerCase()))
  return names.has('music_u') || names.has('music_a')
}

const configureAccountSessionProxy = async(provider: MusicAccountProvider) => readyAccountSession(provider)

const getQQAccountCredentials = async() => {
  const accountSession = await readyAccountSession('tx')
  const cookies = (await Promise.all(['https://u.y.qq.com/', 'https://y.qq.com/'].map(async url => accountSession.cookies.get({ url })))).flat()
  const cookieMap = Object.fromEntries(cookies.map(cookie => [cookie.name.toLowerCase(), cookie.value]))
  return {
    accountSession,
    ...getQQCredentials(cookieMap),
    cookies: cookieMap,
  }
}

const normalizeRemoteImageUrl = (value: unknown) => {
  const url = String(value ?? '').trim()
  if (!url) return ''
  return url.startsWith('//') ? `https:${url}` : url
}

const maskAccountId = (value: string) => {
  if (!value) return ''
  if (value.length <= 4) return value
  return `${'•'.repeat(Math.min(4, value.length - 4))}${value.slice(-4)}`
}

const getQQAccountProfile = async() => {
  const { accountSession, uin, isWeChat } = await getQQAccountCredentials()
  const emptyProfile = { displayName: '', avatar: '', encryptedUin: '', accountHint: uin ? `${isWeChat ? '微信' : 'QQ'} · ${maskAccountId(uin)}` : '' }
  if (!uin) return emptyProfile
  try {
    const url = new URL('https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg')
    url.search = new URLSearchParams({ ct: '20', cv: '4747474', cid: '205360838', userid: uin }).toString()
    const response = await accountSession.fetch(url.toString(), {
      headers: { Referer: 'https://y.qq.com/' },
    })
    if (!response.ok) return emptyProfile
    const result = await response.json() as {
      data?: {
        creator?: {
          encrypt_uin?: string
          nick?: string
          nickname?: string
          headpic?: string
          avatarUrl?: string
          avatar_url?: string
        }
      }
    }
    const creator = result.data?.creator
    return {
      displayName: String(creator?.nick ?? creator?.nickname ?? '').trim(),
      avatar: normalizeRemoteImageUrl(creator?.headpic ?? creator?.avatarUrl ?? creator?.avatar_url),
      encryptedUin: creator?.encrypt_uin ?? '',
      accountHint: emptyProfile.accountHint,
    }
  } catch {
    return emptyProfile
  }
}

const getQQEncryptedUin = async() => (await getQQAccountProfile()).encryptedUin

const qqMusicCredentialRejectionCodes = new Set([401, 403, 1000, 104400, 104401])

class QQMusicURequestError extends Error {
  constructor(
    public readonly reason: 'login_required' | 'unavailable',
    public readonly code?: number,
    message = 'QQ Music account request failed',
  ) {
    super(code == null ? message : `${message}: ${code}`)
    this.name = 'QQMusicURequestError'
  }
}

const parseQQMusicCode = (value: unknown): number | undefined => {
  if ((typeof value != 'number' && typeof value != 'string') || (typeof value == 'string' && !value.trim())) return undefined
  const code = Number(value)
  return Number.isFinite(code) ? code : undefined
}

const createQQMusicURequestError = (code?: number, message?: string) => {
  const reason = code != null && qqMusicCredentialRejectionCodes.has(code) ? 'login_required' : 'unavailable'
  if (reason == 'login_required') accountValidationCache.delete('tx')
  return new QQMusicURequestError(reason, code, message)
}

const isQQMusicLoginRequiredError = (error: unknown) => {
  return error instanceof QQMusicURequestError && error.reason == 'login_required'
}

const requestQQMusicU = async<T extends object>(requests: Record<string, unknown>, signal?: AbortSignal, expectedAccount?: string, web = false): Promise<T> => {
  const { accountSession, cookies } = await getQQAccountCredentials()
  if (expectedAccount && qqAccountIdentity(cookies) != expectedAccount) throw new Error('account_changed')
  const requestCookies = web
    ? Object.fromEntries((await accountSession.cookies.get({ url: 'https://u.y.qq.com/' })).map(cookie => [cookie.name.toLowerCase(), cookie.value]))
    : cookies
  if (web && expectedAccount && qqAccountIdentity(requestCookies) != expectedAccount) throw new Error('account_changed')
  const body = JSON.stringify({ comm: web ? getQQWebRequestComm(requestCookies) : getQQRequestComm(requestCookies), ...requests })
  const url = new URL(`https://u.y.qq.com/cgi-bin/${web ? 'musics' : 'musicu'}.fcg`)
  if (web) url.searchParams.set('sign', signQQRequest(body))
  const response = await accountSession.fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    ...(web ? { cache: 'no-store' as const } : {}),
    headers: {
      // musics 不允许 application/json 的跨域预检；沿用官网旧版签名 AJAX 的简单请求类型。
      // 正文仍为参与签名的原始 JSON，不能改成 URLSearchParams 或再次序列化。
      'Content-Type': web ? 'application/x-www-form-urlencoded;charset=UTF-8' : 'application/json;charset=UTF-8',
      Origin: 'https://y.qq.com',
      Referer: 'https://y.qq.com/',
    },
    body,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
  })
  if (!response.ok) {
    const error = new QQMusicURequestError(
      response.status == 401 || response.status == 403 ? 'login_required' : 'unavailable',
      response.status,
    )
    if (error.reason == 'login_required') accountValidationCache.delete('tx')
    throw error
  }

  const result = await response.json() as T & { code?: unknown }
  const globalCode = parseQQMusicCode(result.code)
  if (globalCode != 0) throw createQQMusicURequestError(globalCode, 'QQ Music global request failed')
  const resultModules = result as T & Record<string, unknown>
  for (const key of Object.keys(requests)) {
    const moduleResult = resultModules[key]
    const moduleCode = moduleResult && typeof moduleResult == 'object'
      ? parseQQMusicCode((moduleResult as { code?: unknown }).code)
      : undefined
    if (moduleCode != 0) throw createQQMusicURequestError(moduleCode, `QQ Music module ${key} failed`)
  }
  return result
}

const qqAccountIdentity = (cookies: Record<string, string>) => {
  const { uin, authst, tmeLoginType } = getQQCredentials(cookies)
  return `${tmeLoginType}:${uin}:${authst}`
}

const qqAccountId = (cookies: Record<string, string>) => {
  const { uin, tmeLoginType } = getQQCredentials(cookies)
  return createHash('sha256').update(`qq:${tmeLoginType}:${uin}`).digest('hex')
}

const checkQQFavoriteSong = async(songMid: string, account: string) => {
  const result = await requestQQMusicU<{
    verify: { data?: { m_fan?: Record<string, unknown> } }
  }>({
    verify: {
      module: 'music.musicasset.SongFavRead',
      method: 'IsSongFanByMid',
      param: { v_songMid: [songMid] },
    },
  }, undefined, account)
  if (qqAccountIdentity((await getQQAccountCredentials()).cookies) != account) throw new Error('account_changed')
  const value = result.verify.data?.m_fan?.[songMid]
  if (value === true || value === 1) return true
  if (value === false || value === 0) return false
  throw new Error('QQ favorite state missing')
}

const addQQFavoriteSong = async(request: QQFavoriteRequest): Promise<QQFavoriteResult> => {
  if (typeof request?.songMid != 'string' || !/^[a-zA-Z0-9]{1,64}$/.test(request.songMid) ||
    (request.action != null && request.action != 'add' && request.action != 'check')) return { status: 'unsupported' }
  let writing = false
  const startedAt = Date.now()
  let phase = 'preflight'
  try {
    const { uin, authst, cookies } = await getQQAccountCredentials()
    if (!uin || !authst) return { status: 'login_required' }
    const account = qqAccountIdentity(cookies)
    await configureAccountSessionProxy('tx')
    const alreadyLiked = await checkQQFavoriteSong(request.songMid, account)
    if (alreadyLiked) return { status: 'added', accountId: qqAccountId(cookies) }
    if (request.action == 'check') return { status: 'not_found' }

    phase = 'detail'
    const detail = await requestQQMusicU<{
      detail: { data?: { track_info?: { id?: number, mid?: string, type?: number } } }
    }>({
      detail: {
        module: 'music.pf_song_detail_svr',
        method: 'get_song_detail_yqq',
        param: { song_mid: request.songMid, song_type: 0 },
      },
    }, undefined, account)
    const track = detail.detail.data?.track_info
    if (!track || track.mid != request.songMid || !Number.isSafeInteger(track.id) || track.id! <= 0 || (track.type != null && track.type != 0)) {
      return { status: 'unsupported' }
    }

    writing = true
    phase = 'write-request'
    // 对齐现行官网：201 为「我喜欢」，传真实数字歌曲 ID，只发送网页使用的歌单字段。
    const result = await requestQQMusicU<{
      favorite: { data?: { retCode?: unknown } }
    }>({
      favorite: {
        module: 'music.musicasset.PlaylistDetailWrite',
        method: 'AddSonglist',
        param: { dirId: 201, v_songInfo: [{ songId: track.id, songType: 0 }] },
      },
    }, undefined, account, true)
    if (qqAccountIdentity((await getQQAccountCredentials()).cookies) != account) return { status: 'account_changed' }
    const retCode = result.favorite.data?.retCode
    if (retCode != null && parseQQMusicCode(retCode) !== 0) {
      const code = parseQQMusicCode(retCode)
      if (code != null && qqMusicCredentialRejectionCodes.has(code)) {
        accountValidationCache.delete('tx')
        return { status: 'login_required', code }
      }
      return code == null ? { status: 'unknown' } : { status: 'rejected', code }
    }

    phase = 'verify'
    // 只重查，不重写；给平台短暂同步时间，避免刚受理就显示成功。
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise<void>(resolve => { setTimeout(resolve, 800) })
      if (await checkQQFavoriteSong(request.songMid, account)) {
        void 0
        return { status: 'added', accountId: qqAccountId(cookies) }
      }
    }
    void 0
    return { status: 'unconfirmed' }
  } catch (error) {
    const networkCode = error instanceof Error ? /\b(?:net::)?ERR_[A-Z_]+\b/.exec(error.message)?.[0] : undefined
    const code = error instanceof QQMusicURequestError ? error.code : undefined
    // 此错误类型的 message 仅含固定的响应层级、模块名和数字码，不含服务端正文或凭证。
    const stage = error instanceof QQMusicURequestError ? error.message : undefined
    void 0
    if (error instanceof Error && error.message == 'account_changed') return { status: 'account_changed' }
    if (isQQMusicLoginRequiredError(error)) return { status: 'login_required', code }
    if (phase == 'write-request' && code != null && (code < 500 || code > 599)) return { status: 'rejected', code }
    // 结果不明时提供只读核对，绝不自动重发写请求。
    return { status: writing ? 'unknown' : 'unavailable', ...(code != null ? { code } : {}) }
  }
}

const readQQDailyApiKey = (): string => {
  try { return readAccountCredential('qqDailyApiKey') } catch { return '' }
}

const requestQQOfficialDailySongIds = async(apiKey: string): Promise<string[]> => {
  const response = await (await readyAccountSession('tx')).fetch('https://a.y.qq.com/discover/daily-mix', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ params: {}, comm: { skill_version: '0.0.3' } }),
  })
  if (!response.ok) throw new Error(`QQ official daily recommendations failed: ${response.status}`)
  const result = await response.json() as {
    ret?: number
    sub_ret?: number
    songlist?: Array<{ songMid?: string }>
  }
  if ((result.ret != null && result.ret != 0) || (result.sub_ret != null && result.sub_ret != 0)) return []
  return (result.songlist ?? []).map(item => item.songMid ?? '').filter(Boolean).slice(0, 30)
}

const getQQDailySongIds = async(): Promise<string[]> => {
  const { accountSession, cookies } = await getQQAccountCredentials()
  const ids = new Set<string>()

  for (let page = 1; page <= 4 && ids.size < 30; page++) {
    const response = await accountSession.fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        Origin: 'https://y.qq.com',
        Referer: 'https://y.qq.com/',
      },
      body: JSON.stringify({
        comm: getQQRequestComm(cookies, 19),
        radio: {
          module: 'music.recommend.TrackRelationServer',
          method: 'GetRadarSong',
          param: { Page: page },
        },
      }),
    })
    if (!response.ok) throw new Error(`QQ Music recommendations failed: ${response.status}`)
    const result = await response.json() as {
      radio?: { code?: number, data?: Record<string, unknown> }
    }
    if (result.radio?.code != 0) break
    const data = result.radio.data ?? {}
    const candidates = [data.VecSongs, data.tracks, data.track, data.songList, data.vec_song, data.List]
      .find(value => Array.isArray(value)) as Array<Record<string, unknown>> | undefined
    if (!candidates?.length) break
    for (const candidate of candidates) {
      const track = (candidate.Track ?? candidate.track_info ?? candidate) as Record<string, unknown>
      const id = String(track.mid ?? track.songmid ?? '')
      if (id) ids.add(id)
      if (ids.size >= 30) break
    }
  }
  return [...ids]
}

const getNeteaseCsrfToken = async(accountSession: Session) => {
  const cookies = await accountSession.cookies.get({ url: 'https://music.163.com' })
  return cookies.find(cookie => cookie.name == '__csrf')?.value ?? ''
}

const requestNeteaseWeapi = async<T>(path: string, data: Record<string, unknown>): Promise<T> => {
  const accountSession = await readyAccountSession('wy')
  const csrfToken = await getNeteaseCsrfToken(accountSession)
  const response = await accountSession.fetch(`https://music.163.com${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://music.163.com',
      Referer: 'https://music.163.com/',
    },
    body: buildNeteaseWeapiForm({ ...data, csrf_token: csrfToken }),
  })
  if (response.status == 401 || response.status == 403) throw new Error('login_required')
  if (!response.ok) throw new Error(`NetEase request failed (${path}): ${response.status}`)
  return response.json() as Promise<T>
}

const getNeteaseDailySongIds = async(): Promise<string[]> => {
  const result = await requestNeteaseWeapi<{ code?: number, data?: { dailySongs?: Array<{ id?: string | number }> } }>(
    '/weapi/v3/discovery/recommend/songs',
    { offset: 0, total: true, limit: 30 },
  )
  if (result.code != 200) return []
  return (result.data?.dailySongs ?? []).map(item => String(item.id ?? '')).filter(Boolean)
}

const getNeteaseAccountProfile = async() => {
  const result = await requestNeteaseWeapi<{
    code?: number
    profile?: { userId?: string | number, nickname?: string, avatarUrl?: string }
    account?: { id?: string | number }
  }>('/weapi/w/nuser/account/get', {})
  const userId = String(result.profile?.userId ?? result.account?.id ?? '')
  return {
    userId,
    displayName: result.profile?.nickname?.trim() ?? '',
    avatar: normalizeRemoteImageUrl(result.profile?.avatarUrl),
    accountHint: userId ? `网易云 · ${maskAccountId(userId)}` : '',
  }
}

const getNeteaseUserId = async(): Promise<string> => (await getNeteaseAccountProfile()).userId

const validateMusicAccount = async(provider: MusicAccountProvider, force = false) => {
  if (provider == 'kg') {
    const connected = Boolean(readKugouSession())
    return { connected, state: (connected ? 'connected' : 'disconnected') as MusicAccountConnectionState, expiresAt: Date.now() + 2000 }
  }
  const cached = accountValidationCache.get(provider)
  if (!force && cached && cached.expiresAt > Date.now()) return cached

  let connected = false
  let state: MusicAccountConnectionState = 'disconnected'
  try {
    if (!await hasLoginCookie(provider)) {
      const result = { connected, state, expiresAt: Date.now() + 2_000 }
      accountValidationCache.set(provider, result)
      return result
    }

    await configureAccountSessionProxy(provider)
    if (provider == 'wy') {
      connected = !!await getNeteaseUserId()
    } else {
      const { uin, authst } = await getQQAccountCredentials()
      if (uin && authst) {
        await requestQQMusicU<{
          status?: { code?: number, data?: Record<string, unknown> }
        }>({
          status: {
            module: 'music.musicasset.PlaylistBaseRead',
            method: 'GetPlaylistByUin',
            param: { uin },
          },
        })
        connected = true
      }
    }
    state = connected ? 'connected' : 'expired'
  } catch (error) {
    state = isQQMusicLoginRequiredError(error) || (error instanceof Error && error.message == 'login_required') ? 'expired' : 'unavailable'
    void 0
  }
  const result = { connected, state, expiresAt: Date.now() + (connected ? 15_000 : 2_000) }
  accountValidationCache.set(provider, result)
  return result
}

const verifyMusicAccount = async(provider: MusicAccountProvider, force = false): Promise<boolean> => {
  return (await validateMusicAccount(provider, force)).connected
}

const resolveQQAccountFailureStatus = async(): Promise<'login_required' | 'unavailable'> => {
  const validation = await validateMusicAccount('tx', true)
  return validation.state == 'expired' || validation.state == 'disconnected' ? 'login_required' : 'unavailable'
}

const accountImportOwner = async(provider: MusicAccountProvider) => {
  let identity: string
  if (provider == 'tx') {
    const { cookies } = await getQQAccountCredentials()
    const { uin, tmeLoginType } = getQQCredentials(cookies)
    if (!uin) throw new Error('login_required')
    identity = `qq:${tmeLoginType}:${uin}`
  } else {
    const owner = provider == 'kg' ? readKugouSession()?.userId : await getNeteaseUserId()
    if (!owner) throw new Error('login_required')
    identity = `${provider}:${owner}`
  }
  // Stable non-secret namespace shared with Android; never export a cookie.
  return createHash('md5').update(identity).digest('hex')
}

const getMusicAccountStatus = async(): Promise<MusicAccountStatus> => {
  const inspectAccount = async(provider: MusicAccountProvider): Promise<MusicAccountProfile> => {
    if (provider == 'kg') {
      const account = readKugouSession()
      return { state: account ? 'connected' : 'disconnected', displayName: account?.nickname ?? '', avatar: account?.avatar ?? '', accountHint: account ? `酷狗 · ${maskAccountId(account.userId)}` : '', hasSession: Boolean(account) }
    }
    const validation = await validateMusicAccount(provider, true)
    if (!validation.connected) {
      let accountHint = ''
      if (provider == 'tx' && validation.state != 'disconnected') {
        const { uin, isWeChat } = await getQQAccountCredentials().catch(() => ({ uin: '', isWeChat: false }))
        if (uin) accountHint = `${isWeChat ? '微信' : 'QQ'} · ${maskAccountId(uin)}`
      }
      return {
        state: validation.state,
        displayName: '',
        avatar: '',
        accountHint,
        hasSession: validation.state != 'disconnected',
      }
    }

    if (provider == 'tx') {
      const profile = await getQQAccountProfile()
      return { state: 'connected', displayName: profile.displayName, avatar: profile.avatar, accountHint: profile.accountHint, hasSession: true }
    }
    const profile = await getNeteaseAccountProfile().catch(() => ({ displayName: '', avatar: '', accountHint: '' }))
    return { state: 'connected', displayName: profile.displayName, avatar: profile.avatar, accountHint: profile.accountHint, hasSession: true }
  }

  const [txAccount, wyAccount, kgAccount] = await Promise.all((['tx', 'wy', 'kg'] as const).map(async provider => {
    const profile = await inspectAccount(provider)
    if (profile.state == 'connected') profile.importOwner = await accountImportOwner(provider).catch(() => undefined)
    return profile
  }))
  return {
    tx: txAccount.state == 'connected',
    wy: wyAccount.state == 'connected',
    kg: kgAccount.state == 'connected',
    accounts: { tx: txAccount, wy: wyAccount, kg: kgAccount },
  }
}

const readMusicAccountPlaylists = async(provider: MusicAccountProvider): Promise<MusicAccountPlaylistsResult> => {
  const validation = await validateMusicAccount(provider)
  if (!validation.connected) return { provider, playlists: [], status: validation.state == 'unavailable' ? 'unavailable' : 'login_required' }
  try {
    if (provider == 'kg') return { provider, playlists: await getKugouPlaylists(), status: 'available' }
    if (provider == 'tx') {
      const { uin, cookies } = await getQQAccountCredentials()
      const account = qqAccountIdentity(cookies)
      const encryptedUin = await getQQEncryptedUin()
      if (!encryptedUin) {
        return { provider, playlists: [], status: await resolveQQAccountFailureStatus() }
      }

      interface FavoritePlaylistData {
        v_list?: Array<Record<string, unknown>>
        v_playlist?: Array<Record<string, unknown>>
        hasmore?: boolean | number
      }
      interface QQPlaylistsResponse {
        created?: { code?: number, data?: { v_playlist?: Array<Record<string, unknown>> } }
        favorite?: { code?: number, data?: FavoritePlaylistData }
        liked?: {
          code?: number
          data?: {
            songlist?: Array<Record<string, unknown>>
            total_song_num?: number
            songnum?: number
            totalnum?: number
          }
        }
      }
      const favoritePageSize = 100
      const result = await requestQQMusicU<QQPlaylistsResponse>({
        created: {
          module: 'music.musicasset.PlaylistBaseRead',
          method: 'GetPlaylistByUin',
          param: { uin },
        },
        favorite: {
          module: 'music.musicasset.PlaylistFavRead',
          method: 'CgiGetPlaylistFavInfo',
          param: { uin: encryptedUin, offset: 0, size: favoritePageSize },
        },
        liked: {
          module: 'music.srfDissInfo.DissInfo',
          method: 'CgiGetDiss',
          param: {
            disstid: 0,
            dirid: 201,
            tag: true,
            song_begin: 0,
            song_num: 1,
            userinfo: true,
            orderlist: true,
            enc_host_uin: encryptedUin,
          },
        },
      })
      if (!result.created?.data || !result.favorite?.data || !result.liked?.data) {
        throw new QQMusicURequestError('unavailable', undefined, 'QQ Music playlists response missing data')
      }

      const favoriteItems = [
        ...(result.favorite.data.v_list ?? result.favorite.data.v_playlist ?? []),
      ]
      let favoriteOffset = favoriteItems.length
      let favoriteHasMore = result.favorite.data.hasmore === true || parseQQMusicCode(result.favorite.data.hasmore) == 1
      for (let page = 1; favoriteHasMore && page < 100; page++) {
        const pageResult = await requestQQMusicU<{ favorite?: { code?: number, data?: FavoritePlaylistData } }>({
          favorite: {
            module: 'music.musicasset.PlaylistFavRead',
            method: 'CgiGetPlaylistFavInfo',
            param: { uin: encryptedUin, offset: favoriteOffset, size: favoritePageSize },
          },
        })
        const pageData = pageResult.favorite?.data
        if (!pageData) throw new QQMusicURequestError('unavailable', undefined, 'QQ Music favorite playlists response missing data')
        const pageItems = pageData.v_list ?? pageData.v_playlist ?? []
        if (!pageItems.length) break
        const nextOffset = favoriteOffset + pageItems.length
        if (nextOffset <= favoriteOffset) break
        favoriteItems.push(...pageItems)
        favoriteOffset = nextOffset
        favoriteHasMore = pageData.hasmore === true || parseQQMusicCode(pageData.hasmore) == 1
      }
      if (favoriteHasMore) {
        throw new QQMusicURequestError('unavailable', undefined, 'QQ Music favorite playlists pagination incomplete')
      }
      const normalize = (items: Array<Record<string, unknown>>, kind: MusicAccountPlaylist['kind']) => items.map(item => {
        const dirId = String(item.dirId ?? item.dirid ?? '')
        const dissId = [item.tid, item.dissid, item.dissId, item.id]
          .map(value => String(value ?? ''))
          .find(value => value && value != '0') ?? ''
        return {
          id: dirId == '201' ? 'dir:201' : dissId && dissId != '0' ? dissId : dirId ? `dir:${dirId}` : '',
          name: String(item.dirName ?? item.dirname ?? item.title ?? item.dissname ?? item.name ?? ''),
          cover: String(item.picUrl ?? item.bigpicUrl ?? item.picurl ?? item.logo ?? ''),
          trackCount: Number(item.songNum ?? item.song_cnt ?? item.songnum ?? item.song_num ?? item.songCount ?? item.trackCount ?? 0),
          creator: '',
          kind,
        }
      }).filter(item => item.id && item.name)
      const created = normalize(result.created?.data?.v_playlist ?? [], 'created')
      const favorite = normalize(favoriteItems, 'favorite')
      const existingLiked = created.find(item => item.id == 'dir:201')
      const likedData = result.liked.data
      const liked = {
        id: 'dir:201',
        name: existingLiked?.name ?? '我喜欢',
        cover: existingLiked?.cover ?? '',
        trackCount: Number(likedData.total_song_num ?? likedData.songnum ?? likedData.totalnum ?? likedData.songlist?.length ?? 0),
        creator: '',
        kind: 'created' as const,
      }
      const playlistMap = new Map([
        liked,
        ...created.filter(item => item.id != 'dir:201'),
        ...favorite,
      ].map(item => [item.id, item]))
      if (qqAccountIdentity((await getQQAccountCredentials()).cookies) != account) throw new Error('account_changed')
      const playlists = [...playlistMap.values()].map(item => ({ ...item, accountId: qqAccountId(cookies) }))
      return { provider, playlists, status: playlists.length ? 'available' : 'unavailable' }
    }

    const uid = await getNeteaseUserId()
    if (!uid) return { provider, playlists: [], status: 'unavailable' }
    const result = await requestNeteaseWeapi<{
      code?: number
      playlist?: Array<{
        id?: string | number
        name?: string
        coverImgUrl?: string
        trackCount?: number
        subscribed?: boolean
        creator?: { nickname?: string, userId?: string | number }
      }>
    }>('/weapi/user/playlist', { uid, offset: 0, limit: 1000, includeVideo: true })
    const playlists = (result.playlist ?? []).map(item => ({
      id: String(item.id ?? ''),
      name: item.name ?? '',
      cover: item.coverImgUrl ?? '',
      trackCount: item.trackCount ?? 0,
      creator: item.creator?.nickname ?? '',
      kind: item.subscribed == true
        ? 'favorite' as const
        : String(item.creator?.userId ?? '') != uid ? 'favorite' as const : 'created' as const,
    })).filter(item => item.id && item.name)
    return { provider, playlists, status: playlists.length ? 'available' : 'unavailable' }
  } catch (error) {
    void 0
    if (provider == 'kg' && error instanceof Error && error.message == 'verification_required') return { provider, playlists: [], status: 'verification_required' }
    return { provider, playlists: [], status: (isQQMusicLoginRequiredError(error) || (error instanceof Error && error.message == 'login_required')) ? 'login_required' : 'unavailable' }
  }
}

const readMusicAccountPlaylistDetail = async(
  provider: MusicAccountProvider,
  id: string,
): Promise<MusicAccountPlaylistDetailResult> => {
  const validation = await validateMusicAccount(provider)
  if (!validation.connected) return { provider, id, ids: [], status: validation.state == 'unavailable' ? 'unavailable' : 'login_required' }
  try {
    if (provider == 'kg') return { provider, id, ids: await getKugouPlaylistHashes(id), status: 'available' }
    if (provider == 'tx') {
      const dirMatch = /^dir:(\d+)$/.exec(id)
      const dirId = dirMatch ? Number(dirMatch[1]) : id == '0' ? 201 : 0
      const dissId = dirId ? 0 : Number(id)
      const { cookies } = await getQQAccountCredentials()
      const account = qqAccountIdentity(cookies)

      if (!dirId && !Number.isFinite(dissId)) return { provider, id, ids: [], status: 'unavailable' }
      const encryptedUin = dirId ? await getQQEncryptedUin() : ''
      if (dirId && !encryptedUin) {
        return { provider, id, ids: [], status: await resolveQQAccountFailureStatus() }
      }
      const tracks: Array<Record<string, unknown>> = []
      const ids = await collectQQPlaylistIds(async offset => {
        const result = await requestQQMusicU<{
          detail?: { data?: {
            songlist?: Array<Record<string, unknown>>
            songList?: Array<Record<string, unknown>>
            track_list?: Array<Record<string, unknown>>
            total_song_num?: number
            songnum?: number
            totalnum?: number
            hasmore?: boolean | number
          } }
        }>({
          detail: {
            module: 'music.srfDissInfo.DissInfo',
            method: 'CgiGetDiss',
            param: {
              disstid: dissId,
              dirid: dirId,
              tag: true,
              song_begin: offset,
              song_num: 100,
              userinfo: true,
              orderlist: true,
              ...(encryptedUin ? { enc_host_uin: encryptedUin } : {}),
            },
          },
        }, undefined, account)
        const data = result.detail?.data
        const songs = data?.songlist ?? data?.songList ?? data?.track_list
        if (!data || !Array.isArray(songs)) throw new Error('playlist_incomplete')
        tracks.push(...songs.map(item => (item.track_info ?? item) as Record<string, unknown>))
        const total = data.total_song_num ?? data.songnum ?? data.totalnum
        return {
          ids: songs.map(item => {
            const track = (item.track_info ?? item) as Record<string, unknown>
            return String(track.mid ?? track.songmid ?? track.songMid ?? track.song_mid ?? '')
          }),
          total: total == null ? undefined : Number(total),
          hasMore: data.hasmore == null ? undefined : data.hasmore === true || parseQQMusicCode(data.hasmore) == 1,
        }
      })
      if (qqAccountIdentity((await getQQAccountCredentials()).cookies) != account) throw new Error('account_changed')
      return { provider, id, ids, tracks, status: 'available', accountId: qqAccountId(cookies) }
    }

    const result = await requestNeteaseWeapi<{
      code?: number
      playlist?: { trackIds?: Array<{ id?: string | number }>, trackCount?: number }
    }>('/weapi/v6/playlist/detail', { id, n: 100000, s: 8 })
    if (result.code == 301) throw new Error('login_required')
    if (result.code != 200 || !Array.isArray(result.playlist?.trackIds)) throw new Error('playlist_incomplete')
    const ids = result.playlist.trackIds.map(item => String(item.id ?? ''))
    if (ids.some(songId => !/^\d+$/.test(songId)) || (result.playlist.trackCount != null && result.playlist.trackCount != ids.length)) throw new Error('playlist_incomplete')
    const tracks: Array<Record<string, any>> = []
    const privileges: Array<Record<string, any>> = []
    for (let offset = 0; offset < ids.length; offset += 200) {
      const batch = ids.slice(offset, offset + 200)
      const detail = await requestNeteaseWeapi<{ code?: number, songs?: Array<Record<string, any>>, privileges?: Array<Record<string, any>> }>(
        '/weapi/v3/song/detail', { c: JSON.stringify(batch.map(songId => ({ id: songId }))) },
      )
      if (detail.code == 301) throw new Error('login_required')
      if (detail.code != 200 || !Array.isArray(detail.songs) || !Array.isArray(detail.privileges)) throw new Error('playlist_incomplete')
      tracks.push(...detail.songs)
      privileges.push(...detail.privileges)
    }
    return { provider, id, ids, tracks, privileges, status: 'available' }
  } catch (error) {
    void 0
    const code = error instanceof Error ? error.message : ''
    const status = code == 'verification_required' || code == 'account_changed' || code == 'playlist_incomplete' ? code : code == 'incomplete' ? 'playlist_incomplete' : isQQMusicLoginRequiredError(error) || code == 'login_required' ? 'login_required' : 'unavailable'
    return { provider, id, ids: [], status }
  }
}

const readMusicAccountDailySongIds = async(provider: MusicAccountProvider): Promise<MusicAccountDailyResult> => {
  if (!await verifyMusicAccount(provider)) return { provider, ids: [], status: 'login_required' }
  try {
    if (provider == 'kg') {
      const ids = await getKugouDailyHashes()
      return { provider, ids, status: ids.length ? 'personalized' : 'unavailable', kind: 'kugou_daily' }
    }
    if (provider == 'tx') {
      const apiKey = readQQDailyApiKey()
      if (apiKey) {
        const ids = await requestQQOfficialDailySongIds(apiKey).catch(() => [])
        if (ids.length) return { provider, ids, status: 'personalized', kind: 'official_daily' }
      }
      const ids = await getQQDailySongIds()
      return { provider, ids, status: ids.length ? 'personalized' : 'unavailable', kind: 'radar' }
    }
    const ids = await getNeteaseDailySongIds()
    return { provider, ids, status: ids.length ? 'personalized' : 'unavailable', kind: 'netease_daily' }
  } catch (error) {
    void 0
    return { provider, ids: [], status: 'unavailable' }
  }
}

const getMusicAccountPlaylists = async(provider: MusicAccountProvider): Promise<MusicAccountPlaylistsResult> => {
  try {
    const owner = await accountImportOwner(provider)
    const result = await readMusicAccountPlaylists(provider)
    if (owner != await accountImportOwner(provider)) throw new Error('account_changed')
    return { ...result, playlists: result.playlists.map(item => ({ ...item, importOwner: owner })) }
  } catch { return { provider, playlists: [], status: 'login_required' } }
}

const getMusicAccountPlaylistDetail = async(provider: MusicAccountProvider, id: string): Promise<MusicAccountPlaylistDetailResult> => {
  try {
    const owner = await accountImportOwner(provider)
    const result = await readMusicAccountPlaylistDetail(provider, id)
    if (owner != await accountImportOwner(provider)) throw new Error('account_changed')
    return { ...result, importOwner: owner }
  } catch { return { provider, id, ids: [], status: 'account_changed' } }
}

const getMusicAccountDailySongIds = async(provider: MusicAccountProvider): Promise<MusicAccountDailyResult> => {
  try {
    const owner = await accountImportOwner(provider)
    const result = await readMusicAccountDailySongIds(provider)
    if (owner != await accountImportOwner(provider)) throw new Error('account_changed')
    return { ...result, importOwner: owner }
  } catch { return { provider, ids: [], status: 'login_required' } }
}
return { getMusicAccountStatus, getMusicAccountPlaylists, getMusicAccountPlaylistDetail, getMusicAccountDailySongIds, addQQFavoriteSong }
}
