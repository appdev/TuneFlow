import { deflateSync } from 'node:zlib'
import iconv from 'iconv-lite'
import { encryptQrc } from 'qrc-decoder'
import { expect, it } from 'vitest'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '../../common/ipcNames'
import { rendererInvoke } from './rendererIpcShim'

it('decodes TX QRC lyrics in the Service Node runtime', async() => {
  const lyric = '[00:00.00]fixture lyric'
  await expect(rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.handle_tx_decode_lyric, {
    lrc: encryptQrc(lyric),
    tlrc: encryptQrc('translation'),
    rlrc: '',
  })).resolves.toEqual({ lyric, tlyric: 'translation', rlyric: '' })
})

it('transcodes decrypted KW GB18030 lyrics to UTF-8 without replacement characters', async() => {
  const lyric = '[00:01.00]凉凉 - 杨宗纬/张碧晨'
  const encrypted = iconv.encode(lyric, 'gb18030')
  const key = Buffer.from('yeelion')
  for (let index = 0; index < encrypted.length; index++) encrypted[index] ^= key[index % key.length]
  const payload = Buffer.concat([
    Buffer.from('tp=content\r\n\r\n'),
    deflateSync(Buffer.from(encrypted.toString('base64'))),
  ])

  const decoded = await rendererInvoke<string>(WIN_MAIN_RENDERER_EVENT_NAME.handle_kw_decode_lyric, {
    lrcBase64: payload.toString('base64'),
    isGetLyricx: true,
  })
  const text = Buffer.from(decoded, 'base64').toString('utf8')

  expect(text).toBe(lyric)
  expect(text).not.toContain('\uFFFD')
})
