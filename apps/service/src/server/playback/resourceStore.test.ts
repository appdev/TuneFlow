import { describe, expect, it } from 'vitest'
import { PlaybackResourceStore } from './resourceStore'

describe('playback resource store', () => {
  it('uses opaque expiring tokens and defensive picture copies', () => {
    let now = 1_000
    const store = new PlaybackResourceStore({ now: () => now })
    const original = Uint8Array.from([1, 2, 3])

    const stored = store.putPicture({ bytes: original, mimeType: 'image/png' })
    original[0] = 9
    const firstRead = store.getPicture(stored.token)!
    firstRead.bytes[1] = 8

    expect(stored).toMatchObject({ expiresAt: 301_000 })
    expect(stored.token).toMatch(/^[a-f0-9]{64}$/)
    expect([...store.getPicture(stored.token)!.bytes]).toEqual([1, 2, 3])
    now = 301_001
    expect(store.getPicture(stored.token)).toBeUndefined()
  })

  it('prunes oldest pictures by entry count and total bytes', () => {
    let now = 0
    const store = new PlaybackResourceStore({ now: () => now })
    const first = store.putPicture({ bytes: Uint8Array.of(1), mimeType: 'image/png' })
    for (let index = 0; index < 256; index++) {
      now++
      store.putPicture({ bytes: Uint8Array.of(index), mimeType: 'image/png' })
    }
    expect(store.getPicture(first.token)).toBeUndefined()

    const bytesStore = new PlaybackResourceStore({ now: () => now })
    const oversizedFirst = bytesStore.putPicture({ bytes: new Uint8Array(17 * 1024 * 1024), mimeType: 'image/jpeg' })
    now++
    const retained = bytesStore.putPicture({ bytes: new Uint8Array(16 * 1024 * 1024), mimeType: 'image/jpeg' })
    expect(bytesStore.getPicture(oversizedFirst.token)).toBeUndefined()
    expect(bytesStore.getPicture(retained.token)).toBeDefined()
  })
})
