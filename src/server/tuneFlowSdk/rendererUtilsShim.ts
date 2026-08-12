import { createHash } from 'node:crypto'
import { decode } from 'he'

type RendererUtilsLanguage = 'en-us' | 'zh-cn' | 'zh-tw'
const relativeMessages: Record<RendererUtilsLanguage, { second: string, minute: string, hour: string }> = {
  'en-us': { second: '{num} seconds ago', minute: '{num} minutes ago', hour: '{num} hours ago' },
  'zh-cn': { second: '{num} 秒前', minute: '{num} 分钟前', hour: '{num} 小时前' },
  'zh-tw': { second: '{num} 秒前', minute: '{num} 分鐘前', hour: '{num} 小時前' },
}
let rendererUtilsLanguage: RendererUtilsLanguage = 'en-us'

export const setRendererUtilsLanguage = (value: unknown): void => {
  rendererUtilsLanguage = value === 'zh-cn' || value === 'zh-tw' || value === 'en-us' ? value : 'en-us'
}
const relativeDate = (unit: keyof typeof relativeMessages['en-us'], num: number): string => relativeMessages[rendererUtilsLanguage][unit].replace('{num}', String(num))

export const decodeName = (value: string | null = ''): string => decode(String(value ?? ''))
export const sizeFormate = (size: number): string => {
  if (!size) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.floor(Math.log(size) / Math.log(1024))
  return `${(size / Math.pow(1024, index)).toFixed(2)} ${units[index]}`
}
const two = (value: number) => value < 10 ? `0${value}` : String(value)
export const formatPlayTime = (seconds: number): string => {
  const minutes = Math.trunc(seconds / 60)
  const remaining = Math.trunc(seconds % 60)
  return minutes === 0 && remaining === 0 ? '--/--' : `${two(minutes)}:${two(remaining)}`
}
export const dateFormat = (value: Date | number | string, format = 'Y-M-D h:m:s'): string => {
  const date = value instanceof Date ? value : new Date(typeof value === 'string' && !value.includes('T') ? value.split('.')[0].replace(/-/g, '/') : value)
  if (Number.isNaN(date.getTime())) return ''
  return format.replace('Y', String(date.getFullYear())).replace('M', two(date.getMonth() + 1)).replace('D', two(date.getDate())).replace('h', two(date.getHours())).replace('m', two(date.getMinutes())).replace('s', two(date.getSeconds()))
}
export const dateFormat2 = (time: number): string => {
  const differ = Math.trunc((Date.now() - time) / 1000)
  if (differ < 60) return relativeDate('second', differ)
  if (differ < 3_600) return relativeDate('minute', Math.trunc(differ / 60))
  if (differ < 86_400) return relativeDate('hour', Math.trunc(differ / 3_600))
  return dateFormat(time)
}
export const formatPlayCount = (value: number): string => {
  if (value > 100_000_000) return `${Math.trunc(value / 10_000_000) / 10}亿`
  if (value > 10_000) return `${Math.trunc(value / 1_000) / 10}万`
  return String(value)
}
export const toMD5 = (value: string): string => createHash('md5').update(value).digest('hex')
