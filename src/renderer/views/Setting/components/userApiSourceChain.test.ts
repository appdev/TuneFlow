import { describe, expect, it } from 'vitest'

describe('hosted Web custom-source chain model', () => {
  it('exposes immutable source-chain helpers', async() => {
    const module = await import('@renderer/core/userApiSourceChain').catch(() => ({}))
    expect(module).toMatchObject({
      splitSourceChain: expect.any(Function),
      toggleSource: expect.any(Function),
      moveSource: expect.any(Function),
    })
  })

  it('splits enabled sources by priority and keeps disabled installation order', async() => {
    const { splitSourceChain } = await import('@renderer/core/userApiSourceChain')
    const list = [
      { id: 'b', enabled: true, priority: 1 },
      { id: 'off-1', enabled: false, priority: null },
      { id: 'a', enabled: true, priority: 0 },
      { id: 'legacy' },
      { id: 'off-2', enabled: false, priority: null },
    ] as TuneFlow.UserApi.UserApiInfo[]

    expect(splitSourceChain(list)).toMatchObject({
      enabled: [{ id: 'a' }, { id: 'b' }],
      disabled: [{ id: 'off-1' }, { id: 'legacy' }, { id: 'off-2' }],
    })
    expect(list.map(source => source.id)).toEqual(['b', 'off-1', 'a', 'legacy', 'off-2'])
  })

  it('appends newly enabled sources and removes disabled sources without duplicates', async() => {
    const { toggleSource } = await import('@renderer/core/userApiSourceChain')

    expect(toggleSource(['a', 'b'], 'c', true)).toEqual(['a', 'b', 'c'])
    expect(toggleSource(['a', 'b'], 'a', true)).toEqual(['a', 'b'])
    expect(toggleSource(['a', 'b'], 'a', false)).toEqual(['b'])
    expect(toggleSource(['a', 'b'], 'c', false)).toEqual(['a', 'b'])
  })

  it('moves enabled sources without mutating the confirmed order', async() => {
    const { moveSource } = await import('@renderer/core/userApiSourceChain')
    const ids = ['a', 'b', 'c']

    expect(moveSource(ids, 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveSource(ids, -1, 0)).toEqual(ids)
    expect(moveSource(ids, 0, 3)).toEqual(ids)
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('selects priority zero or a built-in source for the legacy display', async() => {
    const { nextLegacySource } = await import('@renderer/core/userApiSourceChain')

    expect(nextLegacySource(['user_api_b', 'user_api_a'], ['kw'])).toBe('user_api_b')
    expect(nextLegacySource([], ['kw', 'tx'])).toBe('kw')
    expect(nextLegacySource([], [])).toBe('')
  })
})
