export interface AccountTransferInfo {
  id: string
  expiresAt: number
  addresses: string[]
  links: string[]
  images: string[]
  account: string
}
export type AccountTransferState = 'waiting' | 'sent' | 'expired' | 'cancelled'
