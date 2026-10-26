import { getAccountIdentityRevision, getWorkspace } from './session'
import type { DailySource } from './recommendations'

// Shared account revisions invalidate caches without platform requests on navigation.
export const getDailyAccountKey = async(source: DailySource): Promise<string> => {
  if (source === 'server') return ''
  return `${getWorkspace().client.endpoint}:${source}:${getAccountIdentityRevision()}`
}
