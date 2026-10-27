import { createOfficialQr, type QrFlow } from './qr'
import { ApiError } from '../errors'

// Explicit runtime smoke: create an anonymous QR, check its state, then dispose.
// Never print the image, ticket, cookies or provider response body.
const main = async() => {
  let flow: QrFlow | undefined
  try {
    flow = await createOfficialQr('wy')
    const result = await flow.poll()
    if (result.status !== 'waiting') throw new Error('Unexpected smoke state')
    console.log(JSON.stringify({ browser: 'ready', qr: 'waiting' }))
  } catch (error) {
    console.log(JSON.stringify(error instanceof ApiError ? { browser: 'unavailable', code: error.code, details: error.details } : { browser: 'unavailable' }))
    process.exitCode = 1
  } finally { await flow?.close?.() }
}
void main()
