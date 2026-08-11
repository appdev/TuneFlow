import { describe, expect, it, vi } from 'vitest'
import { enumerateAudioOutputDevices, resolveAudioOutputDevice, subscribeToMediaDeviceChanges } from './mediaDevices'

describe('optional browser media-device support', () => {
  it('returns no outputs when the browser does not expose mediaDevices', async() => {
    await expect(enumerateAudioOutputDevices(undefined)).resolves.toEqual([])
  })

  it('does not register a devicechange listener when mediaDevices is unavailable', () => {
    const listener = vi.fn()

    const unsubscribe = subscribeToMediaDeviceChanges(undefined, listener)

    expect(unsubscribe).toEqual(expect.any(Function))
    expect(() => { unsubscribe() }).not.toThrow()
  })

  it('uses the browser default output without reporting an empty device list when enumeration is unavailable', async() => {
    await expect(resolveAudioOutputDevice(undefined, 'previous-device')).resolves.toEqual({
      device: { deviceId: 'default', label: '' },
      shouldReportEmpty: false,
    })
  })
})
