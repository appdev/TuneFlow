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
