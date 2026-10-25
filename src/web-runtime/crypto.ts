import CryptoJS from 'crypto-js'
import { unavailable } from '@web-runtime/unavailable'
export const createHash = (algorithm: string) => {
  const values: any[] = []
  const hash = {
    update: (value: any) => { values.push(typeof value === 'string' ? CryptoJS.enc.Utf8.parse(value) : CryptoJS.lib.WordArray.create(value)); return hash },
    digest: (encoding?: string) => {
      const input = values.reduce((data, value) => data.concat(value), CryptoJS.lib.WordArray.create())
      const method = ({ md5: CryptoJS.MD5, sha256: CryptoJS.SHA256, sha1: CryptoJS.SHA1 } as any)[algorithm.toLowerCase()]
      if (!method) return unavailable('Hash algorithm')
      const value = method(input).toString(CryptoJS.enc.Hex)
      return encoding === 'hex' ? value : Buffer.from(value, 'hex')
    },
  }
  return hash
}
export const randomBytes = (size: number) => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(size)))
export const createCipheriv = () => unavailable('平台原生加密')
export const createDecipheriv = createCipheriv
export const publicEncrypt = createCipheriv
export const constants = {}
export default { createHash, randomBytes, createCipheriv, createDecipheriv, publicEncrypt, constants }
