import { describe, expect, it } from 'vitest'
import { getWebCapabilities } from './capabilities'
import { rendererInvoke, rendererSend } from './rendererIpc'
import { clipboardReadText, createDir, openUrl } from './browser'

describe('web capabilities', () => {
  it('declares only supported Web and Service surfaces', () => {
    expect(getWebCapabilities()).toEqual({
      runtime: 'web',
      settings: true,
      appData: true,
      environment: true,
      lists: true,
      events: true,
      sources: true,
      search: true,
      playback: true,
      downloads: true,
      localLibrary: true,
      themes: true,
      serverFiles: true,
    })
  })

  it('labels IPC names outside the typed runtime map', async() => {
    await expect(rendererInvoke('not_supported')).rejects.toMatchObject({ code: 'UNSUPPORTED_IPC' })
    expect(() => {
      rendererSend('not_supported')
    }).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_IPC' }))
  })

  it('labels unsupported browser-adapter operations', async() => {
    await expect(createDir()).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    await expect(openUrl('https://example.com')).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    expect(clipboardReadText()).toBe('')
  })
})
