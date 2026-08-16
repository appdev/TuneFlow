import { describe, expect, it, vi } from 'vitest'
import { runUserDownloads, ServiceRequestError } from './userDownload'

describe('user download existing-file coordination', () => {
  it('asks once and retries only the conflicting song with replace', async() => {
    const calls: Array<{ id: string, policy: string }> = []
    const request = vi.fn(async(id: string, policy: string) => {
      calls.push({ id, policy })
      if (id === 'a' && policy === 'error') throw new ServiceRequestError(409, 'DOWNLOAD_ALREADY_EXISTS', 'exists', { fileName: 'A.mp3', extension: 'mp3' })
    })
    const confirm = vi.fn(async() => true)

    await runUserDownloads(['a', 'b'], request, confirm)

    expect(calls).toEqual([
      { id: 'a', policy: 'error' },
      { id: 'a', policy: 'replace' },
      { id: 'b', policy: 'error' },
    ])
    expect(confirm).toHaveBeenCalledWith({ fileName: 'A.mp3', extension: 'mp3' })
  })

  it('skips a declined conflict and continues the remaining songs', async() => {
    const calls: Array<{ id: string, policy: string }> = []
    const request = vi.fn(async(id: string, policy: string) => {
      calls.push({ id, policy })
      if (id === 'a') throw new ServiceRequestError(409, 'DOWNLOAD_ALREADY_EXISTS', 'exists')
    })

    await runUserDownloads(['a', 'b'], request, async() => false)

    expect(calls).toEqual([{ id: 'a', policy: 'error' }, { id: 'b', policy: 'error' }])
  })

  it('does not turn unrelated failures into replacement prompts', async() => {
    const failure = new ServiceRequestError(503, 'SOURCE_UNAVAILABLE', 'offline')
    await expect(runUserDownloads(['a'], async() => { throw failure }, async() => true)).rejects.toBe(failure)
  })
})
