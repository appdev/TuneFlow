import { describe, expect, it } from 'vitest'
import { usesServicePlayback } from './runtime'

describe('playback runtime selection', () => {
  it('uses same-origin Service playback', () => {
    expect(usesServicePlayback()).toBe(true)
  })
})
