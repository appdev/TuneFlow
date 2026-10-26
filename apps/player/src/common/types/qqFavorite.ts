export interface QQFavoriteRequest {
  songMid: string
  action?: 'add' | 'check'
}

export interface QQFavoriteResult {
  status: 'added' | 'login_required' | 'unsupported' | 'unavailable' | 'rejected' | 'unknown' | 'unconfirmed' | 'not_found' | 'account_changed'
  code?: number
  accountId?: string
}
