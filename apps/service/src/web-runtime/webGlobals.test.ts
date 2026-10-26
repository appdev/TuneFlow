import { describe, expect, it, vi } from 'vitest'
import { installWebSchedulingGlobals } from './webGlobals'

describe('Web scheduling globals', () => {
  it('provides the desktop setImmediate contract without replacing an existing implementation', () => {
    const callback = vi.fn()
    const setTimeout = vi.fn((handler: (...args: unknown[]) => void, _delay: number, ...args: unknown[]) => {
      handler(...args)
      return 1
    })
    const target = { setTimeout }

    installWebSchedulingGlobals(target)
    target.setImmediate?.(callback, 'ready')

    expect(setTimeout).toHaveBeenCalledWith(callback, 0, 'ready')
    expect(callback).toHaveBeenCalledWith('ready')

    const existing = vi.fn()
    const existingTarget = { setTimeout, setImmediate: existing }
    installWebSchedulingGlobals(existingTarget)
    expect(existingTarget.setImmediate).toBe(existing)
  })
})
