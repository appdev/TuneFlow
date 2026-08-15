import { describe, expect, it, vi } from 'vitest'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'

describe('hosted Web leaderboard adapter', () => {
  it('exposes a renderer-compatible adapter factory', async() => {
    const module = await import('./webLeaderboard').catch(() => ({}))
    expect(module).toHaveProperty('createWebLeaderboard')
  })

  it('maps Service boards and requests track pages with provider IDs', async() => {
    const { createWebLeaderboard } = await import('./webLeaderboard')
    const invoke = vi.fn(async(_name: string, params: { kind: string }) => {
      if (params.kind === 'provider-leaderboards') {
        return {
          source: 'tx',
          list: [{ id: 'tx__26', providerId: '26', name: '热歌榜', source: 'tx' }],
        }
      }
      return { source: 'tx', page: 2, limit: 30, total: 1, list: [{ id: 'track-1', source: 'tx' }] }
    })
    const adapter = createWebLeaderboard('tx', invoke)

    await expect(adapter.getBoards()).resolves.toEqual({
      source: 'tx',
      list: [{ id: 'tx__26', bangid: '26', name: '热歌榜' }],
    })
    await expect(adapter.getList('26', 2)).resolves.toMatchObject({ page: 2, list: [{ id: 'track-1' }] })
    expect(invoke).toHaveBeenLastCalledWith(WIN_MAIN_RENDERER_EVENT_NAME.handle_request, {
      kind: 'provider-leaderboard-tracks', source: 'tx', boardId: '26', page: 2,
    })
  })

  it('rejects malformed Service leaderboard items', async() => {
    const { createWebLeaderboard } = await import('./webLeaderboard')
    const invoke = vi.fn(async() => ({ source: 'tx', list: [{ id: 'tx__26', providerId: '', name: '热歌榜', source: 'tx' }] }))

    await expect(createWebLeaderboard('tx', invoke).getBoards()).rejects.toThrow('Invalid leaderboard response')
  })
})
