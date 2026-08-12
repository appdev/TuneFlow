import { describe, expect, it } from 'vitest'
import { isSameMusic } from './matching'

describe('downloaded music matching', () => {
  it('matches the same provider identity even when display metadata changed', () => {
    expect(isSameMusic(
      { id: 'track-1', source: 'kw', name: 'Old title', singer: 'Artist' },
      { source: 'kw', name: 'New title', singer: 'Artist', meta: { songId: 'track-1' } },
    )).toBe(true)
  })

  it('matches equivalent provider tracks by normalized title, artist, and duration', () => {
    expect(isSameMusic(
      { id: 'kw-1', source: 'kw', name: '晚 风', singer: '伍佰 & China Blue', interval: '03:45' },
      { id: 'wy-2', source: 'wy', name: '晚风', singer: '伍佰、China Blue', interval: '03:47' },
    )).toBe(true)
  })

  it('rejects another version when its duration differs materially', () => {
    expect(isSameMusic(
      { id: 'kw-1', source: 'kw', name: '晚风', singer: '伍佰', interval: '03:45' },
      { id: 'wy-2', source: 'wy', name: '晚风', singer: '伍佰', interval: '04:20' },
    )).toBe(false)
  })
})
