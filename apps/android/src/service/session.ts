import AsyncStorage from '@react-native-async-storage/async-storage'
import { ServiceClient } from './client'
import { DEFAULT_ENDPOINT, PROFILE_KEY, ServiceWorkspace } from './workspace'

let workspace = new ServiceWorkspace(new ServiceClient(DEFAULT_ENDPOINT))
let started = false
let sequence = -1
let refreshing: Promise<void> | undefined
const subscribers = new Set<() => void>()
const recommendationSubscribers = new Set<() => void>()
let recommendationSequence = -1
export const subscribeRecommendations = (listener: () => void) => { recommendationSubscribers.add(listener); return () => { recommendationSubscribers.delete(listener) } }
export interface ServiceListSnapshot { defaultList: LX.Music.MusicInfo[], loveList: LX.Music.MusicInfo[], userList: LX.List.UserListInfoFull[], tempList?: LX.Music.MusicInfo[] }
const listSubscribers = new Set<(data: ServiceListSnapshot) => void>()
export const serviceStatus = { connected: false, busy: false, error: '', endpoint: DEFAULT_ENDPOINT }
const changed = () => { for (const listener of subscribers) listener() }
export const subscribeService = (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener) } }
export const onServiceLists = (listener: (data: ServiceListSnapshot) => void) => { listSubscribers.add(listener); return () => { listSubscribers.delete(listener) } }
export const getWorkspace = () => workspace
export const isServiceMode = () => true

export const loadServiceProfile = async() => {
  const endpoint = await AsyncStorage.getItem(PROFILE_KEY)
  if (endpoint) workspace = new ServiceWorkspace(new ServiceClient(endpoint))
  serviceStatus.endpoint = workspace.client.endpoint
}

export const refreshServiceLists = async() => {
  if (refreshing) return refreshing
  const current = workspace
  refreshing = (async() => {
    const lists = await current.playlists()
    const [defaultList, loveList, ...tracks] = await Promise.all(['default', 'love', ...lists.map(list => list.id)].map(async id => current.tracks(id)))
    if (current !== workspace) return
    const data = { defaultList, loveList, userList: lists.map((list, index) => ({ ...list, list: tracks[index] })) }
    for (const listener of listSubscribers) listener(data)
  })().finally(() => { refreshing = undefined })
  return refreshing
}

export const serviceListAction = async(action: string, data: unknown) => {
  const result = await workspace.lists(action, data)
  if (action === 'music_overwrite' && (data as { listId?: string }).listId === 'temp') {
    for (const listener of listSubscribers) listener({ defaultList: [], loveList: [], userList: [], tempList: (data as { musicInfos: LX.Music.MusicInfo[] }).musicInfos })
  }
  if (!['get', 'music_get', 'music_check_exist', 'music_get_list_ids'].includes(action) && (data as { listId?: string })?.listId !== 'temp') {
    await refreshServiceLists().catch(error => { serviceStatus.error = error.message; changed() })
  }
  return result
}

export const checkService = async(refresh = false) => {
  if (serviceStatus.busy) return
  const current = workspace
  serviceStatus.busy = true; changed()
  try {
    await current.client.connect()
    const snapshot = await current.client.request<{ sequence: number, events?: Array<{ type: string, sequence: number }> }>('/api/v1/events/snapshot')
    if (current !== workspace) return
    const recommendation = snapshot.events?.find(event => event.type === 'recommendations.updated')
    if (recommendation && recommendation.sequence !== recommendationSequence) {
      recommendationSequence = recommendation.sequence
      for (const listener of recommendationSubscribers) listener()
    }
    if (refresh || sequence !== snapshot.sequence || !serviceStatus.connected) await refreshServiceLists()
    // Requests are serialized by serviceStatus.busy; stale endpoints were checked above.
    // eslint-disable-next-line require-atomic-updates
    sequence = snapshot.sequence
    serviceStatus.connected = true; serviceStatus.error = ''
  } catch (error) {
    if (current !== workspace) return
    serviceStatus.connected = false; serviceStatus.error = error instanceof Error ? error.message : '连接失败'
  } finally { serviceStatus.busy = false; changed() }
}

export const startServiceSession = () => {
  if (started) return
  started = true
  const poll = () => { void checkService().finally(() => { setTimeout(poll, 5000) }) }
  poll()
}

export const connectService = async(endpoint: string, stopPlayback: () => Promise<unknown>) => {
  const next = new ServiceClient(endpoint)
  await next.connect()
  await stopPlayback()
  // Persist only a validated address. Never move playlists/credentials between
  // endpoints; release the old server's view before loading the new one.
  await AsyncStorage.setItem(PROFILE_KEY, next.endpoint)
  workspace = new ServiceWorkspace(next); sequence = -1
  recommendationSequence = -1
  serviceStatus.connected = false; serviceStatus.endpoint = next.endpoint; serviceStatus.error = ''; changed()
  for (const listener of listSubscribers) listener({ defaultList: [], loveList: [], userList: [] })
  await refreshing?.catch(() => {})
  await checkService(true)
}

export const scanServiceLibrary = async() => {
  await workspace.client.request('/api/v1/library/scan', 'POST')
  await refreshServiceLists()
}
