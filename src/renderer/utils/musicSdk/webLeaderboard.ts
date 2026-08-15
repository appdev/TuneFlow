import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'

type Invoke = <T = unknown>(name: string, params?: unknown) => Promise<T>

interface ServiceBoard {
  id: string
  providerId: string
  name: string
  source: string
}

interface ServiceBoardResult {
  list: ServiceBoard[]
  source: string
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

const validateBoards = (value: unknown): ServiceBoardResult => {
  if (typeof value !== 'object' || value == null) throw new Error('Invalid leaderboard response')
  const result = value as Partial<ServiceBoardResult>
  if (!isNonEmptyString(result.source) || !Array.isArray(result.list)) throw new Error('Invalid leaderboard response')
  if (!result.list.every(item => typeof item === 'object' && item != null &&
    isNonEmptyString(item.id) && isNonEmptyString(item.providerId) &&
    isNonEmptyString(item.name) && isNonEmptyString(item.source))) {
    throw new Error('Invalid leaderboard response')
  }
  return result as ServiceBoardResult
}

export const createWebLeaderboard = (source: string, invoke: Invoke) => ({
  async getBoards() {
    const result = validateBoards(await invoke(WIN_MAIN_RENDERER_EVENT_NAME.handle_request, {
      kind: 'provider-leaderboards', source,
    }))
    return {
      source: result.source,
      list: result.list.map(board => ({ id: board.id, bangid: board.providerId, name: board.name })),
    }
  },
  async getList(boardId: string, page: number) {
    return invoke(WIN_MAIN_RENDERER_EVENT_NAME.handle_request, {
      kind: 'provider-leaderboard-tracks', source, boardId, page,
    })
  },
})
