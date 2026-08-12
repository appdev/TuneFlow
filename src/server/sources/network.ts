import { lookup as dnsLookup } from 'node:dns/promises'
import { randomUUID } from 'node:crypto'
import { Agent, request } from 'undici'
import { SourceServiceError } from './types'

const MAX_REDIRECTS = 5
const MAX_HEADERS = 64 * 1024
const MAX_BODY = 8 * 1024 * 1024

export class SourceError extends SourceServiceError {}

const parseIPv4 = (address: string): number[] | null => {
  const parts = address.split('.')
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return null
  const values = parts.map(Number)
  return values.some(value => value > 255) ? null : values
}

const parseIPv6Words = (address: string): number[] | null => {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '')
  const ipv4Index = normalized.lastIndexOf(':')
  const dotted = normalized.substring(ipv4Index + 1)
  const ipv4 = dotted.includes('.') ? parseIPv4(dotted) : null
  const withEmbeddedV4 = ipv4 == null ? normalized : `${normalized.substring(0, ipv4Index)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`
  const halves = withEmbeddedV4.split('::')
  if (halves.length > 2) return null
  const left = halves[0] === '' ? [] : halves[0].split(':')
  const right = halves.length === 1 || halves[1] === '' ? [] : halves[1].split(':')
  if (left.some(part => !/^[0-9a-f]{1,4}$/.test(part)) || right.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null
  if (halves.length === 1 && left.length !== 8) return null
  if (left.length + right.length > 8) return null
  return [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].map(part => Number.parseInt(part, 16))
}

