import { sharedAccounts } from '../../service-client/src/accounts'
import type { ServiceClient } from '../../service-client/src/client'
// Only refresh an existing imported collection; favoriting never creates or
// replaces a user's library as a hidden side effect.
export const syncSharedQQFavorites = async(workspace: { client: ServiceClient, playlists: () => Promise<Array<{ id: string }>> }) => {
  const api = sharedAccounts(workspace.client); const status = await api.status()
  const owner = status.accounts.tx.importOwner
  if (!status.tx || !owner) return { total: 0, failed: 0 }
  const id = `account_tx_${owner}_dir_201`
  if (!(await workspace.playlists()).some(item => item.id === id)) return { total: 0, failed: 0 }
  try { await api.import('tx', 'dir:201', status.revisions.tx); return { total: 1, failed: 0 } } catch { return { total: 1, failed: 1 } }
}
