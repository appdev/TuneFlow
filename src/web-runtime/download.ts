import { WebRuntimeError, webRuntimeResponseError } from './http'

export interface BinaryAttachment {
  blob: Blob
  filename: string
}

const fallbackFilename = 'tuneflow-sources.zip'

const responseFilename = (response: Response): string => {
  const disposition = response.headers.get('content-disposition') ?? ''
  return /^attachment;\s*filename="(tuneflow-sources-\d{8}-\d{6}\.zip)"$/i.exec(disposition)?.[1] ?? fallbackFilename
}

const parsedErrorBody = async(response: Response): Promise<unknown> => {
  const text = await response.text()
  if (!text) return undefined
  try { return JSON.parse(text) } catch { return undefined }
}

export const requestBinaryAttachment = async(
  path: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<BinaryAttachment> => {
  let response: Response
  try {
    response = await fetchImpl(path, { method: 'GET' })
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error)
    throw new WebRuntimeError('NETWORK_ERROR', 0, 'Unable to reach TuneFlow Service', { cause })
  }
  if (!response.ok) throw webRuntimeResponseError(response, await parsedErrorBody(response))
  if (response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/zip') {
    throw new WebRuntimeError('INVALID_RESPONSE', response.status, 'Service returned an invalid source export')
  }
  return { blob: await response.blob(), filename: responseFilename(response) }
}

export const downloadBinaryAttachment = async(path: string): Promise<void> => {
  const { blob, filename } = await requestBinaryAttachment(path)
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.hidden = true
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    globalThis.setTimeout(() => { URL.revokeObjectURL(url) }, 0)
  }
}
