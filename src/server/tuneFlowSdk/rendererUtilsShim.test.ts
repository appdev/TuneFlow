import { afterEach, describe, expect, it, vi } from 'vitest'
import { dateFormat, dateFormat2, decodeName, formatPlayCount, formatPlayTime, setRendererUtilsLanguage, sizeFormate } from './rendererUtilsShim'

it('matches provider-facing renderer utility semantics for entities and formatting', () => {
  expect(decodeName('A&nbsp;&copy;&#x4F60;&#22909;&amp;')).toBe('A ©你好&')
  expect(sizeFormate(1024 * 1024)).toBe('1.00 MB')
  expect(formatPlayTime(0)).toBe('--/--')
  expect(dateFormat('2024-01-02 03:04:05', 'Y-M-D h:m:s')).toBe('2024-01-02 03:04:05')
})

describe('renderer provider helper parity', () => {
  afterEach(() => {
    vi.useRealTimers()
    setRendererUtilsLanguage?.('en-us')
  })

  it.each([
    [0, '0'],
    [10_000, '10000'],
    [10_001, '1万'],
    [10_999, '1万'],
    [11_000, '1.1万'],
    [100_000_000, '10000万'],
    [100_000_001, '1亿'],
    [999_999_999, '9.9亿'],
  ] as const)('formats provider play count %s exactly like the renderer', (value, expected) => {
    expect(formatPlayCount(value)).toBe(expected)
  })

  it.each([
    [59_999, '59 seconds ago'],
    [60_000, '1 minutes ago'],
    [3_599_999, '59 minutes ago'],
    [3_600_000, '1 hours ago'],
    [86_399_999, '23 hours ago'],
  ] as const)('formats a comment age of %sms exactly like the en-us renderer', (age, expected) => {
    const now = new Date(2024, 0, 3, 3, 4, 5).getTime()
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(dateFormat2(now - age)).toBe(expected)
  })

  it('uses the renderer absolute-date branch at the exact one-day boundary', () => {
    const now = new Date(2024, 0, 3, 3, 4, 5).getTime()
    const oneDayEarlier = new Date(2024, 0, 2, 3, 4, 5).getTime()
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(dateFormat2(oneDayEarlier)).toBe('2024-01-02 03:04:05')
  })

  it.each([
    ['en-us', '1 minutes ago'],
    ['zh-cn', '1 分钟前'],
    ['zh-tw', '1 分鐘前'],
  ] as const)('uses the renderer %s translation for relative provider dates', (language, expected) => {
    const now = new Date(2024, 0, 3, 3, 4, 5).getTime()
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(setRendererUtilsLanguage).toBeTypeOf('function')
    setRendererUtilsLanguage?.(language)
    expect(dateFormat2(now - 60_000)).toBe(expected)
  })
})
