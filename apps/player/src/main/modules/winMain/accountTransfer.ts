import { app } from 'electron'
import { networkInterfaces } from 'node:os'
import QRCode from 'qrcode'
import { createAccountTransfer, isPrivateIPv4 } from './accountTransferServer'
import { getQQTransferPayload } from './musicAccount'
import type { AccountTransferInfo, AccountTransferState } from '@common/types/accountTransfer'

let active: Awaited<ReturnType<typeof createAccountTransfer>> | undefined
let starting = false
export const cancelAccountTransfer = (id?: string) => { if (!id || active?.id == id) active?.cancel() }
export const getAccountTransferState = (id: string): AccountTransferState => active?.id == id ? active.status() : 'cancelled'
app.on('before-quit', () => { cancelAccountTransfer() })

export const startAccountTransfer = async(): Promise<AccountTransferInfo> => {
  if (starting) throw new Error('transfer_busy')
  starting = true
  cancelAccountTransfer()
  try {
    const adapters = Object.entries(networkInterfaces()).sort(([left], [right]) => Number(/virtual|vmware|vbox|vethernet|wsl|docker|tun|tap/i.test(left)) - Number(/virtual|vmware|vbox|vethernet|wsl|docker|tun|tap/i.test(right)))
    const addresses = [...new Set(adapters.flatMap(([, list]) => (list ?? []).filter(item => !item.internal && item.family == 'IPv4' && isPrivateIPv4(item.address)).map(item => item.address)))]
    if (!addresses.length) throw new Error('transfer_no_network')
    const first = await getQQTransferPayload()
    const transfer = await createAccountTransfer(async() => {
      const current = await getQQTransferPayload()
      if (JSON.stringify(current.cookies) != JSON.stringify(first.cookies)) throw new Error('account_changed')
      return current
    })
    active = transfer
    const links = addresses.map(host => transfer.link(host))
    const images = await Promise.all(links.map(async link => QRCode.toDataURL(link, { width: 300, margin: 2, errorCorrectionLevel: 'M' })))
    return { id: transfer.id, expiresAt: transfer.expiresAt, addresses, links, images, account: first.account }
  } catch (error) {
    cancelAccountTransfer()
    // 不透传任何可能包含凭据的网络异常。
    const reason = error instanceof Error ? error.message : ''
    throw new Error(['transfer_no_network', 'login_required'].includes(reason) ? reason : 'transfer_unavailable')
  } finally {
    // 入口在任何 await 前加锁，后续调用会直接拒绝；只有当前任务能释放。
    // eslint-disable-next-line require-atomic-updates
    starting = false
  }
}
