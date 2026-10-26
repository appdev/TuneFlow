import { ServiceError, type TrackDto } from './client'
import type { AccountWorkspace } from './types'

export interface AccountCollection { provider: 'tx' | 'wy' | 'kg', owner: string, id: string, name: string }
const playlistId = (item: AccountCollection) => item.provider === 'kg' ? item.id.replace(/^account:\d+:/, '') : item.id
export const accountCollectionId = (item: AccountCollection) => {
  if (!['tx', 'wy', 'kg'].includes(item.provider) || !/^[a-f0-9]{32}$/.test(item.owner) || !/^(?:dir:)?[a-z0-9_-]+$/i.test(playlistId(item))) throw new ServiceError('INVALID_ACCOUNT_COLLECTION')
  return `account_${item.provider}_${item.owner}_${playlistId(item).replace(':', '_')}`
}
export const accountSourceId = (item: AccountCollection) => { accountCollectionId(item); return `account:${item.owner}:${playlistId(item)}` }

// Only music identifiers and presentation metadata cross into Docker. Session
// cookies, official stream URLs and device cache state never enter the DTO.
export const accountTrack = <Input, Output extends { id: string }>(workspace: AccountWorkspace<Input, Output>, music: Input) => {
  const original = workspace.original(music)
  if (!['tx', 'wy', 'kg'].includes(original.source ?? '') || !original.id || !original.name) throw new ServiceError('INVALID_ACCOUNT_TRACK')
  const meta: Record<string, unknown> = {}
  for (const key of ['songId', 'albumId', 'albumName', 'strMediaMid', 'hash', 'id', 'copyrightId', 'lrcUrl', 'mrcUrl', 'trcUrl']) {
    const value = original.meta?.[key]
    if ((typeof value === 'string' || typeof value === 'number') && !/url/i.test(key)) meta[key] = value
  }
  const available: unknown = original.meta?.qualitys
  const qualities: Array<{ type: string, size: string | null }> = []
  if (Array.isArray(available)) {
    for (const entry of available as unknown[]) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      if (typeof item.type === 'string' && ['128k', '320k', 'flac', 'flac24bit'].includes(item.type)) qualities.push({ type: item.type, size: typeof item.size === 'string' ? item.size : null })
    }
  }
  if (qualities.length) meta.qualitys = qualities
  const dto: TrackDto = { id: String(original.id), source: original.source, name: original.name, singer: original.singer ?? '', interval: original.interval ?? undefined, meta }
  return workspace.native(dto)
}
export const accountTracks = <Input, Output extends { id: string }>(workspace: AccountWorkspace<Input, Output>, musics: Input[]) => {
  const seen = new Set<string>()
  return musics.map(music => accountTrack(workspace, music)).filter(music => { if (seen.has(music.id)) return false; seen.add(music.id); return true })
}

// Import is additive: partial account pages must be rejected by the reader;
// retries and concurrent imports cannot replace songs edited on another device.
export const importAccountCollection = async<Input, Output extends { id: string }>(workspace: AccountWorkspace<Input, Output>, item: AccountCollection, musics: Input[], guard: () => Promise<void>) => {
  const id = accountCollectionId(item)
  const tracks = accountTracks(workspace, musics)
  await guard()
  const lists = await workspace.playlists()
  if (!lists.some(list => list.id === id)) {
    await guard()
    await workspace.lists('add', { position: 2, listInfos: [{ id, name: item.name, source: item.provider, sourceListId: accountSourceId(item) }] })
  }
  await guard()
  if (tracks.length) await workspace.lists('music_add', { id, musicInfos: tracks, addMusicLocationType: 'bottom' })
  return { id, count: tracks.length }
}
