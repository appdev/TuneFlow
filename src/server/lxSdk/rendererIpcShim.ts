import { inflate } from 'node:zlib'
import { promisify } from 'node:util'
import { decryptQrc } from 'qrc-decoder'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '../../common/ipcNames'

const inflateAsync = promisify(inflate)

const decodeKwLyric = async({ lrcBase64, isGetLyricx }: { lrcBase64: string, isGetLyricx: boolean }): Promise<string> => {
  const source = Buffer.from(lrcBase64, 'base64')
  if (source.toString('utf8', 0, 10) !== 'tp=content') return ''
  const lyric = await inflateAsync(source.subarray(source.indexOf('\r\n\r\n') + 4))
  if (!isGetLyricx) return lyric.toString('base64')
  const encoded = Buffer.from(lyric.toString(), 'base64')
  const key = Buffer.from('yeelion')
  for (let index = 0; index < encoded.length; index++) encoded[index] ^= key[index % key.length]
  return encoded.toString('base64')
}

const decodeTxLyric = async({ lrc = '', tlrc = '', rlrc = '' }: { lrc?: string, tlrc?: string, rlrc?: string }): Promise<{ lyric: string, tlyric: string, rlyric: string }> => ({
  lyric: lrc ? decryptQrc(lrc) : '',
  tlyric: tlrc ? decryptQrc(tlrc) : '',
  rlyric: rlrc ? decryptQrc(rlrc) : '',
})

export const rendererInvoke = async<T>(name: string, params: unknown): Promise<T> => {
  if (name === WIN_MAIN_RENDERER_EVENT_NAME.handle_kw_decode_lyric) return decodeKwLyric(params as { lrcBase64: string, isGetLyricx: boolean }) as T
  if (name === WIN_MAIN_RENDERER_EVENT_NAME.handle_tx_decode_lyric) return decodeTxLyric(params as { lrc?: string, tlrc?: string, rlrc?: string }) as T
  throw Object.assign(new Error(`Unsupported service IPC: ${name}`), { code: 'UNSUPPORTED_IPC' })
}
