import pako from 'pako'
const callback = (method: (data: any) => any) => (data: any, done: (error: unknown, value?: Buffer) => void) => { try { done(null, Buffer.from(method(data))) } catch (error) { done(error) } }
export const inflate = callback(pako.inflate)
export const deflateRaw = callback(pako.deflateRaw)
export const gzip = callback(pako.gzip)
export const gunzip = callback(pako.ungzip)
