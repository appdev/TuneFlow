import { describe, expect, it, vi } from 'vitest'
import { installWebContextMenuGuard } from './contextMenu'

describe('Web context menu guard', () => {
  it('suppresses the browser menu without swallowing TuneFlow handlers', () => {
    const target = new EventTarget()
    const tuneFlowHandler = vi.fn()
    target.addEventListener('contextmenu', tuneFlowHandler)
    const uninstall = installWebContextMenuGuard(target)
    const event = new Event('contextmenu', { bubbles: true, cancelable: true })

    expect(target.dispatchEvent(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(tuneFlowHandler).toHaveBeenCalledOnce()

    uninstall()
    const restored = new Event('contextmenu', { cancelable: true })
    expect(target.dispatchEvent(restored)).toBe(true)
    expect(restored.defaultPrevented).toBe(false)
  })
})
