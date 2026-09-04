import { afterEach, expect, it, vi } from 'vitest'
import mgPic from '../../renderer/utils/musicSdk/mg/pic'
import { httpFetch } from '../../renderer/utils/request'
import getSongId from '../../renderer/utils/musicSdk/mg/songId'

vi.mock('../../renderer/utils/request', () => ({ httpFetch: vi.fn() }))
vi.mock('../../renderer/utils/musicSdk/mg/songId', () => ({ default: vi.fn() }))

afterEach(() => { vi.resetAllMocks() })

const respond = (body: Record<string, string>) => ({
  promise: Promise.resolve({ body }),
  cancelHttp: vi.fn(),
})

it('resolves the MG picture provider to a URL for its callers', async() => {
  vi.mocked(getSongId).mockResolvedValue('song-123')
  vi.mocked(httpFetch).mockReturnValue(respond({ returnCode: '000000', largePic: '//example.com/cover.jpg' }) as any)

  await expect(mgPic.getPic({ songmid: 'song-123' })).resolves.toBe('http://example.com/cover.jpg')
})

it('retries the same song ID and returns the successful picture', async() => {
  vi.mocked(getSongId).mockResolvedValue('song-123')
  vi.mocked(httpFetch)
    .mockReturnValueOnce(respond({ returnCode: 'failed' }) as any)
    .mockReturnValueOnce(respond({ returnCode: '000000', mediumPic: 'https://example.com/cover.jpg' }) as any)

  await expect(mgPic.getPic({ songmid: 'song-123' })).resolves.toBe('https://example.com/cover.jpg')
  expect(getSongId).toHaveBeenCalledTimes(1)
  expect(httpFetch).toHaveBeenCalledTimes(2)
  for (const [url] of vi.mocked(httpFetch).mock.calls) {
    expect(url).toBe('http://music.migu.cn/v3/api/music/audioPlayer/getSongPic?songId=song-123')
  }
})

it('propagates exhausted retries to the caller without an unhandled rejection', async() => {
  vi.mocked(getSongId).mockResolvedValue('song-123')
  vi.mocked(httpFetch).mockImplementation(() => respond({ returnCode: 'failed' }) as any)

  await expect(mgPic.getPic({ songmid: 'song-123' })).rejects.toThrow('图片获取失败')
  expect(httpFetch).toHaveBeenCalledTimes(7)
})

it('propagates a network interruption during retry to the caller', async() => {
  const error = new Error('connection reset')
  vi.mocked(getSongId).mockResolvedValue('song-123')
  vi.mocked(httpFetch)
    .mockReturnValueOnce(respond({ returnCode: 'failed' }) as any)
    .mockImplementationOnce(() => ({ promise: Promise.reject(error), cancelHttp: vi.fn() }) as any)

  await expect(mgPic.getPic({ songmid: 'song-123' })).rejects.toBe(error)
  expect(httpFetch).toHaveBeenCalledTimes(2)
})
