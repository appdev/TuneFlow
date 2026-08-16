import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebRuntimeError } from './http'
import { downloadBinaryAttachment, requestBinaryAttachment } from './download'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('hosted Web binary downloads', () => {
  it('returns a ZIP blob with the server-provided TuneFlow filename', async() => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('zip-bytes', {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="tuneflow-sources-20260816-030405.zip"',
      },
    }))

    const result = await requestBinaryAttachment('/api/v1/sources/export', fetch)

    expect(result.filename).toBe('tuneflow-sources-20260816-030405.zip')
    expect(await result.blob.text()).toBe('zip-bytes')
    expect(fetch).toHaveBeenCalledWith('/api/v1/sources/export', { method: 'GET' })
  })

  it('falls back to a safe filename for missing or untrusted response names', async() => {
    for (const disposition of [null, 'attachment; filename="../../private.zip"']) {
      const headers = new Headers({ 'content-type': 'application/zip' })
      if (disposition != null) headers.set('content-disposition', disposition)
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('zip', { status: 200, headers }))

      await expect(requestBinaryAttachment('/api/v1/sources/export', fetch)).resolves.toMatchObject({
        filename: 'tuneflow-sources.zip',
      })
    }
  })

  it('turns a Service error envelope into a WebRuntimeError', async() => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'SOURCE_EXPORT_FAILED', message: 'Unable to export installed sources', details: { retryable: false } },
    }), { status: 500, headers: { 'content-type': 'application/json' } }))

    const failure = await requestBinaryAttachment('/api/v1/sources/export', fetch).catch(error => error)

    expect(failure).toBeInstanceOf(WebRuntimeError)
    expect(failure).toMatchObject({ code: 'SOURCE_EXPORT_FAILED', status: 500, details: { retryable: false } })
  })

  it('rejects invalid binary responses and network failures with stable codes', async() => {
    const invalid = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('not a zip', {
      status: 200, headers: { 'content-type': 'text/plain' },
    }))
    const unavailable = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('connection reset'))

    await expect(requestBinaryAttachment('/api/v1/sources/export', invalid)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 })
    await expect(requestBinaryAttachment('/api/v1/sources/export', unavailable)).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 })
  })

  it('clicks one temporary anchor and always revokes its object URL', async() => {
    vi.useFakeTimers()
    const response = new Response('zip', {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="tuneflow-sources-20260816-030405.zip"',
      },
    })
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(response))
    const click = vi.fn()
    const remove = vi.fn()
    const anchor = { href: '', download: '', hidden: false, click, remove }
    const append = vi.fn()
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { append } })
    const createObjectURL = vi.fn(() => 'blob:source-export')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    await downloadBinaryAttachment('/api/v1/sources/export')

    expect(anchor).toMatchObject({ href: 'blob:source-export', download: 'tuneflow-sources-20260816-030405.zip', hidden: true })
    expect(append).toHaveBeenCalledWith(anchor)
    expect(click).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:source-export')
  })
})
