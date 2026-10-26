import { ServiceClient, ServiceError } from './client'
import { DEFAULT_ENDPOINT, PROFILE_KEY, ServiceWorkspace, LIBRARY_ID } from './workspace'
import { probeAccountAccess } from '../../../../../packages/service-client/src/accounts'

const listeners = new Map<string, Set<(payload: any) => void>>()
const subscribers = new Set<() => void>()
const recommendationSubscribers = new Set<() => void>()
let recommendationSequence = -1
let accountSequence = -1
let accountAccessMarker: string | undefined
export const subscribeRecommendations = (listener: () => void) => { recommendationSubscribers.add(listener); return () => { recommendationSubscribers.delete(listener) } }
let workspace: ServiceWorkspace | undefined
let polling = false
let sequence = -1
let refreshing: Promise<void> | undefined
export const serviceStatus = { connected: false, busy: false, error: '', endpoint: '' }
export let serverDownloadSettings: Record<string, unknown> = {}
export const subscribeService = (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener) } }
const changed = () => { for (const listener of subscribers) listener() }
export const isServerBoundWeb = typeof process !== 'undefined' && String(process.platform) === 'web'

export const getWorkspace = () => {
  if (!workspace) workspace = new ServiceWorkspace(new ServiceClient(isServerBoundWeb ? location.origin : localStorage.getItem(PROFILE_KEY) ?? DEFAULT_ENDPOINT))
  serviceStatus.endpoint = workspace.client.endpoint
  return workspace
}

export const serviceListEvent = (name: string) => name.startsWith('player_list_')
export const onServiceList = (name: string, listener: (payload: any) => void) => {
  let set = listeners.get(name)
  if (!set) listeners.set(name, set = new Set())
  set.add(listener)
}
export const offServiceList = (name: string, listener?: (payload: any) => void) => {
  if (listener) listeners.get(name)?.delete(listener)
  else listeners.delete(name)
}

export const refreshServiceLists = async() => {
  if (refreshing) return refreshing
  refreshing = (async() => {
    const current = getWorkspace()
    const lists = await current.playlists()
    const [defaultList, loveList, ...tracks] = await Promise.all(['default', 'love', ...lists.map(list => list.id)].map(async id => current.tracks(id)))
    const params = { defaultList, loveList, userList: lists.map((list, index) => ({ ...list, list: tracks[index] })) }
    for (const listener of listeners.get('player_list_data_overwire') ?? []) listener({ event: null, params })
  })().finally(() => { refreshing = undefined })
  return refreshing
}

export const invokeServiceList = async(name: string, data: unknown) => {
  const action = name.slice('player_list_'.length)
  const result = await getWorkspace().lists(action, data)
  if (action === 'music_overwrite' && (data as { listId?: string }).listId === 'temp') {
    for (const listener of listeners.get(name) ?? []) listener({ event: null, params: data })
  }
  if (!['get', 'music_get', 'music_check_exist', 'music_get_list_ids'].includes(action) && (data as { listId?: string })?.listId !== 'temp') {
    // The mutation is already committed. A failed refresh must not invite a
    // duplicate POST; polling will repair the view after reconnection.
    await refreshServiceLists().catch(error => { serviceStatus.error = error.message; changed() })
  }
  return result
}

export const checkService = async(refresh = false) => {
  if (serviceStatus.busy) return
  serviceStatus.busy = true; changed()
  try {
    const current = getWorkspace()
    await current.client.connect()
    const snapshot = await current.client.request<{ sequence: number, events?: Array<{ type: string, sequence: number }> }>('/api/v1/events/snapshot')
    if (current !== getWorkspace()) return
    const recommendation = snapshot.events?.find(event => event.type === 'recommendations.updated')
    const account = snapshot.events?.find(event => event.type === 'accounts.changed')
    const accessState = await probeAccountAccess(current.client)
    const access = JSON.stringify(accessState)
    if (current !== getWorkspace()) return
    if (accessState.state !== 'unavailable') {
      if (accountAccessMarker !== undefined && access !== accountAccessMarker) window.dispatchEvent(new Event('qmusic-accounts-changed'))
      accountAccessMarker = access
    }
    if (account && account.sequence !== accountSequence) { accountSequence = account.sequence; window.dispatchEvent(new Event('qmusic-accounts-changed')) }
    if (recommendation && recommendation.sequence !== recommendationSequence) {
      recommendationSequence = recommendation.sequence
      for (const listener of recommendationSubscribers) listener()
    }
    if (refresh || snapshot.sequence !== sequence || !serviceStatus.connected) {
      const settings = await current.client.settings()
      serverDownloadSettings = Object.fromEntries(Object.entries(settings).filter(([key]) => key.startsWith('download.')))
      await refreshServiceLists()
    }
    // checkService is serialized by serviceStatus.busy.
    // eslint-disable-next-line require-atomic-updates
    sequence = snapshot.sequence
    serviceStatus.connected = true; serviceStatus.error = ''
  } catch (error) {
    serviceStatus.connected = false
    serviceStatus.error = error instanceof Error ? error.message : '连接失败'
  } finally { serviceStatus.busy = false; changed() }
}

export const startServiceSession = () => {
  if (polling) return
  polling = true
  void checkService(true)
  const poll = () => { void checkService().finally(() => { if (polling) setTimeout(poll, 5000) }) }
  setTimeout(poll, 5000)
}

export const connectService = async(endpoint: string, reload: () => void) => {
  if (isServerBoundWeb) throw new ServiceError('SERVER_CONNECTION_LOCKED')
  const next = new ServiceClient(endpoint)
  await next.connect()
  // Reload releases all endpoint-bound caches and playback state. Native DBs
  // and the old endpoint's queues/lists remain untouched.
  localStorage.setItem(PROFILE_KEY, next.endpoint)
  reload()
}

export const scanServiceLibrary = async() => {
  await getWorkspace().client.request('/api/v1/library/scan', 'POST')
  await refreshServiceLists()
}

export { LIBRARY_ID }
