import http from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import mgLyric from '../../renderer/utils/musicSdk/mg/lyric'
import { getMusicInfo } from '../../renderer/utils/musicSdk/mg/musicInfo'

vi.mock('../../renderer/utils/musicSdk/mg/musicInfo', () => ({ getMusicInfo: vi.fn() }))

let server: http.Server | undefined

afterEach(async() => {
  vi.resetAllMocks()
  const currentServer = server
  server = undefined
  if (currentServer != null) await new Promise<void>(resolve => currentServer.close(() => { resolve() }))
})

it('uses an MG search result lrcUrl when no mrcUrl is available', async() => {
  const lyric = '[00:01.00]凉凉 - 杨宗纬/张碧晨'
  server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'application/octet-stream')
    response.end(lyric)
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }

  await expect(mgLyric.getLyric({
    copyrightId: 'fixture-copyright',
    mrcUrl: null,
    lrcUrl: `http://127.0.0.1:${port}/fixture.lrc`,
    trcUrl: null,
  }).promise).resolves.toEqual({ lyric, verbatimLyric: '', tlyric: '' })
})

it('returns a diagnostic MG error when neither search nor legacy metadata has lyrics', async() => {
  vi.mocked(getMusicInfo).mockResolvedValue(undefined)

  await expect(mgLyric.getLyric({
    copyrightId: 'missing-copyright',
    mrcUrl: null,
    lrcUrl: null,
    trcUrl: null,
  }).promise).rejects.toMatchObject({
    code: 'SOURCE_LYRIC_UNAVAILABLE',
    message: 'Migu lyric metadata is unavailable',
  })
})
