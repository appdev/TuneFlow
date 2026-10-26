import type { Page } from '@playwright/test'

// Headless Linux runners have no speakers. Declare a synthetic default output
// so hardware-removal notices do not cover unrelated source/playback UI tests.
// Audio playback, stream requests and timing still use the real browser.
export const installDefaultAudioOutput = async(page: Page): Promise<void> => {
  await page.addInitScript(() => {
    if (!navigator.mediaDevices) return
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
      configurable: true,
      value: async() => {
        const device = { deviceId: 'default', groupId: 'fixture-output', kind: 'audiooutput', label: 'Synthetic default output' } as const
        return [{ ...device, toJSON: () => device }]
      },
    })
  })
}