export const isBlockedAddress = (address: string): boolean => {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '')
  const words = parseIPv6Words(normalized)
  if (words != null) {
    if (words.slice(0, 5).every(value => value === 0) && words[5] === 0xffff) {
      return isBlockedAddress(`${words[6] >>> 8}.${words[6] & 0xff}.${words[7] >>> 8}.${words[7] & 0xff}`)
    }
    return words.every(value => value === 0) || (words.slice(0, 7).every(value => value === 0) && words[7] === 1) || (words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80 || (words[0] & 0xff00) === 0xff00
  }
  if (normalized === '::1' || normalized === '::' || /^fe[89ab][0-9a-f]:/.test(normalized) || normalized.startsWith('ff')) return true
  const ipv4 = parseIPv4(normalized)
  if (ipv4 == null) return false
  const [a, b] = ipv4
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

export interface SourceNetworkOptions {
  fetch?: typeof globalThis.fetch
  lookup?: (hostname: string) => Promise<string[]>
  allowPrivateNetwork?: boolean
  /** Test-only override; production requests always receive a 15 second cap. */
  networkTimeoutMs?: number
}

const resolveHostname = async(hostname: string, options: SourceNetworkOptions): Promise<string[]> => {
  const addresses = options.lookup == null
    ? (await dnsLookup(hostname, { all: true, verbatim: true })).map(result => result.address)
    : await options.lookup(hostname)
  if (!options.allowPrivateNetwork && addresses.some(isBlockedAddress)) throw new SourceError('SOURCE_TARGET_BLOCKED')
  return addresses
}

const headersSize = (headers: Record<string, string | string[] | undefined>): number => Object.entries(headers).reduce((size, [name, value]) => {
  return size + Buffer.byteLength(name) + Buffer.byteLength(Array.isArray(value) ? value.join(',') : value ?? '') + 4
}, 0)

const decodeBody = (raw: Uint8Array): unknown => {
  const text = new TextDecoder().decode(raw)
  try { return JSON.parse(text) } catch { return text }
}

const requestBody = (init: RequestInit & { form?: Record<string, unknown>, formData?: Record<string, unknown> }): { body?: string, headers?: HeadersInit } => {
  if (init.form != null) return { body: new URLSearchParams(Object.entries(init.form).map(([key, value]) => [key, String(value)])).toString(), headers: { ...(init.headers ?? {}), 'content-type': 'application/x-www-form-urlencoded' } }
  if (init.formData != null) {
    const boundary = `----tuneflow-source-${randomUUID()}`
    const body = Object.entries(init.formData).map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key.replace(/[\r\n"]/g, '')}"\r\n\r\n${String(value)}\r\n`).join('') + `--${boundary}--\r\n`
    return { body, headers: { ...(init.headers ?? {}), 'content-type': `multipart/form-data; boundary=${boundary}` } }
  }
  if (init.body != null && typeof init.body === 'object' && !(init.body instanceof ArrayBuffer) && !ArrayBuffer.isView(init.body)) return { body: JSON.stringify(init.body), headers: { ...(init.headers ?? {}), 'content-type': 'application/json' } }
  return { body: init.body as string | undefined, headers: init.headers }
}

const requestSourceNetworkWithSignal = async(url: string, init: RequestInit & { form?: Record<string, unknown>, formData?: Record<string, unknown> } = {}, signal?: AbortSignal, options: SourceNetworkOptions = {}): Promise<{ statusCode: number, statusMessage: string, headers: Record<string, string>, body: unknown, raw: Uint8Array }> => {
  let target = new URL(url)
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new SourceError('SOURCE_TARGET_BLOCKED')
    const addresses = await resolveHostname(target.hostname, options)
    if (options.fetch != null) {
      const prepared = requestBody(init)
      const response = await options.fetch(target, { ...init, ...prepared, signal, redirect: 'manual' })
      const contentLength = Number(response.headers.get('content-length') ?? 0)
      if (contentLength > MAX_BODY || [...response.headers].reduce((size, [name, value]) => size + Buffer.byteLength(name) + Buffer.byteLength(value) + 4, 0) > MAX_HEADERS) throw new SourceError('SOURCE_RESPONSE_TOO_LARGE')
      if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
        if (redirects === MAX_REDIRECTS) throw new SourceError('SOURCE_PROTOCOL_ERROR')
        target = new URL(response.headers.get('location')!, target)
        continue
      }
      const chunks: Uint8Array[] = []
      let size = 0
      const reader = response.body?.getReader()
      if (reader != null) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > MAX_BODY) {
            await reader.cancel()
            throw new SourceError('SOURCE_RESPONSE_TOO_LARGE')
          }
          chunks.push(value)
        }
      }
      const raw = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        raw.set(chunk, offset)
        offset += chunk.byteLength
      }
      const body = decodeBody(raw)
      return { statusCode: response.status, statusMessage: response.statusText, headers: Object.fromEntries(response.headers), body, raw }
    }
    const agent = new Agent({
      connect: {
        lookup: (_hostname, lookupOptions, callback) => {
          const resolved = addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 }))
          if (lookupOptions.all) callback(null, resolved)
          else callback(null, resolved[0].address, resolved[0].family)
        },
      },
    })
    try {
      const prepared = requestBody(init)
      const response = await request(target, {
        method: init.method ?? 'GET',
        headers: prepared.headers as Record<string, string> | undefined,
        body: prepared.body,
        signal,
        dispatcher: agent,
        maxRedirections: 0,
        headersTimeout: 15_000,
        bodyTimeout: 15_000,
      })
      const responseHeaders = response.headers as Record<string, string | string[] | undefined>
      if (headersSize(responseHeaders) > MAX_HEADERS || Number(responseHeaders['content-length'] ?? 0) > MAX_BODY) throw new SourceError('SOURCE_RESPONSE_TOO_LARGE')
      if (response.statusCode >= 300 && response.statusCode < 400 && typeof responseHeaders.location === 'string') {
        if (redirects === MAX_REDIRECTS) throw new SourceError('SOURCE_PROTOCOL_ERROR')
        target = new URL(responseHeaders.location, target)
        continue
      }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > MAX_BODY) {
          response.body.destroy()
          throw new SourceError('SOURCE_RESPONSE_TOO_LARGE')
        }
        chunks.push(chunk)
      }
      const raw = Buffer.concat(chunks)
      return { statusCode: response.statusCode, statusMessage: response.statusText, headers: Object.fromEntries(Object.entries(responseHeaders).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value ?? ''])), body: decodeBody(raw), raw }
    } finally {
      await agent.close()
    }
  }
  throw new SourceError('SOURCE_PROTOCOL_ERROR')
}

export const requestSourceNetwork = async(url: string, init: RequestInit & { form?: Record<string, unknown>, formData?: Record<string, unknown> } = {}, signal?: AbortSignal, options: SourceNetworkOptions = {}): Promise<{ statusCode: number, statusMessage: string, headers: Record<string, string>, body: unknown, raw: Uint8Array }> => {
  const deadline = new AbortController()
  const timeout = setTimeout(() => { deadline.abort() }, options.networkTimeoutMs ?? 15_000)
  try {
    const requestSignal = signal == null ? deadline.signal : AbortSignal.any([signal, deadline.signal])
    return await requestSourceNetworkWithSignal(url, init, requestSignal, options)
  } catch (error) {
    if (deadline.signal.aborted && !signal?.aborted) throw new SourceError('SOURCE_TIMEOUT')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
