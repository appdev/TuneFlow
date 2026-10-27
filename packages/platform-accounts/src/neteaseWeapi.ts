import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto'

const iv = Buffer.from('0102030405060708')
const presetKey = Buffer.from('0CoJUm6Qyw8W8jud')
const base62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const publicKey = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----'

const encrypt = (value: Buffer, key: Buffer) => {
  const cipher = createCipheriv('aes-128-cbc', key, iv)
  return Buffer.concat([cipher.update(value), cipher.final()])
}

// Same two AES-CBC passes and RSA key wrapping as the official Web asrsea.
export const buildNeteaseWeapiForm = (data: Record<string, unknown>) => {
  const secretKey = Buffer.from(Array.from(randomBytes(16), value => base62.charCodeAt(value % base62.length)))
  const firstPass = encrypt(Buffer.from(JSON.stringify(data)), presetKey).toString('base64')
  const params = encrypt(Buffer.from(firstPass), secretKey).toString('base64')
  const paddedKey = Buffer.concat([Buffer.alloc(128 - secretKey.length), Buffer.from(secretKey).reverse()])
  const encSecKey = publicEncrypt({ key: publicKey, padding: constants.RSA_NO_PADDING }, paddedKey).toString('hex')
  return new URLSearchParams({ params, encSecKey })
}
